import type { VRM } from '@pixiv/three-vrm';
import { Vector3, type Object3D } from 'three';
import { ARKIT_52, type FacePose } from '@redbridge/faceling-core/mapping';
import { FACE_BODY } from './bodies.js';
import type { Rig } from './rig.js';

const avg = (shapes: Record<string, number>, base: string): number =>
  ((shapes[`${base}Left`] ?? 0) + (shapes[`${base}Right`] ?? 0)) / 2;

/**
 * ARKit 52 blendshape 프레임을 VRM 모델에 입힌다.
 * 모델에 ARKit 이름의 표정이 있으면(이른바 perfect sync 모델) 그대로 넣고,
 * 없으면 VRM 표준 표정(happy, sad, aa 등)으로 뭉뚱그려 옮긴다. 뒤쪽은 표현력이 크게 떨어진다.
 */
export class VrmRig implements Rig {
  /** 소문자 ARKit 이름 → 모델의 실제 표정 이름 */
  private readonly arkit = new Map<string, string>();
  readonly mode: 'arkit' | 'preset';
  /** 이 몸이 할 수 있는 움직임. LiveDirector.body 에 넣는다. */
  readonly body = FACE_BODY;
  /** ARKit 52개 중 이 모델이 가진 것 */
  readonly supported: string[];
  private readonly known = new Set<string>();

  constructor(
    private readonly vrm: VRM,
    private readonly lookTarget: Object3D,
    private readonly lookOrigin: { x: number; y: number; z: number },
  ) {
    for (const expression of vrm.expressionManager?.expressions ?? []) {
      this.known.add(expression.expressionName);
      this.arkit.set(expression.expressionName.toLowerCase(), expression.expressionName);
    }
    this.supported = ARKIT_52.filter((name) => this.arkit.has(name.toLowerCase()));
    this.mode = this.arkit.has('mouthsmileleft') && this.arkit.has('browinnerup') ? 'arkit' : 'preset';
    if (vrm.lookAt) vrm.lookAt.target = lookTarget;

    // 기본 자세는 팔을 벌린 T 자세다. 팔을 내린다.
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    if (left) left.rotation.z = -1.25;
    if (right) right.rotation.z = 1.25;
  }

  private set(name: string, value: number): void {
    if (this.known.has(name)) this.vrm.expressionManager?.setValue(name, Math.min(1, Math.max(0, value)));
  }

  /** 장면에 넣을 물체(모델 전체) */
  get object(): Object3D {
    return this.vrm.scene;
  }

  /** 머리가 화면에 꽉 차는 카메라 위치. 모델마다 키가 달라 머리뼈의 위치에서 잰다. */
  get view(): { position: Vector3; target: Vector3 } {
    const head = new Vector3();
    this.vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(head);
    return { position: new Vector3(head.x, head.y + 0.04, head.z + 1.15), target: new Vector3(head.x, head.y + 0.02, head.z) };
  }

  /** 머리카락과 옷의 흔들림(스프링 본) 등 모델 자체의 움직임을 진행시킨다 */
  update(dt: number): void {
    this.vrm.update(dt);
  }

  apply(pose: FacePose): void {
    const s = pose.shapes;
    if (this.mode === 'arkit') {
      for (const [lower, actual] of this.arkit) {
        if (lower.length > 2 && !PRESETS.has(actual)) this.vrm.expressionManager?.setValue(actual, 0);
      }
      for (const [name, value] of Object.entries(s)) {
        // 시선은 아래에서 VRM 의 시선 기능으로 처리한다. 눈 blendshape 로 또 넣으면 두 번 움직인다.
        if (name.startsWith('eyeLook')) continue;
        const actual = this.arkit.get(name.toLowerCase());
        if (actual) this.vrm.expressionManager?.setValue(actual, value);
      }
    } else {
      this.set('happy', avg(s, 'mouthSmile'));
      this.set('sad', Math.max(avg(s, 'mouthFrown') * 1.4, (s.browInnerUp ?? 0) * 0.7 - avg(s, 'eyeWide')));
      // 표준 표정의 surprised 는 입까지 크게 벌어지므로 약하게 쓴다
      this.set('surprised', avg(s, 'eyeWide') * 0.7);
      this.set('angry', avg(s, 'browDown') * 0.6);
      // 두 눈이 함께 감긴 만큼은 blink 로, 한쪽만 더 감긴 만큼(윙크)은 그쪽 눈에만 넣는다
      const left = s.eyeBlinkLeft ?? 0;
      const right = s.eyeBlinkRight ?? 0;
      if (this.known.has('blinkLeft') && this.known.has('blinkRight')) {
        const both = Math.min(left, right);
        this.set('blink', both);
        this.set('blinkLeft', left - both);
        this.set('blinkRight', right - both);
      } else {
        this.set('blink', (left + right) / 2);
      }
      this.set('aa', s.jawOpen ?? 0);
      this.set('oh', s.mouthFunnel ?? 0);
      this.set('ou', s.mouthPucker ?? 0);
      this.set('ih', avg(s, 'mouthStretch'));
    }

    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    const neck = this.vrm.humanoid.getNormalizedBoneNode('neck');
    head?.rotation.set(pose.head.pitch * 0.7, pose.head.yaw * 0.7, pose.head.roll * 0.7);
    neck?.rotation.set(pose.head.pitch * 0.3, pose.head.yaw * 0.3, pose.head.roll * 0.3);

    this.lookTarget.position.set(
      this.lookOrigin.x + pose.gaze.x * 0.45,
      this.lookOrigin.y + pose.gaze.y * 0.35,
      this.lookOrigin.z,
    );
  }
}

const PRESETS = new Set([
  'happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral',
  'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight',
  'lookUp', 'lookDown', 'lookLeft', 'lookRight',
]);
