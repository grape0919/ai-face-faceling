import { REGION_KEYS, regionSpec, type Region } from './regions.js';
import type { BodySpec } from './body.js';
import type { AnalyzerInput } from './judgment.js';

/**
 * 분석기에 던지는 질문 세트. 얼굴 부위마다 "이 구간에서 어떤 동작을 해야 하는가"를 직접 묻는다.
 * AI 가 말하는 구간과 듣는 구간은 질문 문구와 선택지 설명이 따로다. 듣는 구간은 듣는 사람의 반응 기준으로 쓴다.
 * 부위와 선택지는 shared/regions.ts 에 있다. Jev 와 LLM 대조군이 같은 문구를 쓴다.
 * 문구나 선택지를 바꾸면 QUESTIONS_VERSION 을 올린다.
 */
export const QUESTIONS_VERSION = 'r8';

export type Role = 'speaking' | 'listening';
export const ROLES: Role[] = ['speaking', 'listening'];

/** 분석기에 넘기는 상태. 얼굴의 주인은 항상 AI 다. */
export interface FaceState {
  /** speaking: AI 가 current 를 말하는 중. listening: 사용자가 current 를 말하고 AI 는 듣는 중. */
  role: Role;
  context: string;
  current: string;
  /** 같은 사람이 current 바로 뒤에 이어서 하는 말. 있을 때만 넣는다. */
  following?: string;
}

export const toFaceState = (input: AnalyzerInput): FaceState => ({
  role: input.speaker === 'assistant' ? 'speaking' : 'listening',
  context: input.context,
  current: input.current,
  ...(input.following?.trim() ? { following: input.following.trim() } : {}),
});

const INTRO = 'An AI assistant with an animated human-like face is in a voice conversation with a user. ';
const COMMON =
  '`context` holds the preceding lines. `following`, when present, is what the same speaker says right after `current` ' +
  '(it may be cut off). Use both only to understand what `current` means and feels like: a short line such as ' +
  '"Really?" or "Oh" takes its feeling from what comes right after it. Judge the face for `current` itself. ' +
  'The text may be Korean or English.';

export const SCENES: Record<Role, string> = {
  speaking: `${INTRO}The assistant itself is saying \`current\`. ${COMMON}`,
  listening:
    `${INTRO}The user is saying \`current\` and the assistant is silently listening. ` +
    "Judge the assistant's reaction as a warm, attentive listener: it responds to what it hears " +
    "(interest, sympathy, gladness, amusement) and does not copy the user's own facial expression. " +
    `Most everyday or factual lines call for a calm, attentive face. ${COMMON}`,
};

export const regionInstructions = (region: Region, role: Role, body?: BodySpec): string => {
  const prompt = regionSpec(region).prompt;
  if (prompt) {
    const scene = prompt.replace('{body}', body?.describe ?? 'a character.');
    return `${scene} ${COMMON.replace('Judge the face for', 'Judge the movement for')} Pick the single best option.`;
  }
  return role === 'speaking'
    ? `${SCENES.speaking} To look natural and emotionally fitting, what should ${regionSpec(region).subject} do while saying \`current\`? ` +
      'Pick the single best option. Pick the neutral option when the line carries no clear feeling.'
    : `${SCENES.listening} What should ${regionSpec(region).subject} do while listening to \`current\`? ` +
      'Pick the single best option. Pick the neutral option unless the line clearly calls for a reaction.';
};

/**
 * 선택지 이름 → 설명. 듣는 구간에서는 듣는 동안 고를 수 없는 동작이 빠진다.
 * 몸 명세가 있으면 그 몸에 맞춘다: 움직임(move)은 그 몸이 할 수 있는 것만 그 몸의 설명으로 묻고,
 * 다른 동작도 그 몸에서 뜻이 달라지는 것은 명세의 설명을 쓴다.
 */
export function regionCriteria(region: Region, role: Role, body?: BodySpec): Record<string, string> {
  const spec = regionSpec(region);
  const out: Record<string, string> = {};
  for (const [name, a] of Object.entries(spec.actions)) {
    const moves = region === 'move' ? (body?.moves as Record<string, string> | undefined) : undefined;
    if (moves && name !== spec.rest && !(name in moves)) continue;
    const custom = moves ? moves[name] : body?.actions?.[`${region}.${name}`];
    const text = role === 'speaking' ? (custom ?? a.desc) : a.listen;
    if (text !== false) out[name] = text;
  }
  return out;
}

export const intensityQuestion = (role: Role): { instructions: string; criteria: string[] } => ({
  instructions:
    role === 'speaking'
      ? `${SCENES.speaking} How strong should the assistant's facial expression be while saying \`current\`?`
      : `${SCENES.listening} How strong should the assistant's facial reaction be while listening to \`current\`?`,
  criteria: [
    'None: a neutral, resting face',
    'Slight: a faint trace of expression',
    'Moderate: a clear but ordinary conversational expression',
    'Strong: an obvious, animated expression',
    'Very strong: an intense, fully expressed emotion',
  ],
});

export { REGION_KEYS };
