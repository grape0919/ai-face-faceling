import type { REGIONS } from './regions.js';

/** 일부러 하는 움직임의 이름(move 부위의 선택지에서 기본 선택지를 뺀 것) */
export type MoveName = Exclude<keyof (typeof REGIONS)['move']['actions'], 'rest'>;

/**
 * 몸 명세. 캐릭터가 어떤 몸을 가졌고 무엇을 할 수 있는지 적은 것이다.
 * 엔진은 몸의 종류(얼굴, 로봇팔, …)를 모른다. 이 명세만 보고 판단 질문을 만들고, 판단 결과는 몸과 상관없는
 * 이름(move.left 등)으로 나온다. 그 이름을 실제 움직임으로 옮기는 것은 그 몸의 리그가 한다.
 * 설명은 분석기에 그대로 보내므로 영어로 쓴다.
 */
export interface BodySpec {
  /** 몸의 이름. 서버에 판단을 물을 때와 AI 에게 몸을 알려 줄 때 이 이름을 보낸다. */
  name: string;
  /** 이 몸이 어떤 것인지 한두 문장. 움직임 질문에 들어간다. 예: "a robot arm on a workbench. It has no face." */
  describe: string;
  /**
   * 이 몸이 일부러 할 수 있는 움직임과, 이 몸에서는 그것이 무엇인지.
   * 여기에 없는 움직임은 묻지 않는다. 비어 있으면 움직임 질문 자체를 보내지 않는다.
   */
  moves: Partial<Record<MoveName, string>>;
  /**
   * 다른 동작 가운데 이 몸에서는 뜻이 달라지는 것의 설명. 키는 "부위.동작".
   * 예: 눈이 없는 로봇팔의 { 'eyes.wink': 'The light on its wrist blinks …' }
   */
  actions?: Record<string, string>;
}
