/** 파이프라인과 뷰어가 함께 쓰는 타입. 시간 단위는 모두 초. */

import type { Judgment, Speaker } from '@redbridge/faceling-core/judgment';

export { clamp, neutralJudgment } from '@redbridge/faceling-core/judgment';
export type { Analyzer, AnalyzerInput, Judgment, Speaker } from '@redbridge/faceling-core/judgment';

/** 세션 파일 형식 번호. 판단값 구조가 바뀌면 올린다. */
export const SESSION_FORMAT = 2;

/** 사람이 작성하는 대본. public/sessions/<이름>/script.json */
export interface Script {
  title: string;
  turns: ScriptTurn[];
}

export interface ScriptTurn {
  speaker: Speaker;
  text: string;
  /** 세션 폴더 기준 상대 경로. 없으면 audio/NN-speaker.wav 를 찾고, 그것도 없으면 TTS로 만든다. */
  audio?: string;
}

/** 단어와 그 단어가 들리는 시각. 정렬 단계의 산출물. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Segment {
  index: number;
  text: string;
  /** 세션 전체 기준 시각 */
  start: number;
  end: number;
  judgment: Judgment;
}

export interface Turn {
  index: number;
  speaker: Speaker;
  text: string;
  /** 세션 폴더 기준 상대 경로 */
  audio: string;
  start: number;
  end: number;
  words: Word[];
  segments: Segment[];
}

export interface Session {
  format: number;
  title: string;
  name: string;
  analyzer: string;
  aligner: string;
  duration: number;
  turns: Turn[];
  /** 분석기 호출 지연 통계(ms). 캐시에서 읽은 호출은 제외. */
  latency?: { count: number; p50: number; p95: number; max: number };
}
