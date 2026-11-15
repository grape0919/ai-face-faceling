/**
 * @faceling/core 의 진입점. 표정 엔진 전체를 여기서 가져올 수 있다.
 *
 * 브라우저 전용인 입 모양 분석(MouthAnalyser)은 Web Audio 타입에 기대므로 여기서 빼고
 * '@faceling/core/lipsync' 로 따로 가져온다. 그래야 Node 에서 이 진입점을 써도 DOM 타입이 필요 없다.
 */
export * from './body.js';
export * from './clauses.js';
export * from './compositor.js';
export * from './face.js';
export * from './feelings.js';
export * from './judgment.js';
export * from './live.js';
export * from './mapping.js';
export * from './questions.js';
export * from './regions.js';
export * from './remote.js';
export * from './weights.js';
export { createJevAnalyzer, type JevAnalyzerOptions } from './analyzers/jev.js';
