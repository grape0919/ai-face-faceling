import { VARIANTS, type Weights } from './weights.js';

/** 엔진 출력의 한 프레임. shapes 는 ARKit 52 blendshape 이름을 쓴다. 각도는 라디안. */
export interface FacePose {
  shapes: Record<string, number>;
  /** pitch 양수 = 고개 숙임, yaw 양수 = 캐릭터의 왼쪽(보는 사람에게는 화면 오른쪽)으로 돌림, roll 양수 = 갸웃 */
  head: { pitch: number; yaw: number; roll: number };
  /** 시선. -1~1, x 양수 = 옆으로, y 양수 = 위로 */
  gaze: { x: number; y: number };
}

export const emptyPose = (): FacePose => ({ shapes: {}, head: { pitch: 0, yaw: 0, roll: 0 }, gaze: { x: 0, y: 0 } });

export const add = (pose: FacePose, name: string, value: number): void => {
  pose.shapes[name] = (pose.shapes[name] ?? 0) + value;
};

/** ARKit 의 52개 blendshape 이름 */
export const ARKIT_52 = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel',
  'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker',
  'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
] as const;

interface ActionPose {
  /**
   * blendshape 이름 → 계수. 이름 끝의 * 는 Left/Right 양쪽.
   * {S} 는 동작이 치우친 쪽, {W} 는 반대쪽(좌우가 있는 동작에서만).
   */
  shapes: Record<string, number>;
  head?: Partial<FacePose['head']>;
  gaze?: Partial<FacePose['gaze']>;
}

/**
 * 부위별 동작 → 얼굴. 어떤 동작을 할지는 분석기가 고르고, 여기서는 그 동작이 어떻게 생겼는지만 정한다.
 * 계수는 초안이며, 영상을 보면서 고친다.
 */
export const ACTION_POSES: Record<string, ActionPose> = {
  // 눈썹
  'brows.raised': { shapes: { browInnerUp: 0.6, 'browOuterUp*': 0.7 } },
  'brows.inner_up': { shapes: { browInnerUp: 0.95, 'browDown*': 0.1 } },
  'brows.lowered': { shapes: { 'browDown*': 0.75, 'eyeSquint*': 0.12, 'noseSneer*': 0.08 } },
  'brows.one_raised': { shapes: { 'browOuterUp{S}': 0.85, browInnerUp: 0.25, 'browDown{W}': 0.45 } },

  // 눈
  'eyes.wide': { shapes: { 'eyeWide*': 0.75 } },
  'eyes.smiling': { shapes: { 'eyeSquint*': 0.55, 'cheekSquint*': 0.4 } },
  'eyes.narrowed': { shapes: { 'eyeSquint*': 0.7, 'browDown*': 0.15 } },
  'eyes.soft': { shapes: { 'eyeBlink*': 0.22, 'eyeSquint*': 0.1 } },

  // 시선. 눈이 가는 쪽으로 머리도 조금 따라간다.
  'gaze.down': { shapes: { 'eyeBlink*': 0.1 }, gaze: { y: -0.5 }, head: { pitch: 0.03 } },
  'gaze.aside': { shapes: {}, gaze: { x: 0.55, y: -0.05 }, head: { yaw: 0.04 } },
  'gaze.up': { shapes: { 'eyeWide*': 0.1 }, gaze: { x: 0.2, y: 0.5 }, head: { pitch: -0.02 } },

  // 볼·코
  'cheeks.raised': { shapes: { 'cheekSquint*': 0.6, 'eyeSquint*': 0.12 } },
  'cheeks.nose_wrinkled': { shapes: { 'noseSneer*': 0.7, 'mouthUpperUp*': 0.25, 'browDown*': 0.2, 'cheekSquint*': 0.3 } },
  'cheeks.puffed': { shapes: { cheekPuff: 0.75, mouthPucker: 0.2, mouthClose: 0.1 } },

  // 입
  'mouth.smile': { shapes: { 'mouthSmile*': 0.6, 'mouthDimple*': 0.15, 'cheekSquint*': 0.15 } },
  'mouth.grin': {
    shapes: { 'mouthSmile*': 0.9, 'mouthUpperUp*': 0.25, 'mouthLowerDown*': 0.25, jawOpen: 0.1, 'cheekSquint*': 0.3, 'mouthDimple*': 0.2 },
  },
  'mouth.smirk': {
    shapes: { 'mouthSmile{S}': 0.7, 'mouthSmile{W}': 0.15, 'mouthDimple{S}': 0.4, 'mouth{S}': 0.2, 'cheekSquint{S}': 0.3 },
  },
  'mouth.frown': { shapes: { 'mouthFrown*': 0.65, mouthShrugLower: 0.3 } },
  'mouth.pressed': { shapes: { 'mouthPress*': 0.6, mouthRollUpper: 0.3, mouthRollLower: 0.35, mouthClose: 0.1 } },
  'mouth.pout': { shapes: { mouthPucker: 0.6, mouthFunnel: 0.2, mouthShrugLower: 0.4, mouthShrugUpper: 0.2 } },
  'mouth.tense': { shapes: { 'mouthStretch*': 0.6, 'mouthDimple*': 0.3, 'mouthPress*': 0.2 } },
  'mouth.open': { shapes: { jawOpen: 0.35, mouthFunnel: 0.15 } },
  'mouth.skewed': { shapes: { 'mouth{S}': 0.55, 'jaw{S}': 0.2, 'mouthPress{S}': 0.3 } },
  'mouth.firm': { shapes: { jawForward: 0.4, 'mouthPress*': 0.4, mouthShrugUpper: 0.25, 'mouthFrown*': 0.15 } },
  'mouth.tongue_out': { shapes: { tongueOut: 0.7, jawOpen: 0.2, 'mouthSmile*': 0.3 } },

  // 머리 (끄덕임과 가로젓기는 순간 동작이라 여기 없다)
  'head.tilt': { shapes: {}, head: { roll: 0.09 } },
  'head.lowered': { shapes: {}, head: { pitch: 0.09 }, gaze: { y: -0.1 } },
  'head.raised': { shapes: {}, head: { pitch: -0.07 } },

  // 부탁받은 고개 동작. 감정에서 나오는 머리 움직임보다 훨씬 크고, 눈도 그쪽을 본다. 방향은 보는 사람 기준이다.
  'turn.up': { shapes: {}, head: { pitch: -0.3 }, gaze: { y: 0.3 } },
  'turn.down': { shapes: {}, head: { pitch: 0.32 }, gaze: { y: -0.3 } },
  'turn.left': { shapes: {}, head: { yaw: -0.45 }, gaze: { x: -0.3 } },
  'turn.right': { shapes: {}, head: { yaw: 0.45 }, gaze: { x: 0.3 } },
};

const sideName = (side: 'L' | 'R'): string => (side === 'L' ? 'Left' : 'Right');

/** 동작별 세기를 얼굴에 더한다. */
export function applyActions(pose: FacePose, weights: Weights): void {
  for (const v of VARIANTS) {
    const w = weights[v.key] ?? 0;
    if (w < 0.001) continue;
    const def = ACTION_POSES[`${v.region}.${v.action}`];
    if (!def) continue;
    const strong = sideName(v.side ?? 'L');
    const weak = sideName(v.side === 'R' ? 'L' : 'R');
    const sign = v.side === 'R' ? -1 : 1;

    for (const [pattern, coef] of Object.entries(def.shapes)) {
      if (pattern.endsWith('*')) {
        const base = pattern.slice(0, -1);
        add(pose, `${base}Left`, coef * w);
        add(pose, `${base}Right`, coef * w);
      } else {
        add(pose, pattern.replace('{S}', strong).replace('{W}', weak), coef * w);
      }
    }
    if (def.head) {
      pose.head.pitch += (def.head.pitch ?? 0) * w;
      pose.head.yaw += (def.head.yaw ?? 0) * w * sign;
      pose.head.roll += (def.head.roll ?? 0) * w * sign;
    }
    if (def.gaze) {
      pose.gaze.x += (def.gaze.x ?? 0) * w * sign;
      pose.gaze.y += (def.gaze.y ?? 0) * w;
    }
  }
}

/**
 * 시선 값을 ARKit 의 eyeLook 8개로도 낸다. x 양수는 얼굴 기준 왼쪽을 본다.
 * VRM 처럼 시선을 따로 처리하는 모델에서는 리그가 이 값을 쓰지 않는다.
 */
export function gazeShapes(pose: FacePose): void {
  const { x, y } = pose.gaze;
  const left = Math.max(0, x);
  const right = Math.max(0, -x);
  pose.shapes.eyeLookUpLeft = pose.shapes.eyeLookUpRight = Math.max(0, y);
  pose.shapes.eyeLookDownLeft = pose.shapes.eyeLookDownRight = Math.max(0, -y);
  pose.shapes.eyeLookOutLeft = left;
  pose.shapes.eyeLookInRight = left;
  pose.shapes.eyeLookInLeft = right;
  pose.shapes.eyeLookOutRight = right;
}
