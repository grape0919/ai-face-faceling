import { restProbs, type RegionProbs } from './regions';

export type Speaker = 'assistant' | 'user';

/**
 * 분석기가 한 구간에 대해 내는 판단. 얼굴 부위별로 어떤 동작을 할지와 표정의 세기를 담는다.
 * 얼굴은 항상 AI 의 것이다. AI 가 말하는 구간이면 말하는 표정, 사용자가 말하는 구간이면 듣는 반응이다.
 */
export interface Judgment {
  /** 표정의 세기. 0(거의 없음)~1(매우 강함) */
  intensity: number;
  /** 부위별 선택지 확률 */
  regions: RegionProbs;
}

export interface AnalyzerInput {
  speaker: Speaker;
  /** 직전 구간들. 참고용. */
  context: string;
  /** 판단 대상 구간 */
  current: string;
}

export interface Analyzer {
  name: string;
  /** 캐시 무효화용. 질문이나 프롬프트를 바꾸면 올린다. */
  version: string;
  analyze(input: AnalyzerInput): Promise<Judgment>;
}

export const neutralJudgment = (): Judgment => ({ intensity: 0, regions: restProbs() });

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
