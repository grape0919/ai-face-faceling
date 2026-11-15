import type { BodySpec } from '@faceling/core/body';

/**
 * 들어 있는 리그들의 몸 명세. 리그가 "나는 이런 몸이고 이런 움직임을 할 수 있다"고 선언하는 곳이다.
 * 판단 질문은 이 명세에서 만들어지고(LiveDirector.body, 서버의 bodies 옵션), 결과로 나온 move.* 를
 * 실제 움직임으로 옮기는 것은 각 리그가 한다. 새 몸을 붙일 때는 이런 명세 하나와 리그 하나를 만들면 된다.
 * three.js 를 쓰지 않으므로 서버에서도 '@faceling/rigs/bodies' 로 가져올 수 있다.
 */

/** 얼굴 캐릭터(페이스링, 로봇, 강아지, VRM). 움직임은 고개로 한다. */
export const FACE_BODY: BodySpec = {
  name: 'face',
  describe: 'a face. It has a head it can lift, lower and turn, but no arms or hands.',
  moves: {
    up: 'Lifting its head or looking up on purpose right now.',
    down: 'Lowering its head or looking down on purpose right now.',
    left: 'Turning its head or face to the left right now.',
    right: 'Turning its head or face to the right right now.',
    home: 'Turning back to face the user straight on right now because it was asked to or says so: "facing you again", "back to the front".',
  },
};

/** 얼굴 없는 작업대 로봇팔. 움직임은 팔로 하고, 윙크는 손목 불빛으로 대신한다. */
export const ARM_BODY: BodySpec = {
  name: 'arm',
  describe: 'a robot arm on a workbench, with a shoulder, elbow, wrist, claw and a light on its wrist. It has no face.',
  moves: {
    right: 'Reaching or swinging the arm to the right right now.',
    left: 'Reaching or swinging the arm to the left right now.',
    up: 'Raising the arm up right now: "up!", a cheer, a high reach.',
    down: 'Lowering the arm or reaching down right now.',
    forward: 'Reaching toward the user right now: offering something, "here you go", a high five, pointing at them.',
    wave: 'Waving the arm right now: hello, goodbye, cheering someone on.',
    home: 'Returning to its resting position right now because it was asked to or says so: "back to the middle", "okay, relaxing", "arm down, done".',
  },
  actions: {
    'eyes.wink':
      'The light on its wrist blinks off and on like a wink: the faceless arm is actually doing its version of a wink right now, e.g. it was asked to wink and blinks its light instead ("my light goes wink!"). Not for merely describing or recalling a wink it already did.',
  },
};
