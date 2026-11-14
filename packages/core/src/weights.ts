import { clamp, type Judgment } from './judgment.js';
import { REGION_KEYS, regionSpec, type Region } from './regions.js';

/**
 * 엔진이 보간하는 단위. 부위의 동작 하나이며, 좌우가 있는 동작은 방향별로 나뉜다.
 * key 예: "brows.raised", "mouth.smirk@L"
 */
export interface Variant {
  key: string;
  region: Region;
  action: string;
  side: 'L' | 'R' | null;
}

/** 머리의 끄덕임과 가로젓기는 유지되는 자세가 아니라 순간 동작으로 처리한다. */
const TRANSIENT = new Set(['head.nod', 'head.shake']);

export const VARIANTS: Variant[] = REGION_KEYS.flatMap((region) => {
  const spec = regionSpec(region);
  return Object.entries(spec.actions).flatMap(([action, a]): Variant[] => {
    if (action === spec.rest || TRANSIENT.has(`${region}.${action}`)) return [];
    if (!a.asymmetric) return [{ key: `${region}.${action}`, region, action, side: null }];
    return (['L', 'R'] as const).map((side) => ({ key: `${region}.${action}@${side}`, region, action, side }));
  });
});

export type Weights = Record<string, number>;
export const zeroWeights = (): Weights => Object.fromEntries(VARIANTS.map((v) => [v.key, 0]));

/**
 * 선택지 확률 → 동작 세기. 확률이 낮은 선택지는 버리고, 0.7 이상이면 온전히 준다.
 * 한 부위에서 둘째로 높은 선택지도 약하게 섞일 수 있다.
 */
export const PROB_FLOOR = 0.2;
export const PROB_FULL = 0.7;
export const actionWeight = (p: number): number => clamp((p - PROB_FLOOR) / (PROB_FULL - PROB_FLOOR));

/** 표정 세기 판단 → 전체 배율 */
export const amplitude = (intensity: number): number => 0.25 + 0.75 * clamp(intensity);

/** 판단값을 동작별 목표 세기로 옮긴다. 분석기가 고른 것을 그대로 따른다. */
export function targetWeights(j: Judgment, side: 'L' | 'R', scale = 1): Weights {
  const amp = amplitude(j.intensity) * scale;
  const out = zeroWeights();
  for (const v of VARIANTS) {
    if (v.side && v.side !== side) continue;
    out[v.key] = actionWeight(j.regions[v.region]?.[v.action] ?? 0) * amp;
  }
  return out;
}

export interface Gesture {
  type: 'nod' | 'shake' | 'flash';
  t: number;
  dur: number;
  amp: number;
}
