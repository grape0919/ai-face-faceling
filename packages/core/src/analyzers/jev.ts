import type { Analyzer } from '../judgment.js';
import { QUESTIONS_VERSION } from '../questions.js';
import { createQuestionAnalyzer, env, type Answers } from './ask.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export interface JevAnalyzerOptions {
  /** TypeSafe API 키. 없으면 환경 변수 TYPESAFE_API_KEY 를 쓴다. 브라우저에 두지 말 것. */
  apiKey?: string;
  /** Jev 모델 이름. 없으면 환경 변수 JEV_MODEL, 그것도 없으면 'jev-latest'. */
  model?: string;
}

/**
 * Jev(TypeSafe AI) 분석기. 얼굴 부위마다 Choice 질문 하나, 표정 세기에 Score 질문 하나를 한 요청에 보낸다.
 * Jev 가 부위별 동작을 직접 고르고, 선택지별 확률이 그대로 엔진에 들어간다.
 * 요청·응답 형식은 docs.typesafe.ai 의 Score, Choice 문서를 따랐다. 질문과 답 읽기는 ask.ts 에 있다.
 */
export function createJevAnalyzer(options: JevAnalyzerOptions = {}): Analyzer {
  const key = options.apiKey || env('TYPESAFE_API_KEY');
  if (!key) throw new Error('jev 분석기에는 TYPESAFE_API_KEY 가 필요합니다 (환경 변수나 apiKey 옵션)');
  const model = options.model || env('JEV_MODEL') || 'jev-latest';

  return createQuestionAnalyzer('jev', `${model}:${QUESTIONS_VERSION}`, async (state, questions) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
    });
    if (!res.ok) throw new Error(`Jev 요청 실패 ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { answers: Answers }).answers;
  });
}
