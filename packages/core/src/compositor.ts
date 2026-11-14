import { clamp } from './judgment.js';
import { add, applyActions, emptyPose, gazeShapes, type FacePose } from './mapping.js';
import type { Region } from './regions.js';
import { VARIANTS, zeroWeights, type Gesture, type Weights } from './weights.js';

/** 재생 중인 AI 음성에서 뽑은 입 모양 값. 0~1. */
export interface MouthFeatures {
  jaw: number;
  funnel: number;
  stretch: number;
}

export type TurnState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface CompositorInput {
  turn: TurnState;
  /** 지금 걸려 있는 표정의 목표 세기. 없으면 무표정으로 돌아간다. */
  target: Weights | null;
  /** 그 표정이 시작된 시각. 시작 직후의 강조에 쓴다. */
  targetSince: number;
  /** 순간 동작. 시각 순서일 필요는 없다. */
  gestures: readonly Gesture[];
  mouth: MouthFeatures | null;
  /** 깜빡임 정도 0~1 */
  blink: number;
}

/**
 * 부위별로 동작이 목표에 다가가는 시간 상수(초). 생기는 것은 빠르게, 사라지는 것은 천천히.
 * 눈썹과 눈은 빨리 반응하고, 볼과 입꼬리는 늦게 따라오고 오래 남는다.
 */
const DYNAMICS: Record<Region, { attack: number; release: number }> = {
  brows: { attack: 0.12, release: 0.6 },
  eyes: { attack: 0.14, release: 0.7 },
  gaze: { attack: 0.22, release: 0.5 },
  cheeks: { attack: 0.22, release: 1.0 },
  mouth: { attack: 0.2, release: 1.1 },
  head: { attack: 0.3, release: 0.8 },
};
/** 표정이 시작될 때 눈썹과 눈이 잠깐 더 크게 움직였다가 가라앉는다. */
const ONSET_BOOST = 0.3;
const ONSET_DECAY = 0.3;
const ONSET_REGIONS = new Set<Region>(['brows', 'eyes']);
/** 입이 벌어지면 줄어들어야 하는, 입을 다물어야 만들 수 있는 모양들 */
const CLOSED_MOUTH = [
  'mouthPressLeft', 'mouthPressRight', 'mouthRollUpper', 'mouthRollLower', 'mouthClose',
  'mouthPucker', 'mouthShrugUpper', 'mouthShrugLower', 'cheekPuff', 'tongueOut',
];
const TURN_BLEND = 0.25;
export const BLINK_DURATION = 0.16;

const approach = (current: number, target: number, dt: number, tau: number): number =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

/** 0→1→0 으로 오르내리는 종 모양 */
export const bell = (x: number): number => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));

/**
 * 표정 레이어 합성. 오프라인 재생과 실시간 대화가 함께 쓴다.
 * 무엇을 언제 걸지는 바깥에서 정하고, 여기서는 부드럽게 따라가며 한 프레임의 얼굴을 만든다.
 */
export class Compositor {
  readonly weights = zeroWeights();
  private readonly turnWeight: Record<TurnState, number> = { idle: 1, listening: 0, thinking: 0, speaking: 0 };

  /** t 는 초 단위 시각, dt 는 지난 프레임부터 흐른 시간. dt 를 크게 주면 목표값으로 바로 맞춰진다. */
  step(t: number, dt: number, input: CompositorInput): FacePose {
    const onset = input.target ? 1 + ONSET_BOOST * Math.exp(-Math.max(0, t - input.targetSince) / ONSET_DECAY) : 1;

    let energy = 0;
    for (const v of VARIANTS) {
      const base = input.target?.[v.key] ?? 0;
      const target = ONSET_REGIONS.has(v.region) ? base * onset : base;
      const current = this.weights[v.key] ?? 0;
      const tau = target > current ? DYNAMICS[v.region].attack : DYNAMICS[v.region].release;
      const next = approach(current, target, dt, tau);
      this.weights[v.key] = next;
      energy = Math.max(energy, next);
    }
    for (const state of Object.keys(this.turnWeight) as TurnState[]) {
      this.turnWeight[state] = approach(this.turnWeight[state], state === input.turn ? 1 : 0, dt, TURN_BLEND);
    }
    const { listening, thinking, speaking } = this.turnWeight;

    const pose = emptyPose();

    // 1. 분석기가 고른 부위별 동작
    applyActions(pose, this.weights);

    // 2. 턴 상태
    add(pose, 'browInnerUp', 0.08 * listening);
    pose.head.pitch += 0.025 * listening;
    add(pose, 'mouthPressLeft', 0.15 * thinking);
    add(pose, 'mouthPressRight', 0.15 * thinking);
    add(pose, 'eyeSquintLeft', 0.1 * thinking);
    add(pose, 'eyeSquintRight', 0.1 * thinking);
    pose.head.yaw += 0.06 * thinking;
    pose.gaze.x += 0.35 * thinking;
    pose.gaze.y += 0.3 * thinking;

    // 3. 순간 동작
    for (const g of input.gestures) {
      const k = bell((t - g.t) / g.dur) * g.amp;
      if (k === 0) continue;
      if (g.type === 'nod') pose.head.pitch += k;
      else if (g.type === 'shake') pose.head.yaw += k * Math.sin(((t - g.t) / g.dur) * Math.PI * 4);
      else {
        add(pose, 'browInnerUp', k);
        add(pose, 'browOuterUpLeft', k);
        add(pose, 'browOuterUpRight', k);
      }
    }

    // 4. 립싱크. 말하는 동안 입은 소리가 먼저다. 다물어야 만들 수 있는 모양은 입이 벌어진 만큼 줄인다.
    const mouth = input.mouth;
    if (mouth && speaking > 0.05) {
      const jaw = mouth.jaw * speaking;
      const open = clamp(jaw * 2);
      for (const name of CLOSED_MOUTH) pose.shapes[name] = (pose.shapes[name] ?? 0) * (1 - open);
      for (const name of ['mouthFrownLeft', 'mouthFrownRight']) pose.shapes[name] = (pose.shapes[name] ?? 0) * (1 - 0.4 * open);
      add(pose, 'jawOpen', 0.7 * jaw);
      add(pose, 'mouthLowerDownLeft', 0.3 * jaw);
      add(pose, 'mouthLowerDownRight', 0.3 * jaw);
      add(pose, 'mouthUpperUpLeft', 0.12 * jaw);
      add(pose, 'mouthUpperUpRight', 0.12 * jaw);
      add(pose, 'mouthFunnel', 0.5 * mouth.funnel * speaking);
      add(pose, 'mouthPucker', 0.25 * mouth.funnel * speaking);
      add(pose, 'mouthStretchLeft', 0.4 * mouth.stretch * speaking);
      add(pose, 'mouthStretchRight', 0.4 * mouth.stretch * speaking);
    }

    // 5. 깜빡임. 눈을 크게 뜬 동안에는 덜 감는다.
    const wide = pose.shapes.eyeWideLeft ?? 0;
    add(pose, 'eyeBlinkLeft', input.blink * (1 - 0.5 * wide));
    add(pose, 'eyeBlinkRight', input.blink * (1 - 0.5 * wide));

    // 6. 미세한 머리 움직임. 말할 때와 표정이 강할 때 커진다.
    const sway = 0.012 * (1 + 0.8 * speaking + 0.6 * energy);
    pose.head.pitch += sway * (Math.sin(t * 0.9 + 1) + 0.5 * Math.sin(t * 2.3));
    pose.head.yaw += sway * 1.4 * (Math.sin(t * 0.6) + 0.4 * Math.sin(t * 1.7 + 2));
    pose.head.roll += sway * 0.6 * Math.sin(t * 0.75 + 0.5);

    pose.gaze.x = clamp(pose.gaze.x, -1, 1);
    pose.gaze.y = clamp(pose.gaze.y, -1, 1);
    gazeShapes(pose);
    for (const name of Object.keys(pose.shapes)) pose.shapes[name] = clamp(pose.shapes[name] ?? 0);
    return pose;
  }
}
