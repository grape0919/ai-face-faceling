/**
 * @faceling/rigs 의 진입점. LiveFace.update() 가 내는 얼굴 한 장(ARKit 52 값, 머리 각도, 시선)을 three.js 얼굴에 입힌다.
 * 모든 얼굴은 apply(pose) 하나로 움직인다.
 * 얼굴이 없는 로봇팔(ArmRig)은 같은 프레임의 expression(몸과 상관없는 표현)을 관절 각도로 옮긴다.
 *
 * 기본 얼굴(Faceling), 로봇, 강아지, 로봇팔의 생김새는 CC BY-NC 4.0 이다(패키지의 LICENSE.md). 상업 제품에 쓰려면 허락이 필요하다.
 * VrmRig 는 @pixiv/three-vrm 으로 불러온 VRM 모델을 쓸 때만 필요하다.
 */
export { FACE_BODY, ARM_BODY } from './bodies.js';
export { FacelingRig } from './faceling.js';
export { RobotRig } from './robot.js';
export { DogRig } from './dog.js';
export { ArmRig, bodyFeelings } from './arm.js';
export { VrmRig } from './vrm.js';
