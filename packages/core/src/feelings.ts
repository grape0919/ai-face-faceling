import type { Expression } from './compositor.js';

/**
 * 표현을 몇 가지 느낌으로 묶는다. 얼굴이 없는 몸(로봇팔, 조명, 꼬리 …)이 감정을 자기 몸짓으로 옮길 때 쓴다.
 * 판단 결과의 이름은 얼굴 부위지만, 여기서는 그 뜻만 읽는다: 눈썹 안쪽 올림과 입꼬리 내림은 슬픔, 미소와 눈웃음은 기쁨.
 */

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

/** 좌우가 있는 동작은 양쪽을 더한다 */
const w = (e: Expression, key: string): number => (e.weights[key] ?? 0) + (e.weights[`${key}@L`] ?? 0) + (e.weights[`${key}@R`] ?? 0);
/** 좌우가 있는 동작이 어느 쪽으로 치우쳤는지. 왼쪽 +, 오른쪽 - */
const side = (e: Expression, key: string): number => (e.weights[`${key}@L`] ?? 0) - (e.weights[`${key}@R`] ?? 0);

/** 표현 → 느낌별 세기(대부분 0~1, tilt 는 방향에 따라 -1~1). 계수는 초안이며, 화면을 보면서 고친다. */
export function bodyFeelings(e: Expression) {
  const happy = clamp(Math.max(w(e, 'mouth.smile'), w(e, 'mouth.grin') * 1.1, w(e, 'cheeks.raised'), w(e, 'eyes.smiling')));
  const excited = clamp(happy * (w(e, 'brows.raised') * 0.8 + w(e, 'mouth.grin') * 0.8 + w(e, 'eyes.wide') * 0.5));
  const sad = clamp(
    Math.max(w(e, 'brows.inner_up'), w(e, 'mouth.frown'), w(e, 'mouth.pout') * 0.6) * (1 - 0.6 * happy) +
      w(e, 'gaze.down') * 0.35 +
      w(e, 'head.lowered') * 0.5 +
      w(e, 'eyes.soft') * 0.2,
  );
  const surprised = clamp(Math.max(w(e, 'eyes.wide'), w(e, 'mouth.open') * 0.8) * (1 - 0.5 * happy));
  const tense = clamp(
    Math.max(w(e, 'brows.lowered'), w(e, 'eyes.narrowed'), w(e, 'mouth.pressed'), w(e, 'mouth.tense'), w(e, 'mouth.firm'), w(e, 'cheeks.nose_wrinkled')),
  );
  // 고개 기울임은 좌우 구분이 없으므로 기본 방향을 쓰고, 한쪽 눈썹·비뚤어진 입은 그쪽으로 기울인다
  const tiltSide = side(e, 'brows.one_raised') + side(e, 'mouth.skewed') + side(e, 'mouth.smirk');
  const tilt = clamp(w(e, 'head.tilt') + w(e, 'brows.one_raised') * 0.7 + w(e, 'mouth.skewed') * 0.5 + w(e, 'mouth.smirk') * 0.4);
  const playful = clamp(w(e, 'mouth.tongue_out') + w(e, 'cheeks.puffed') * 0.6);
  return {
    happy,
    excited,
    sad,
    surprised,
    tense,
    tilt: tilt * (tiltSide < -0.05 ? -1 : 1),
    lookAside: w(e, 'gaze.aside'),
    lookUp: w(e, 'gaze.up') + w(e, 'head.raised') * 0.5,
    lookDown: w(e, 'gaze.down'),
    playful,
  };
}

/** bodyFeelings() 가 내는 느낌들 */
export type Feelings = ReturnType<typeof bodyFeelings>;
