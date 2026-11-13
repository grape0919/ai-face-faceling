import { actionWeight, amplitude, targetWeights, type Gesture, type Weights } from '@faceling/core/weights';
import type { Segment, Session } from '../shared/types';

export * from '@faceling/core/weights';

/**
 * 동작 수준.
 * L0: 오디오만 (립싱크, 턴 상태, 절차적 움직임)
 * L1: + AI 가 말하는 구간의 부위별 표정
 * L2: + 사용자가 말하는 구간의 듣기 반응
 */
export type Level = 'L0' | 'L1' | 'L2';
export const LEVELS: Level[] = ['L0', 'L1', 'L2'];

/** 좌우가 있는 동작의 방향. 구간마다 정해지며, 왼쪽이 더 자주 나온다. */
export const sideOf = (segment: Segment): 'L' | 'R' => ((segment.index * 7 + 3) % 10 < 7 ? 'L' : 'R');

export interface Cue {
  t: number;
  until: number;
  weights: Weights;
  kind: 'speak' | 'react';
  segment: Segment;
}

/** 듣는 동안의 표정은 말할 때보다 조금 약하게 건다. */
const REACT_SCALE = 0.85;

/** 세션과 수준으로부터 표정 예약 목록을 만든다. 시각 순으로 정렬되어 있다. */
export function buildCues(session: Session, level: Level): Cue[] {
  if (level === 'L0') return [];
  const cues: Cue[] = [];
  session.turns.forEach((turn, i) => {
    if (turn.speaker === 'assistant') {
      for (const seg of turn.segments) {
        cues.push({
          t: seg.start,
          until: seg.end + 0.4,
          weights: targetWeights(seg.judgment, sideOf(seg)),
          kind: 'speak',
          segment: seg,
        });
      }
    } else if (level === 'L2') {
      // 반응은 절의 뜻이 드러나는 끝 무렵에 시작하고, AI 가 말을 시작할 때까지 이어진다
      const nextStart = session.turns[i + 1]?.start ?? turn.end + 1;
      for (const seg of turn.segments) {
        const t = Math.max(seg.start + 0.5, seg.end - 0.4);
        cues.push({
          t,
          until: nextStart + 0.3,
          weights: targetWeights(seg.judgment, sideOf(seg), REACT_SCALE),
          kind: 'react',
          segment: seg,
        });
      }
    }
  });
  return cues.sort((a, b) => a.t - b.t);
}

/** 순간적인 머리·눈썹 동작 목록. */
export function buildGestures(session: Session, level: Level): Gesture[] {
  const out: Gesture[] = [];
  const fromJudgment = (seg: Segment, t: number): void => {
    const amp = amplitude(seg.judgment.intensity);
    const nod = actionWeight(seg.judgment.regions.head?.nod ?? 0);
    const shake = actionWeight(seg.judgment.regions.head?.shake ?? 0);
    if (nod > 0.3) out.push({ type: 'nod', t, dur: 0.5, amp: 0.09 * nod * amp });
    if (shake > 0.3) out.push({ type: 'shake', t, dur: 0.9, amp: 0.1 * shake * amp });
  };

  for (const turn of session.turns) {
    if (turn.speaker === 'assistant') {
      // 말을 시작할 때 눈썹이 살짝 올라간다
      out.push({ type: 'flash', t: turn.start, dur: 0.4, amp: 0.3 });
      if (level === 'L0') continue;
      for (const seg of turn.segments) fromJudgment(seg, seg.start + 0.15);
    } else if (level === 'L2') {
      // 분석기가 고른 끄덕임·가로젓기를 절이 끝날 무렵에 한다
      for (const seg of turn.segments) fromJudgment(seg, seg.end - 0.2);
    } else {
      // 내용을 모르는 수준에서는 일정한 간격으로만 끄덕인다
      for (let t = turn.start + 1.5; t < turn.end - 0.3; t += 3.2) {
        out.push({ type: 'nod', t, dur: 0.5, amp: 0.06 });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
