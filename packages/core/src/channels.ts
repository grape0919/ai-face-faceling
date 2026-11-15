import type { BodySpec } from './body.js';
import { clamp } from './judgment.js';
import type { Role } from './questions.js';

/**
 * 부위별 수치 판단(실험).
 *
 * 선택지에서 동작을 고르는 대신, 몸이 가진 부위(근육·관절)마다 "얼마나"와 "얼마 동안"을 분석기에게 직접 묻는다.
 * 몸은 채널 목록만 선언하면 된다: 이름과 한 줄 설명. 엔진은 채널이 무엇인지 모른 채 값을 프레임에 실어 넘기고,
 * 그 몸의 리그가 자기 채널을 읽어 움직인다. 부위를 넣고 빼는 일은 목록의 한 줄이다.
 * 감정 표현, 부탁받은 동작("귀 움직여 봐"), 유지 시간이 모두 같은 판단에서 나온다.
 */

/** 채널 하나. 설명은 분석기에 그대로 보내므로 영어로 쓴다. */
export interface ChannelSpec {
  /** 프레임에 실리는 이름. 얼굴 리그는 ARKit 이름을 그대로 쓴다. */
  name: string;
  /** 무엇이 어떻게 움직이는지. "…, how much should this happen: {describe}?" 에 들어간다. */
  describe: string;
  /** 서로 반대인 채널의 이름(귀 올림 ↔ 귀 내림). 판단 뒤에 둘의 차이만 남기고, 새 자세가 오면 반대쪽 자세를 푼다. */
  opposite?: string;
  /** 이 값 아래는 버린다. 없으면 CHANNEL_FLOOR. 늘 조금씩 켜지는 채널은 높게 잡는다. */
  floor?: number;
}

/**
 * 그 움직임이 얼마 동안 이어지는가.
 * - instant: 한 번 하고 끝(윙크, 끄덕임)  - brief: 1~2초 잠깐  - line: 그 말을 하는 동안(감정 표현)
 * - stay: 말이 끝난 뒤에도 몇 초 남는 자세  - until_told: 그만하라고 할 때까지
 */
export type Duration = 'instant' | 'brief' | 'line' | 'stay' | 'until_told';

export interface ChannelValue {
  /** 세기 0~1. 반대 채널을 빼고 바닥을 자른 뒤의 값이다. */
  amount: number;
  duration: Duration;
}

/** 채널 이름 → 값. 움직이지 않는 채널은 들어 있지 않다. */
export type ChannelJudgment = Record<string, ChannelValue>;

/**
 * 점수(0~1)를 세기로 옮기는 기준. 바닥 아래는 버리고, 바닥에서 CHANNEL_FULL 까지를 0~1 로 다시 편다.
 * 점수는 다섯 단계의 기대값이라, 판단이 애매하면 0 이 아니라 중간값으로 나오고 또렷해도 1 에 잘 닿지 않는다.
 * 그대로 쓰면 모든 부위가 조금씩 움직이고 감정은 옅게 나온다.
 */
export const CHANNEL_FLOOR = 0.25;
export const CHANNEL_FULL = 0.8;

const AMOUNT_LEVELS = ['Not at all', 'Slightly', 'Moderately', 'Strongly', 'Fully'];
const DURATIONS: Record<Duration | 'none', string> = {
  none: 'This part does not move for this line.',
  instant: 'A quick one-off: it happens once for a fraction of a second and is over (a wink, a blink, a nod, a twitch).',
  brief: 'A short moment of a second or two, then back ("just for a second").',
  line: 'It lasts while this line is being said and fades when the line ends (an expression of feeling).',
  stay: 'It is a position the assistant moves into and keeps after the line ends, for some seconds, until something else replaces it.',
  until_told: 'The assistant was told to keep it, so it stays until told otherwise ("keep looking right", "stay like that").',
};

const scene = (body: BodySpec, role: Role): string =>
  `An AI assistant is in a voice conversation with a user. Its body is shown on a screen: ${body.describe} ` +
  (role === 'speaking'
    ? 'The assistant itself is saying `current`. '
    : 'The user is saying `current` and the assistant is silently listening, reacting as a warm, attentive listener: it responds to what it hears and does not copy the user. ') +
  '`context` holds the preceding lines; `following`, when present, is what the same speaker says right after `current`. Use them only to understand `current`. ' +
  'The text may be Korean or English. ' +
  'Each part of the body moves for one of two reasons: to show what the assistant feels, or because the assistant is actually moving that part right now ' +
  '(it was asked to and does it). Merely mentioning a part, or saying it could move it, does not move it. ' +
  'The lip and jaw movement needed just to pronounce the words is handled separately; do not count it. ' +
  'Plain, factual lines leave the body at rest.';

const RESET_KEY = '__reset';
const durationKey = (name: string): string => `${name}__d`;

/**
 * 채널마다 세기(점수)를 묻고, AI 가 말하는 구간에서는 유지 시간(선택)도 묻는다.
 * 말하는 구간에는 "쉬는 자세로 돌아가는 중인가"도 하나 묻는다. 붙잡아 둔 자세를 푸는 신호다.
 */
export function channelQuestions(body: BodySpec, role: Role): Record<string, unknown> {
  const intro = scene(body, role);
  const doing = role === 'speaking' ? 'saying' : 'listening to';
  const questions: Record<string, unknown> = {};
  for (const channel of body.channels ?? []) {
    questions[channel.name] = {
      type: 'score',
      instructions: `${intro} While ${doing} \`current\`, how much should this happen: ${channel.describe}?`,
      criteria: AMOUNT_LEVELS,
    };
    if (role === 'speaking') {
      questions[durationKey(channel.name)] = {
        type: 'choice',
        instructions: `${intro} For the line \`current\`, how long does this last: ${channel.describe}?`,
        criteria: DURATIONS,
      };
    }
  }
  if (role === 'speaking') {
    questions[RESET_KEY] = {
      type: 'choice',
      instructions:
        `${intro} Is the assistant, while saying \`current\`, going back to its neutral resting position ` +
        '(asked to relax, to face front again, or to stop holding a pose, and it does so)?',
      criteria: { no: 'No. This is the usual case.', yes: 'Yes, it is returning to its resting position right now.' },
    };
  }
  return questions;
}

interface Answer {
  score?: number;
  choice?: string;
  probabilities?: Record<string, number>;
}

/**
 * 채널별 원값(0~1)을 정리한다: 반대 채널끼리는 차이만 남기고, 바닥 아래는 버리고, 그 위를 0~1 로 다시 편다.
 * 남는 것이 없는 채널은 결과에서 빠진다.
 */
export function settleChannels(body: BodySpec, raw: Record<string, number>): Record<string, number> {
  const specs = new Map((body.channels ?? []).map((c) => [c.name, c]));
  const net: Record<string, number> = {};
  for (const [name, spec] of specs) {
    const own = raw[name] ?? 0;
    // 반대 채널은 어느 한쪽에만 적어도 된다
    const other = spec.opposite ?? [...specs.values()].find((c) => c.opposite === name)?.name;
    // 반대쪽이 바닥을 넘은 만큼만 뺀다. 반대쪽의 잡음까지 빼면 또렷한 동작이 깎인다.
    net[name] = other ? Math.max(0, own - Math.max(0, (raw[other] ?? 0) - CHANNEL_FLOOR)) : own;
  }
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(net)) {
    const floor = specs.get(name)?.floor ?? CHANNEL_FLOOR;
    const lifted = clamp((value - floor) / (Math.max(CHANNEL_FULL, floor + 0.1) - floor));
    if (lifted > 0.02) out[name] = lifted;
  }
  return out;
}

/** 분석기의 답을 채널 판단으로 옮긴다. reset 은 쉬는 자세로 돌아가는 중인지. */
export function readChannelAnswers(body: BodySpec, role: Role, answers: Record<string, Answer>): { channels: ChannelJudgment; reset: boolean } {
  const raw: Record<string, number> = {};
  for (const channel of body.channels ?? []) raw[channel.name] = clamp((answers[channel.name]?.score ?? 0) / (AMOUNT_LEVELS.length - 1));
  const channels: ChannelJudgment = {};
  for (const [name, amount] of Object.entries(settleChannels(body, raw))) {
    const picked = answers[durationKey(name)]?.choice;
    // 세기는 있는데 "움직이지 않는다"를 골랐거나 듣는 구간이면, 그 말(듣기)이 이어지는 동안으로 본다
    const duration: Duration = role === 'speaking' && picked && picked !== 'none' && picked in DURATIONS ? (picked as Duration) : 'line';
    channels[name] = { amount, duration };
  }
  const reset = role === 'speaking' && (answers[RESET_KEY]?.probabilities?.yes ?? 0) > 0.6;
  return { channels, reset };
}

// ── 얼굴 몸의 표준 채널 ────────────────────────────────────

/** ARKit 52 가운데 좌우가 있는 것. 눈동자 방향(eyeLook*)은 아래의 시선 채널로 대신한다. */
const SIDED: [base: string, describe: string, opposite?: string][] = [
  ['browDown', 'eyebrow lowers and draws inward', 'browOuterUp'],
  ['browOuterUp', 'outer end of the eyebrow rises'],
  ['cheekSquint', 'cheek lifts and squeezes the lower eyelid, as in a real smile'],
  ['eyeBlink', 'eyelid closes', 'eyeWide'],
  ['eyeSquint', 'eyelids tighten and narrow the eye, staying open (scrutiny, doubt, a smiling eye; not a wink or a blink)'],
  ['eyeWide', 'eye opens wide'],
  ['mouthDimple', 'mouth corner tightens into a dimple'],
  ['mouthFrown', 'mouth corner pulls down', 'mouthSmile'],
  ['mouthLowerDown', 'lower lip pulls down, showing the lower teeth'],
  ['mouthPress', 'lips press together on this side'],
  ['mouthSmile', 'mouth corner pulls up'],
  ['mouthStretch', 'mouth corner stretches sideways (grimace)'],
  ['mouthUpperUp', 'upper lip rises'],
  ['noseSneer', 'nostril rises and the nose wrinkles'],
];
const SINGLE: [name: string, describe: string, opposite?: string][] = [
  ['browInnerUp', 'the inner ends of both eyebrows rise (worry, sadness)'],
  ['cheekPuff', 'the cheeks puff out with air'],
  ['jawForward', 'the jaw pushes forward'],
  ['jawLeft', 'the jaw shifts to the left', 'jawRight'],
  ['jawRight', 'the jaw shifts to the right'],
  ['jawOpen', 'the jaw drops and the mouth falls open'],
  ['mouthClose', 'the lips close while the jaw is open'],
  ['mouthFunnel', 'the lips form an open funnel shape'],
  ['mouthPucker', 'the lips pucker forward'],
  ['mouthLeft', 'the whole mouth shifts to the left', 'mouthRight'],
  ['mouthRight', 'the whole mouth shifts to the right'],
  ['mouthRollLower', 'the lower lip rolls inward'],
  ['mouthRollUpper', 'the upper lip rolls inward'],
  ['mouthShrugLower', 'the lower lip pushes up'],
  ['mouthShrugUpper', 'the upper lip pushes up'],
  ['tongueOut', 'the tongue sticks out'],
];
/** 눈과 머리. 얼굴 어댑터(facePose)가 시선과 머리 각도로 옮긴다. 방향은 보는 사람 기준이다. */
const GAZE_HEAD: [name: string, describe: string, opposite?: string][] = [
  ['gazeUp', 'the eyes look up', 'gazeDown'],
  ['gazeDown', 'the eyes look down'],
  ['gazeLeft', 'the eyes look to the left as the user sees them', 'gazeRight'],
  ['gazeRight', 'the eyes look to the right as the user sees them'],
  ['headUp', 'the head lifts', 'headDown'],
  ['headDown', 'the head lowers'],
  ['headLeft', 'the head turns to the left as the user sees it', 'headRight'],
  ['headRight', 'the head turns to the right as the user sees it'],
  ['headTilt', 'the head tilts sideways toward a shoulder (a puzzled or curious tilt, not a turn)'],
  ['headNod', 'the head dips down and back up in a nod'],
  ['headShake', 'the head shakes from side to side ("no")'],
];

const sided = (side: 'Left' | 'Right'): ChannelSpec[] =>
  SIDED.map(([base, describe, opposite]) => ({
    name: `${base}${side}`,
    // 글에는 어느 쪽 눈인지가 없으므로, 윙크는 왼쪽 눈으로 한다고 정해 준다
    describe:
      base === 'eyeBlink'
        ? side === 'Left'
          ? 'the left eyelid closes completely (a wink is exactly this: the left eye shuts fully while the right stays open)'
          : 'the right eyelid closes completely (it stays open in a wink; it shuts only when both eyes shut)'
        : `the ${side.toLowerCase()} ${describe}`,
    ...(opposite && { opposite: `${opposite}${side}` }),
  }));

/** 말하는 입 모양과 헷갈려 거의 모든 문장에서 조금씩 켜지는 채널. 또렷할 때만 받는다. */
const NOISY: Record<string, number> = { mouthClose: 0.6, mouthFunnel: 0.5, mouthPressLeft: 0.45, mouthPressRight: 0.45, jawOpen: 0.45, mouthShrugLower: 0.45 };

/** 얼굴 캐릭터가 움직일 수 있는 부위 전부: ARKit 의 표정 근육 44개, 시선 4개, 머리 7개. */
export const FACE_CHANNELS: ChannelSpec[] = [
  ...sided('Left'),
  ...sided('Right'),
  ...[...SINGLE, ...GAZE_HEAD].map(([name, describe, opposite]) => ({ name, describe, ...(opposite && { opposite }) })),
].map((c) => (NOISY[c.name] === undefined ? c : { ...c, floor: NOISY[c.name] }));
