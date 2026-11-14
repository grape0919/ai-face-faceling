/**
 * @faceling/server 의 진입점. 키를 서버에만 두고 브라우저에 필요한 것만 내주는 처리기들이다.
 *  - createJudgeHandler: 절 하나의 판단을 분석기(Jev)에 묻는다
 *  - createSessionHandler, createTranscriptionSessionHandler: OpenAI Realtime 임시 키를 발급한다
 *  - createFacelingHandler: 위 셋을 경로로 나눠 한 곳에 건다
 *  - toNodeHandler: Request→Response 처리기를 Node 의 (req, res) 처리기로 바꾼다
 *
 * 인증은 들어 있지 않다. 내 PC 밖으로 열 때는 앞에 로그인·요청 제한을 먼저 넣어야 한다.
 */
export * from './handlers.js';
export * from './node.js';
