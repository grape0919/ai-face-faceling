/**
 * @redbridge/faceling-openai-realtime 의 진입점. 브라우저에서 OpenAI Realtime API 에 WebRTC 로 붙고,
 * 오는 사건을 LiveDirector 에 넘긴다. 임시 키는 @redbridge/faceling-server 가 발급한다.
 */
export {
  RealtimeConnection,
  type ConnectOptions,
  type RealtimeCallbacks,
  type RealtimeConnectionOptions,
} from './connection.js';
export { LiveTranscriber, type LiveTranscriberOptions } from './transcriber.js';
