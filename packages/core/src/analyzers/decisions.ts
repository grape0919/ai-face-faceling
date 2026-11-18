import type { Analyzer } from '../judgment.js';
import { QUESTIONS_VERSION } from '../questions.js';
import { createQuestionAnalyzer, env, type Answers, type Questions } from './ask.js';

const ENDPOINT = 'https://api.openai.com/v1/decisions';
/** Decisions API 가 받는 유일한 모델이다(2026-11 기준). */
export const DEFAULT_DECISIONS_MODEL = 'gpt-6-luna';

export interface DecisionsAnalyzerOptions {
  /** OpenAI API 키. 없으면 환경 변수 OPENAI_API_KEY 를 쓴다. */
  apiKey?: string;
  /** 모델 이름. 없으면 환경 변수 OPENAI_DECISIONS_MODEL, 그것도 없으면 DEFAULT_DECISIONS_MODEL. */
  model?: string;
}

const INPUT_INTRO =
  'One moment of a voice conversation, as a JSON object with `role`, `context`, `current` and sometimes `following`. ' +
  'Answer each question about this moment.\n\n';

/** Decisions API 의 질문 모양 */
type DecisionQuestion =
  | { name: string; type: 'choice'; instructions: string; choices: Array<{ value: string; description: string }> }
  | { name: string; type: 'score'; instructions: string; levels: Array<{ label: string; description: string }> };

/** Decisions API 의 답 모양. 확률은 선택지(또는 단계)마다 배열로 온다. */
interface DecisionAnswer {
  type: string;
  name: string;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Array<{ value: string | number; probability: number }>;
}

const toDecisionQuestions = (questions: Questions): DecisionQuestion[] =>
  Object.entries(questions).map(([name, q]) =>
    q.type === 'score'
      ? { name, type: 'score', instructions: q.instructions, levels: q.criteria.map((description, i) => ({ label: `level ${i}`, description })) }
      : { name, type: 'choice', instructions: q.instructions, choices: Object.entries(q.criteria).map(([value, description]) => ({ value, description })) },
  );

/**
 * OpenAI Decisions API 로 판단하는 분석기. Jev 처럼 고르기·점수 질문에 선택지별 확률로 답하는 API 라,
 * Jev 와 같은 질문을 그대로 보내고 확률도 그대로 엔진에 넣는다. 브라우저에서 사용자의 자기 키로 직접 부를 수도 있다.
 */
export function createDecisionsAnalyzer(options: DecisionsAnalyzerOptions = {}): Analyzer {
  const key = options.apiKey || env('OPENAI_API_KEY');
  if (!key) throw new Error('decisions 분석기에는 OPENAI_API_KEY 가 필요합니다 (환경 변수나 apiKey 옵션)');
  const model = options.model || env('OPENAI_DECISIONS_MODEL') || DEFAULT_DECISIONS_MODEL;
  const prepared = new Map<string, DecisionQuestion[]>();

  return createQuestionAnalyzer('decisions', `${model}:${QUESTIONS_VERSION}`, async (state, questions, setKey) => {
    let set = prepared.get(setKey);
    if (!set) prepared.set(setKey, (set = toDecisionQuestions(questions)));
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: INPUT_INTRO + JSON.stringify(state), questions: set }),
    });
    if (!res.ok) throw new Error(`Decisions 판단 요청 실패 ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { answers?: DecisionAnswer[] };

    const answers: Answers = {};
    for (const a of body.answers ?? []) {
      const q = questions[a.name];
      if (!q || a.type !== q.type) continue;
      const probabilities: Record<string, number> = {};
      if (q.type === 'choice') for (const p of a.probabilities ?? []) probabilities[String(p.value)] = p.probability;
      answers[a.name] = {
        type: a.type,
        ...(a.choice !== undefined && { choice: a.choice }),
        ...(a.score !== undefined && { score: a.score }),
        ...(a.confidence !== undefined && { confidence: a.confidence }),
        ...(q.type === 'choice' && { probabilities }),
      };
    }
    return answers;
  });
}
