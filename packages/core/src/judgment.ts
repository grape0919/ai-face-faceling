import type { BodySpec } from './body.js';
import type { ChannelJudgment } from './channels.js';
import { restProbs, type RegionProbs } from './regions.js';

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
  /**
   * 부위별 수치 판단(mode: 'channels')의 결과. 채널마다 세기와 유지 시간이 들어 있다.
   * 이것이 있으면 엔진은 intensity 와 regions 대신 이것으로 움직인다.
   */
  channels?: ChannelJudgment;
  /** 부위별 수치 판단에서, AI 가 쉬는 자세로 돌아가는 중인지. 붙잡아 둔 자세를 푼다. */
  reset?: boolean;
}

export interface AnalyzerInput {
  speaker: Speaker;
  /** 직전 구간들. 참고용. */
  context: string;
  /** 판단 대상 구간 */
  current: string;
  /**
   * 같은 사람이 current 바로 뒤에 이어서 하는 말. 도착한 만큼만 들어 있다(끝까지가 아닐 수 있다).
   * "정말요?"처럼 뒷말을 들어야 뜻이 정해지는 구간을 판단할 때 쓴다. 없으면 비워 둔다.
   */
  following?: string;
  /**
   * 이 캐릭터의 몸 명세. 있으면 AI 가 말하는 구간에서 그 몸이 할 수 있는 움직임을 함께 묻고,
   * 그 몸에서 뜻이 달라지는 동작은 명세의 설명으로 묻는다. 없으면 감정 표현만 판단한다.
   */
  body?: BodySpec;
  /**
   * 판단 방식. 'channels' 이고 몸 명세에 채널이 있으면 부위별 수치로 판단한다(실험).
   * 없거나 'choices' 면 부위마다 선택지에서 동작을 고른다.
   */
  mode?: 'choices' | 'channels';
}

export interface Analyzer {
  name: string;
  /** 캐시 무효화용. 질문이나 프롬프트를 바꾸면 올린다. */
  version: string;
  analyze(input: AnalyzerInput): Promise<Judgment>;
}

export const neutralJudgment = (): Judgment => ({ intensity: 0, regions: restProbs() });

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
