import type { AnalyzerInput, Judgment } from './judgment.js';

export interface RemoteJudgeOptions {
  /** 판단을 중계하는 서버 주소. 기본값 '/api/judge' (@faceling/server 의 createJudgeHandler). */
  url?: string;
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
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { judgment?: Judgment; error?: string };
    if (!res.ok || !body.judgment) throw new Error(body.error ?? `판단 요청 실패 (${res.status})`);
    return body.judgment;
  };
}
