/**
 * @faceling/rigs 의 진입점. LiveFace.update() 가 내는 얼굴 한 장(ARKit 52 값, 머리 각도, 시선)을 three.js 얼굴에 입힌다.
 * 모든 얼굴은 apply(pose) 하나로 움직인다.
 *
 * 기본 얼굴(Faceling), 로봇, 강아지의 생김새는 CC BY-NC 4.0 이다(패키지의 LICENSE.md). 상업 제품의 얼굴로 쓰려면 허락이 필요하다.
 * VrmRig 는 @pixiv/three-vrm 으로 불러온 VRM 모델을 쓸 때만 필요하다.
 */
export { FacelingRig } from './faceling.js';
export { RobotRig } from './robot.js';
export { DogRig } from './dog.js';
export { VrmRig } from './vrm.js';
