import type { Analyzer } from '../judgment.js';
import { QUESTIONS_VERSION } from '../questions.js';
import { createQuestionAnalyzer, env, type Answers, type Questions } from './ask.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
/** 후보 가운데 가장 빨랐고 고른 동작이 Jev 와 가까웠다(scripts/compare-judges.ts 로 다시 재 볼 수 있다). */
export const DEFAULT_OPENAI_JUDGE_MODEL = 'gpt-5.4-mini';
/** 기본 모델은 추론 모델이라, 생각 없이 바로 답하게 한다 */
const DEFAULT_REASONING_EFFORT = 'none';

export interface OpenAIAnalyzerOptions {
  /** OpenAI API 키. 없으면 환경 변수 OPENAI_API_KEY 를 쓴다. */
  apiKey?: string;
  /** 판단에 쓸 모델. 없으면 환경 변수 OPENAI_JUDGE_MODEL, 그것도 없으면 DEFAULT_OPENAI_JUDGE_MODEL. 작고 빠른 모델이 맞다. */
  model?: string;
  /**
   * 추론 모델의 생각하는 정도(reasoning_effort). 절 하나의 판단은 빨라야 하므로 가장 낮은 값을 준다.
   * 없으면 환경 변수 OPENAI_JUDGE_REASONING_EFFORT 를 쓴다. 그것도 없으면 기본 모델에는 'none' 을 보내고,
   * 다른 모델에는 보내지 않는다(이 값을 받지 않는 모델이 있다).
   */
  reasoningEffort?: string;
}

const SYSTEM =
  'You judge how an AI character should move during one moment of a voice conversation. ' +
  'The user message is a JSON object with `role`, `context`, `current` and sometimes `following`. ' +
  'Answer every question below about that moment and return only the JSON object.\n' +
  '- A score question lists levels from 0 upward. Answer with the level number that fits; decimals between levels are allowed.\n' +
  '- A choice question lists options. Answer with the name of the single best option.\n' +
  'Each question carries its own instructions; follow them. The JSON keys are the short codes shown in brackets.';

/** 모델이 고른 선택지에 싣는 확률. 모델은 고른 것만 답하므로(답이 짧아야 빠르다) 확률은 정해 둔 값을 쓴다. */
export const OPENAI_CHOICE_WEIGHT = 0.9;
/** 답의 키로 쓰는 짧은 이름. 질문 이름을 그대로 쓰면 답이 길어져 느려진다. */
const code = (index: number): string => `q${index}`;

/** 질문 세트를 모델에 보낼 글과, 답의 모양을 묶는 JSON 스키마로 옮긴다 */
function prepare(questions: Questions): { system: string; schema: Record<string, unknown> } {
  const blocks: string[] = [];
  const properties: Record<string, unknown> = {};
  Object.entries(questions).forEach(([name, q], index) => {
    if (q.type === 'score') {
      blocks.push(`## [${code(index)}] ${name} (score 0-${q.criteria.length - 1})\n${q.instructions}\n${q.criteria.map((c, i) => `  ${i} = ${c}`).join('\n')}`);
      properties[code(index)] = { type: 'number' };
    } else {
      const options = Object.entries(q.criteria);
      blocks.push(`## [${code(index)}] ${name} (choice)\n${q.instructions}\n${options.map(([option, desc]) => `  - ${option}: ${desc}`).join('\n')}`);
      properties[code(index)] = { type: 'string', enum: options.map(([option]) => option) };
    }
  });
  return {
    system: `${SYSTEM}\n\n${blocks.join('\n\n')}`,
    schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

/**
 * OpenAI 모델로 판단하는 분석기. Jev 키가 없을 때의 대체다. Jev 와 똑같은 질문을 한 요청에 묻고,
 * 답을 구조화 출력(JSON 스키마)으로 받는다. 브라우저에서 사용자의 자기 키로 직접 부를 수도 있다.
 *
 * Jev 와 다른 점:
 * - Jev 는 선택지마다 확률을 내지만, 이 모델은 고른 선택지 하나만 낸다(답이 짧아야 빠르다).
 *   그래서 고른 선택지에만 정해 둔 확률(OPENAI_CHOICE_WEIGHT)이 실린다.
 * - 느리다. 판단 하나에 1초 넘게 걸려(Jev 는 0.2~0.3초), 짧은 말에는 표정이 늦거나 빠질 수 있다.
 */
export function createOpenAIAnalyzer(options: OpenAIAnalyzerOptions = {}): Analyzer {
  const key = options.apiKey || env('OPENAI_API_KEY');
  if (!key) throw new Error('openai 분석기에는 OPENAI_API_KEY 가 필요합니다 (환경 변수나 apiKey 옵션)');
  const model = options.model || env('OPENAI_JUDGE_MODEL') || DEFAULT_OPENAI_JUDGE_MODEL;
  const effort =
    options.reasoningEffort ?? env('OPENAI_JUDGE_REASONING_EFFORT') ?? (model === DEFAULT_OPENAI_JUDGE_MODEL ? DEFAULT_REASONING_EFFORT : undefined);
  const prepared = new Map<string, ReturnType<typeof prepare>>();

  return createQuestionAnalyzer('openai', `${model}:${QUESTIONS_VERSION}`, async (state, questions, setKey) => {
    let set = prepared.get(setKey);
    if (!set) prepared.set(setKey, (set = prepare(questions)));
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(effort && { reasoning_effort: effort }),
        // 질문은 늘 같은 글이라 앞에 두어 캐시가 되게 하고, 바뀌는 대화는 뒤에 둔다
        messages: [
          { role: 'system', content: set.system },
          { role: 'user', content: JSON.stringify(state) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'judgment', strict: true, schema: set.schema } },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI 판단 요청 실패 ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI 판단 응답이 비어 있습니다');
    const raw = JSON.parse(content) as Record<string, number | string>;

    const answers: Answers = {};
    Object.entries(questions).forEach(([name, q], index) => {
      const value = raw[code(index)];
      if (q.type === 'score' && typeof value === 'number') {
        answers[name] = { type: 'score', score: Math.min(q.criteria.length - 1, Math.max(0, value)), confidence: 1 };
      } else if (q.type === 'choice' && typeof value === 'string' && value in q.criteria) {
        answers[name] = { type: 'choice', choice: value, confidence: OPENAI_CHOICE_WEIGHT, probabilities: { [value]: OPENAI_CHOICE_WEIGHT } };
      }
    });
    return answers;
  });
}
