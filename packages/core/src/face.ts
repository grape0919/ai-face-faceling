import { clamp } from './judgment.js';
import { add, applyActions, emptyPose, gazeShapes, type FacePose } from './mapping.js';
import type { Expression } from './compositor.js';

/**
 * 얼굴 출력 어댑터. 몸과 상관없는 표현 한 프레임(Expression)을 ARKit 52 값, 머리 각도, 시선으로 옮긴다.
 * 얼굴이 없는 몸(로봇팔 등)은 이 함수를 거치지 않고 Expression 을 직접 자기 관절로 옮긴다.
 */

/** 입이 벌어지면 줄어들어야 하는, 입을 다물어야 만들 수 있는 모양들 */
const CLOSED_MOUTH = [
  'mouthPressLeft', 'mouthPressRight', 'mouthRollUpper', 'mouthRollLower', 'mouthClose',
  'mouthPucker', 'mouthShrugUpper', 'mouthShrugLower', 'cheekPuff', 'tongueOut',
];

/** 머리와 시선 채널 → 각도. 방향은 보는 사람 기준이다(yaw 와 시선 x 의 양수가 화면 오른쪽). */
const HEAD_GAZE: Record<string, (pose: FacePose, v: number, t: number) => void> = {
  headUp: (p, v) => void (p.head.pitch -= 0.3 * v),
  headDown: (p, v) => void (p.head.pitch += 0.32 * v),
  headLeft: (p, v) => void (p.head.yaw -= 0.45 * v),
  headRight: (p, v) => void (p.head.yaw += 0.45 * v),
  headTilt: (p, v) => void (p.head.roll += 0.2 * v),
  headNod: (p, v) => void (p.head.pitch += 0.14 * v),
  headShake: (p, v, t) => void (p.head.yaw += 0.12 * v * Math.sin(t * 14)),
  gazeUp: (p, v) => void (p.gaze.y += 0.6 * v),
  gazeDown: (p, v) => void (p.gaze.y -= 0.6 * v),
  gazeLeft: (p, v) => void (p.gaze.x -= 0.6 * v),
  gazeRight: (p, v) => void (p.gaze.x += 0.6 * v),
};

export function facePose(e: Expression): FacePose {
  const { listening, thinking, speaking } = e.turn;
  const pose = emptyPose();

  // 1. 분석기가 고른 부위별 동작
  applyActions(pose, e.weights);
  // 부위별 수치 판단의 채널. 머리와 시선은 각도로 옮기고, 나머지는 이름 그대로 싣는다
  // (ARKit 이름은 얼굴 모양이 되고, earsUp 같은 그 몸만의 채널은 그것을 아는 리그가 읽는다).
  for (const [name, value] of Object.entries(e.channels)) {
    const turn = HEAD_GAZE[name];
    if (turn) turn(pose, value, e.t);
    else add(pose, name, value);
  }

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
  pose.head.pitch += e.gesture.nod;
  pose.head.yaw += e.gesture.shake;
  add(pose, 'browInnerUp', e.gesture.flash);
  add(pose, 'browOuterUpLeft', e.gesture.flash);
  add(pose, 'browOuterUpRight', e.gesture.flash);
  // 윙크: 한쪽 눈을 감고, 같은 쪽 볼과 입꼬리가 따라 올라간다
  for (const [side, w] of [['Left', e.gesture.winkL], ['Right', e.gesture.winkR]] as const) {
    if (w <= 0) continue;
    add(pose, `eyeBlink${side}`, w);
    add(pose, `cheekSquint${side}`, 0.45 * w);
    add(pose, `mouthSmile${side}`, 0.35 * w);
    add(pose, `browDown${side}`, 0.2 * w);
  }

  // 4. 립싱크. 말하는 동안 입은 소리가 먼저다. 다물어야 만들 수 있는 모양은 입이 벌어진 만큼 줄인다.
  const { jaw, funnel, stretch } = e.mouth;
  if (speaking > 0.05) {
    const open = clamp(jaw * 2);
    for (const name of CLOSED_MOUTH) pose.shapes[name] = (pose.shapes[name] ?? 0) * (1 - open);
    for (const name of ['mouthFrownLeft', 'mouthFrownRight']) pose.shapes[name] = (pose.shapes[name] ?? 0) * (1 - 0.4 * open);
    add(pose, 'jawOpen', 0.7 * jaw);
    add(pose, 'mouthLowerDownLeft', 0.3 * jaw);
    add(pose, 'mouthLowerDownRight', 0.3 * jaw);
    add(pose, 'mouthUpperUpLeft', 0.12 * jaw);
    add(pose, 'mouthUpperUpRight', 0.12 * jaw);
    add(pose, 'mouthFunnel', 0.5 * funnel);
    add(pose, 'mouthPucker', 0.25 * funnel);
    add(pose, 'mouthStretchLeft', 0.4 * stretch);
    add(pose, 'mouthStretchRight', 0.4 * stretch);
  }

  // 5. 깜빡임. 눈을 크게 뜬 동안에는 덜 감는다.
  const wide = pose.shapes.eyeWideLeft ?? 0;
  add(pose, 'eyeBlinkLeft', e.blink * (1 - 0.5 * wide));
  add(pose, 'eyeBlinkRight', e.blink * (1 - 0.5 * wide));

  // 6. 미세한 머리 움직임. 말할 때와 표정이 강할 때 커진다.
  const t = e.t;
  const sway = 0.012 * (1 + 0.8 * speaking + 0.6 * e.energy);
  pose.head.pitch += sway * (Math.sin(t * 0.9 + 1) + 0.5 * Math.sin(t * 2.3));
  pose.head.yaw += sway * 1.4 * (Math.sin(t * 0.6) + 0.4 * Math.sin(t * 1.7 + 2));
  pose.head.roll += sway * 0.6 * Math.sin(t * 0.75 + 0.5);

  pose.gaze.x = clamp(pose.gaze.x, -1, 1);
  pose.gaze.y = clamp(pose.gaze.y, -1, 1);
  gazeShapes(pose);
  for (const name of Object.keys(pose.shapes)) pose.shapes[name] = clamp(pose.shapes[name] ?? 0);
  return pose;
}
