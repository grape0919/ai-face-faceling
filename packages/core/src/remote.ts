import type { AnalyzerInput, Judgment } from './judgment.js';

export interface RemoteJudgeOptions {
  /** 판단을 중계하는 서버 주소. 기본값 '/api/judge' (@redbridge/faceling-server 의 createJudgeHandler). */
  url?: string;
  /**
   * 서버가 쓸 판단 모델의 이름('jev', 'decisions', 'openai', 또는 서버가 judges 로 더한 이름). 함수면 요청마다 부른다.
   * 없으면 서버가 정한 순서에서 쓸 수 있는 첫 번째가 판단한다.
   */
  judge?: string | (() => string | undefined);
  /** 요청에 붙일 헤더. 서버 쪽 인증에 쓴다. */
  headers?: Record<string, string>;
  /** 바꿔 끼울 fetch. 시험용. */
  fetch?: typeof fetch;
}

/**
 * 브라우저에서 쓰는 판단 함수. 분석기 키는 서버에만 두고, 절 하나의 판단을 서버에 묻는다.
 * 돌려주는 함수를 LiveDirector 의 judge 옵션에 그대로 넣는다.
 */
export function createRemoteJudge(options: RemoteJudgeOptions = {}): (input: AnalyzerInput) => Promise<Judgment> {
  const url = options.url ?? '/api/judge';
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return async (input) => {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      // 몸 명세는 이름만 보낸다. 질문에 들어갈 설명은 서버가 가진 명세에서 나온다.
      body: JSON.stringify({ ...input, body: input.body?.name, judge: typeof options.judge === 'function' ? options.judge() : options.judge }),
    });
    const body = (await res.json().catch(() => ({}))) as { judgment?: Judgment; error?: string };
    if (!res.ok || !body.judgment) throw new Error(body.error ?? `판단 요청 실패 (${res.status})`);
    return body.judgment;
  };
}
