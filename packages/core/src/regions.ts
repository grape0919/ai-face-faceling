/**
 * 얼굴 부위와 부위별 동작 정의.
 * 분석기(Jev)는 구간마다 부위별로 동작 하나를 고르고(선택지별 확률), 엔진은 그 확률을 그대로 부위에 입힌다.
 * desc 는 분석기에 그대로 보내는 선택지 설명이므로 영어로 쓴다. 바꾸면 QUESTIONS_VERSION 을 올린다.
 */

export interface ActionSpec {
  /** 화면 표시용 */
  label: string;
  /** 분석기에 보내는 선택지 설명. AI 가 말하는 구간용. */
  desc: string;
  /** 사용자가 말하는 구간(AI 는 듣는 중)용 설명. false 면 듣는 동안에는 고를 수 없다. */
  listen: string | false;
  /** 좌우 한쪽으로 치우치는 동작. 구간마다 방향을 정한다. */
  asymmetric?: boolean;
}

export interface RegionSpec {
  label: string;
  /** 분석기에 보내는 질문의 주어 부분 */
  subject: string;
  /** 움직이지 않는 기본 선택지 */
  rest: string;
  actions: Record<string, ActionSpec>;
}

export const REGIONS = {
  brows: {
    label: '눈썹',
    subject: "the assistant's eyebrows",
    rest: 'relaxed',
    actions: {
      relaxed: {
        label: '편안',
        desc: 'Relaxed, no eyebrow movement. Plain, matter-of-fact lines.',
        listen: 'Calmly listening. Neutral, factual or everyday content.',
      },
      raised: {
        label: '올림',
        desc: 'Both eyebrows raised: surprise, delight, interest, greeting, emphasis on a word.',
        listen: 'The user shares good news, something surprising or something interesting.',
      },
      inner_up: {
        label: '안쪽 올림',
        desc: 'Inner ends raised and drawn together: worry, sadness, apology, sympathy, pleading.',
        listen: 'The user describes a hardship, pain, loss or disappointment: concern and sympathy.',
      },
      lowered: {
        label: '내림',
        desc: 'Eyebrows lowered and drawn together: seriousness, concentration, firmness, displeasure.',
        listen: 'The user describes a serious problem or unfair treatment: focused, taking it seriously.',
      },
      one_raised: {
        label: '한쪽 올림',
        desc: 'One eyebrow raised higher than the other: doubt, skepticism, teasing, a curious question.',
        asymmetric: true,
        listen: 'The user says something doubtful, puzzling or teasing.',
      },
    },
  },
  eyes: {
    label: '눈',
    subject: "the assistant's eyelids",
    rest: 'relaxed',
    actions: {
      relaxed: {
        label: '편안',
        desc: 'Relaxed, ordinary open eyes.',
        listen: 'Ordinary attentive eyes. Neutral, factual or everyday content.',
      },
      wide: {
        label: '크게 뜸',
        desc: 'Eyes opened wide: surprise, excitement, alarm, amazement.',
        listen: 'The user says something astonishing or alarming.',
      },
      smiling: {
        label: '눈웃음',
        desc: 'Eyes narrowed by a real smile: joy, warmth, affection, laughter.',
        listen: 'The user shares happy news, a joke or something endearing.',
      },
      narrowed: {
        label: '가늘게',
        desc: 'Lids tightened without smiling: scrutiny, doubt, thinking hard, displeasure.',
        listen: 'The user explains something complicated or questionable: listening closely.',
      },
      soft: {
        label: '내리뜸',
        desc: 'Lids slightly lowered and heavy: calm tenderness, sadness, regret, tiredness.',
        listen: 'The user shares something sad or painful: a gentle, compassionate look.',
      },
    },
  },
  gaze: {
    label: '시선',
    subject: "the assistant's gaze",
    rest: 'direct',
    actions: {
      direct: {
        label: '정면',
        desc: 'Looking straight at the other person. The default for most lines.',
        listen: 'Attentive eye contact with the user. The default for almost all listening.',
      },
      down: {
        label: '아래',
        desc: 'Looking down: apology, shame, sadness, humility.',
        listen: 'The user criticizes the assistant or points out its mistake: humility.',
      },
      aside: {
        label: '옆',
        desc: 'Glancing to the side: hesitating, searching for words, embarrassment, evasion.',
        listen: 'The user asks something awkward or hard to answer.',
      },
      up: {
        label: '위',
        desc: 'Looking up: recalling, imagining, pondering, mild exasperation.',
        listen: 'The user asks the assistant to recall or work something out.',
      },
    },
  },
  cheeks: {
    label: '볼·코',
    subject: "the assistant's cheeks and nose",
    rest: 'relaxed',
    actions: {
      relaxed: {
        label: '편안',
        desc: 'Relaxed cheeks and nose.',
        listen: 'Relaxed cheeks and nose. Neutral, factual or everyday content.',
      },
      raised: {
        label: '볼 올림',
        desc: 'Cheeks lifted: happiness, delight, a warm or big smile.',
        listen: 'Pleased by the good news, joke or kind words the user shares.',
      },
      nose_wrinkled: {
        label: '코 찡그림',
        desc: 'Nose wrinkled and upper lip lifted: dislike, a playful scrunch, hearty laughter, wincing.',
        listen: 'The user describes something gross or physically painful: a wince. Not for sadness, hardship or disappointment.',
      },
      puffed: {
        label: '볼 부풀림',
        desc: 'Cheeks puffed with air: pouting, sulking, playful frustration, a held-in sigh.',
        listen: false,
      },
    },
  },
  mouth: {
    label: '입',
    subject: "the assistant's mouth, apart from the lip movement of speech itself",
    rest: 'relaxed',
    actions: {
      relaxed: {
        label: '편안',
        desc: 'Relaxed, no particular mouth expression.',
        listen: 'Closed, attentive mouth. The default while listening to neutral, factual or everyday content.',
      },
      smile: {
        label: '미소',
        desc: 'Gentle closed-lip smile: friendliness, warmth, comfort, politeness.',
        listen: 'Friendly, encouraging smile: the user greets, chats pleasantly or says something nice.',
      },
      grin: {
        label: '활짝 웃음',
        desc: 'Broad smile showing teeth: joy, congratulation, excitement, laughter.',
        listen: 'The user shares great news or something really funny.',
      },
      smirk: {
        label: '한쪽 미소',
        desc: 'One-sided smile: teasing, irony, mischief, knowing amusement.',
        asymmetric: true,
        listen: 'Amused: the user is joking or teasing.',
      },
      frown: {
        label: '입꼬리 내림',
        desc: 'Mouth corners pulled down: sadness, disappointment, sympathy for bad news.',
        listen: 'Only for truly devastating news. For ordinary hardship choose pressed instead.',
      },
      pressed: {
        label: '입 다묾',
        desc: 'Lips pressed or rolled in: holding back, regret, awkwardness, careful restraint.',
        listen: 'Lips gently pressed in sympathy: the user describes a hardship or something sad.',
      },
      pout: { label: '내밂', desc: 'Lips pushed forward: sulking, mock complaint, pondering.', listen: false },
      tense: {
        label: '옆으로 당김',
        desc: 'Lips stretched tight sideways: grimace, embarrassment, nervousness, "oops".',
        listen: "A wince: the user describes an embarrassing or painful mishap, or points out the assistant's mistake.",
      },
      open: {
        label: '벌어짐',
        desc: 'Jaw dropped, mouth falling open: astonishment, awe, disbelief.',
        listen: 'The user says something astonishing.',
      },
      skewed: {
        label: '한쪽 치우침',
        desc: 'Mouth shifted to one side: unsure, weighing options, doubtful.',
        asymmetric: true,
        listen: 'The user says something puzzling or asks something hard to answer.',
      },
      firm: {
        label: '굳게 다묾',
        desc: 'Jaw set and lips firm: determination, strong assertion, resolve.',
        listen: false,
      },
      tongue_out: {
        label: '혀 내밂',
        desc: 'Tongue tip sticking out: childlike teasing, being silly. Rare.',
        listen: false,
      },
    },
  },
  head: {
    label: '머리',
    subject: "the assistant's head",
    rest: 'still',
    actions: {
      still: {
        label: '그대로',
        desc: 'No particular head movement.',
        listen: 'Simply listening without head movement.',
      },
      nod: {
        label: '끄덕임',
        desc: 'A nod: agreement, affirmation, acknowledgment, encouraging the other person to go on.',
        listen: 'Acknowledging, understanding or agreeing with what the user says; encouraging them to go on.',
      },
      shake: {
        label: '가로젓기',
        desc: 'A head shake: negation, refusal, disbelief, "no, no".',
        listen: 'Disbelief or a sympathetic "oh no" at what the user says.',
      },
      tilt: {
        label: '갸웃',
        desc: 'Head tilted to the side: curiosity, a question, gentle sympathy.',
        listen: 'Curious about, or gently sympathetic to, what the user says.',
      },
      lowered: {
        label: '숙임',
        desc: 'Head lowered: apology, sadness, shyness, respect.',
        listen: 'The user criticizes the assistant: apologetic.',
      },
      raised: {
        label: '듦',
        desc: 'Chin lifted: pride, confidence, cheerfulness, a bright greeting.',
        listen: 'Perking up at surprising good news.',
      },
    },
  },
} as const satisfies Record<string, RegionSpec>;

export type Region = keyof typeof REGIONS;
export const REGION_KEYS = Object.keys(REGIONS) as Region[];

/** 부위별 선택지 확률. 선택지 이름 → 0~1, 합은 1 근처. */
export type RegionProbs = Record<Region, Record<string, number>>;

export const regionSpec = (region: Region): RegionSpec => REGIONS[region];

/** 한 부위에서 특정 동작만 확률 p 로 켜고 나머지는 기본 선택지에 준 분포 */
export function onlyAction(region: Region, action: string, p: number): Record<string, number> {
  const spec = regionSpec(region);
  const out: Record<string, number> = {};
  for (const name of Object.keys(spec.actions)) out[name] = 0;
  out[spec.rest] = 1 - p;
  if (action !== spec.rest) out[action] = p;
  else out[spec.rest] = 1;
  return out;
}

/** 모든 부위가 기본 선택지인 분포 */
export const restProbs = (): RegionProbs =>
  Object.fromEntries(REGION_KEYS.map((r) => [r, onlyAction(r, regionSpec(r).rest, 1)])) as RegionProbs;

/** 확률이 가장 높은 선택지 */
export function topAction(probs: Record<string, number>): { action: string; p: number } {
  let action = '';
  let p = -1;
  for (const [name, value] of Object.entries(probs)) {
    if (value > p) {
      action = name;
      p = value;
    }
  }
  return { action, p };
}
