import type { BodySpec } from '@redbridge/faceling-core/body';
import type { Frame } from '@redbridge/faceling-core/live';
import type { Object3D, Vector3 } from 'three';

/**
 * 모든 리그의 공통 형태. 화면 쪽은 몸의 종류를 가리지 않고 이것만 보고 다루면 된다.
 *
 *   director.body = rig.body;            // 이 몸이 할 수 있는 움직임을 판단에 묻는다
 *   scene.add(rig.object);
 *   camera.position.copy(rig.view.position); camera.lookAt(rig.view.target);
 *   rig.apply(face.update(now, mouth));  // 매 프레임
 *   rig.update?.(dt);
 */
export interface Rig {
  /** 이 몸이 어떤 것이고 무엇을 할 수 있는지 */
  readonly body: BodySpec;
  /** 장면에 넣을 물체 */
  readonly object: Object3D;
  /** 이 몸이 잘 보이는 카메라 위치와 바라볼 곳(세로 화각 24도 기준) */
  readonly view: { position: Vector3; target: Vector3 };
  /** 한 프레임을 입힌다. 얼굴 리그는 ARKit 값을, 얼굴이 없는 몸은 expression 을 읽는다. */
  apply(frame: Frame): void;
  /** 프레임 사이에 흐른 시간으로 움직이는 것(머리카락 흔들림 등)이 있으면 */
  update?(dt: number): void;
  dispose?(): void;
}
