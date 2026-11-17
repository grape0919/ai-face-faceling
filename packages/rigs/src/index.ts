/**
 * @redbridge/faceling-rigs 의 진입점. LiveFace.update() 가 내는 프레임을 three.js 캐릭터에 입힌다.
 * 모든 리그는 같은 형태(Rig)다: 자기 몸이 무엇을 할 수 있는지 선언하고(body), apply(frame) 하나로 움직인다.
 * 얼굴 리그는 프레임의 ARKit 52 값과 머리 각도, 시선을, 얼굴이 없는 로봇팔(ArmRig)은 expression(몸과 상관없는 표현)을 읽는다.
 *
 * 기본 얼굴(Faceling), 로봇, 강아지, 로봇팔의 생김새는 CC BY-NC 4.0 이다(패키지의 LICENSE.md). 상업 제품에 쓰려면 허락이 필요하다.
 * VrmRig 는 @pixiv/three-vrm 으로 불러온 VRM 모델을 쓸 때만 필요하다.
 */
export type { Rig } from './rig.js';
export { FACE_BODY, DOG_BODY, ARM_BODY } from './bodies.js';
export { FacelingRig } from './faceling.js';
export { RobotRig } from './robot.js';
export { DogRig } from './dog.js';
export { ArmRig } from './arm.js';
export { bodyFeelings, type Feelings } from '@redbridge/faceling-core/feelings';
export { VrmRig } from './vrm.js';
