import type { FacePose } from './mapping.js';
import { facePose } from './face.js';
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
 * 몸과 상관없는 표현 한 프레임. 엔진의 공통 출력이다.
 * 얼굴은 facePose() 로 ARKit 52 값을 만들고, 얼굴이 없는 몸은 이 값을 직접 자기 관절로 옮긴다.
 */
export interface Expression {
  /** 초 단위 시각 */
  t: number;
  /**
   * 부위별 동작의 지금 세기 0~1. 키는 "부위.동작" 이며 좌우가 있는 동작은 "@L"/"@R" 이 붙는다.
   * 이름은 얼굴 부위지만 뜻은 감정 표현이다(예: brows.inner_up = 안쓰러움, head.tilt = 갸웃).
   */
  weights: Weights;
  /** 턴 상태가 섞인 정도. 상태가 바뀔 때 부드럽게 넘어간다. */
  turn: Record<TurnState, number>;
  /**
   * 순간 동작의 지금 값. nod 는 숙이는 각도(라디안), shake 는 좌우로 젓는 각도(부호 있음),
   * flash 는 눈썹을 번쩍 올리는 세기, winkL/winkR 은 그쪽 눈을 감는 세기 0~1(캐릭터 기준 왼쪽·오른쪽).
   */
  gesture: { nod: number; shake: number; flash: number; winkL: number; winkR: number };
  /** 말하는 동안의 입 모양. 말하는 정도가 이미 곱해져 있어, 말하지 않으면 0 이다. */
  mouth: MouthFeatures;
  /** 깜빡임 0~1 */
  blink: number;
  /** 지금 가장 강한 동작의 세기 0~1 */
  energy: number;
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
  arm: { attack: 0.35, release: 0.7 },
};
/** 표정이 시작될 때 눈썹과 눈이 잠깐 더 크게 움직였다가 가라앉는다. */
const ONSET_BOOST = 0.3;
const ONSET_DECAY = 0.3;
const ONSET_REGIONS = new Set<Region>(['brows', 'eyes']);
const TURN_BLEND = 0.25;
export const BLINK_DURATION = 0.16;

const approach = (current: number, target: number, dt: number, tau: number): number =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

/** 0→1→0 으로 오르내리는 종 모양 */
export const bell = (x: number): number => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));

/**
 * 표현 레이어 합성. 오프라인 재생과 실시간 대화가 함께 쓴다.
 * 무엇을 언제 걸지는 바깥에서 정하고, 여기서는 부드럽게 따라가며 한 프레임의 표현을 만든다.
 */
export class Compositor {
  readonly weights = zeroWeights();
  private readonly turnWeight: Record<TurnState, number> = { idle: 1, listening: 0, thinking: 0, speaking: 0 };

  /**
   * 몸과 상관없는 표현 한 프레임을 만든다.
   * t 는 초 단위 시각, dt 는 지난 프레임부터 흐른 시간. dt 를 크게 주면 목표값으로 바로 맞춰진다.
   */
  express(t: number, dt: number, input: CompositorInput): Expression {
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

    const gesture = { nod: 0, shake: 0, flash: 0, winkL: 0, winkR: 0 };
    for (const g of input.gestures) {
      const x = (t - g.t) / g.dur;
      const k = bell(x) * g.amp;
      if (k === 0) continue;
      if (g.type === 'nod') gesture.nod += k;
      else if (g.type === 'shake') gesture.shake += k * Math.sin(x * Math.PI * 4);
      else if (g.type === 'wink') {
        // 빨리 감고, 잠깐 멈췄다가, 천천히 뜬다
        const closed = g.amp * (x < 0.2 ? x / 0.2 : x < 0.55 ? 1 : 1 - (x - 0.55) / 0.45);
        if (g.side === 'R') gesture.winkR += closed;
        else gesture.winkL += closed;
      } else gesture.flash += k;
    }
    gesture.winkL = Math.min(1, gesture.winkL);
    gesture.winkR = Math.min(1, gesture.winkR);

    const speaking = this.turnWeight.speaking;
    const m = input.mouth;
    const mouth =
      m && speaking > 0.05
        ? { jaw: m.jaw * speaking, funnel: m.funnel * speaking, stretch: m.stretch * speaking }
        : { jaw: 0, funnel: 0, stretch: 0 };

    return {
      t,
      weights: { ...this.weights },
      turn: { ...this.turnWeight },
      gesture,
      mouth,
      blink: input.blink,
      energy: Math.min(1, energy),
    };
  }

  /** 표현을 만들고 바로 얼굴(ARKit 52)로 옮긴다. */
  step(t: number, dt: number, input: CompositorInput): FacePose {
    return facePose(this.express(t, dt, input));
  }
}
