import { REGION_KEYS, regionSpec, type RegionProbs } from '../regions.js';
import { clamp, type Analyzer, type AnalyzerInput, type Judgment } from '../judgment.js';
import {
  QUESTIONS_VERSION,
  intensityQuestion,
  regionCriteria,
  regionInstructions,
  toFaceState,
  type Role,
} from '../questions.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
}
interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
interface JevResponse {
  model: string;
  answers: Record<string, ScoreAnswer | ChoiceAnswer | { type: string }>;
}

export interface JevAnalyzerOptions {
  /** TypeSafe API 키. 없으면 환경 변수 TYPESAFE_API_KEY 를 쓴다. 브라우저에 두지 말 것. */
  apiKey?: string;
  /** Jev 모델 이름. 없으면 환경 변수 JEV_MODEL, 그것도 없으면 'jev-latest'. */
  model?: string;
}

/** Node 등 process 가 있는 곳에서만 환경 변수를 읽는다. 브라우저에서는 undefined. */
const env = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

/**
 * Jev(TypeSafe AI) 분석기. 얼굴 부위마다 Choice 질문 하나, 표정 세기에 Score 질문 하나를 한 요청에 보낸다.
 * Jev 가 부위별 동작을 직접 고르고, 선택지별 확률이 그대로 엔진에 들어간다.
 * 요청·응답 형식은 docs.typesafe.ai 의 Score, Choice 문서를 따랐다.
 */
export function createJevAnalyzer(options: JevAnalyzerOptions = {}): Analyzer {
  const key = options.apiKey || env('TYPESAFE_API_KEY');
  if (!key) throw new Error('jev 분석기에는 TYPESAFE_API_KEY 가 필요합니다 (환경 변수나 apiKey 옵션)');
  const model = options.model || env('JEV_MODEL') || 'jev-latest';

  // 말하는 구간과 듣는 구간은 질문 세트가 따로다. 듣는 구간에서 빠진 선택지는 아래에서 확률 0 으로 채운다.
  const questionsFor = (role: Role): Record<string, unknown> => {
    const questions: Record<string, unknown> = { intensity: { type: 'score', ...intensityQuestion(role) } };
    for (const region of REGION_KEYS) {
      questions[region] = {
        type: 'choice',
        instructions: regionInstructions(region, role),
        criteria: regionCriteria(region, role),
      };
    }
    return questions;
  };
  const questions: Record<Role, Record<string, unknown>> = {
    speaking: questionsFor('speaking'),
    listening: questionsFor('listening'),
  };

  return {
    name: 'jev',
    version: `${model}:${QUESTIONS_VERSION}`,
    async analyze(input: AnalyzerInput): Promise<Judgment> {
      const state = toFaceState(input);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions: questions[state.role] }),
      });
      if (!res.ok) throw new Error(`Jev 요청 실패 ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as JevResponse;

      const intensity = json.answers.intensity as ScoreAnswer | undefined;
      if (!intensity || intensity.type !== 'score' || typeof intensity.score !== 'number') {
        throw new Error(`Jev 응답에 intensity 답이 없습니다: ${JSON.stringify(json.answers.intensity)}`);
      }

      const regions = {} as RegionProbs;
      for (const region of REGION_KEYS) {
        const a = json.answers[region] as ChoiceAnswer | undefined;
        if (!a || a.type !== 'choice' || !a.probabilities) {
          throw new Error(`Jev 응답에 choice 답이 없습니다: ${region} ${JSON.stringify(a)}`);
        }
        const probs: Record<string, number> = {};
        for (const name of Object.keys(regionSpec(region).actions)) probs[name] = clamp(a.probabilities[name] ?? 0);
        regions[region] = probs;
      }

      // Score 는 0~4 단계의 확률 가중 평균
      return { intensity: clamp(intensity.score / 4), regions };
    },
  };
}
