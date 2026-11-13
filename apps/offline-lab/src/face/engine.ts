import { BLINK_DURATION, Compositor, bell, type MouthFeatures, type TurnState } from '@faceling/core/compositor';
import type { FacePose } from '@faceling/core/mapping';
import type { Segment, Session } from '../shared/types';
import { buildCues, buildGestures, type Cue, type Gesture, type Level, type Weights } from './cues';

export type { MouthFeatures, TurnState };

export interface FaceFrame extends FacePose {
  debug: { turn: TurnState; weights: Weights; cue: Cue | null; segment: Segment | null };
}

/** 시드가 같으면 수준이 달라도 깜빡임이 같은 시각에 일어난다(영상 비교의 공정성). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 오프라인 실험용 표정 엔진.
 * 세션 전체를 미리 알고 있으므로 표정을 정확한 재생 시각에 건다(최선의 조건).
 * 레이어 합성은 실시간판과 같은 Compositor 를 쓴다.
 */
export class FaceEngine {
  readonly cues: Cue[];
  readonly gestures: Gesture[];
  private readonly blinks: number[] = [];
  private readonly compositor = new Compositor();
  private lastT = 0;

  constructor(
    private readonly session: Session,
    readonly level: Level,
    seed = 7,
  ) {
    this.cues = buildCues(session, level);
    this.gestures = buildGestures(session, level);
    const random = mulberry32(seed);
    for (let t = 1 + random() * 2; t < session.duration; t += 2.5 + random() * 3) this.blinks.push(t);
  }

  turnAt(t: number): TurnState {
    const turns = this.session.turns;
    for (const [i, turn] of turns.entries()) {
      if (t >= turn.start && t < turn.end) return turn.speaker === 'assistant' ? 'speaking' : 'listening';
      const next = turns[i + 1];
      if (next && t >= turn.end && t < next.start) {
        return turn.speaker === 'user' && next.speaker === 'assistant' ? 'thinking' : 'idle';
      }
    }
    return 'idle';
  }

  cueAt(t: number): Cue | null {
    let active: Cue | null = null;
    for (const cue of this.cues) {
      if (cue.t > t) break;
      active = cue;
    }
    return active && t <= active.until ? active : null;
  }

  /** t 는 세션 재생 시각. 매 프레임 호출한다. */
  update(t: number, mouth: MouthFeatures | null): FaceFrame {
    let dt = t - this.lastT;
    this.lastT = t;
    // 되감거나 건너뛰면 목표값으로 바로 맞춘다
    if (dt < 0 || dt > 0.5) dt = 10;

    const turn = this.turnAt(t);
    const cue = this.cueAt(t);
    let blink = 0;
    for (const b of this.blinks) {
      if (b > t) break;
      blink = Math.max(blink, bell((t - b) / BLINK_DURATION));
    }

    const pose = this.compositor.step(t, dt, {
      turn,
      target: cue?.weights ?? null,
      targetSince: cue?.t ?? 0,
      gestures: this.gestures,
      mouth,
      blink,
    });
    return { ...pose, debug: { turn, weights: { ...this.compositor.weights }, cue, segment: cue?.segment ?? null } };
  }
}
