import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJudgeHandler, createSessionHandler } from './handlers.js';

/** 밖으로 나가는 요청을 가로채, 어떤 키로 불렀는지 모은다 */
function fakeUpstream(): string[] {
  const used: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    used.push(new Headers(init.headers).get('authorization') ?? '');
    if (url.includes('chat/completions')) {
      // OpenAI 판단 모델: 스키마의 질문마다 첫 선택지를 고른다
      const sent = JSON.parse(String(init.body)) as { response_format: { json_schema: { schema: { properties: Record<string, { type: string; enum?: string[] }> } } } };
      const reply = Object.fromEntries(Object.entries(sent.response_format.json_schema.schema.properties).map(([key, p]) => [key, p.type === 'number' ? 2 : p.enum![0]]));
      return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
    }
    if (url.includes('openai.com')) return Response.json({ value: 'ek_test', expires_at: 0 });
    const probabilities = new Proxy({}, { get: () => 0 });
    const answers = new Proxy(
      {},
      { get: (_, name) => (name === 'intensity' ? { type: 'score', score: 0, confidence: 1 } : { type: 'choice', choice: '', confidence: 1, probabilities }) },
    );
    return { ok: true, status: 200, json: async () => ({ model: 'jev', answers }) } as Response;
  });
  return used;
}

const post = (headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/x', { method: 'POST', headers, body: JSON.stringify({ current: '안녕하세요.' }) });

const fromHeader = (name: string) => (request: Request) => request.headers.get(name) ?? undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('요청마다 정하는 API 키', () => {
  it('판단: 요청이 준 키를 쓰고, 없으면 환경 변수의 키를 쓴다', async () => {
    const used = fakeUpstream();
    vi.stubEnv('TYPESAFE_API_KEY', 'env-key');
    const handler = createJudgeHandler({ apiKey: fromHeader('x-typesafe-key') });
    expect((await handler(post({ 'x-typesafe-key': 'user-key' }))).status).toBe(200);
    expect((await handler(post())).status).toBe(200);
    expect(used).toEqual(['Bearer user-key', 'Bearer env-key']);
  });

  it('판단: Jev 키가 없고 OpenAI 키가 있으면 OpenAI 모델이 대신 판단한다', async () => {
    const used = fakeUpstream();
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', 'env-openai');
    const handler = createJudgeHandler({ apiKey: fromHeader('x-typesafe-key'), openaiApiKey: fromHeader('x-openai-key') });
    const fallback = await handler(post({ 'x-openai-key': 'user-openai' }));
    expect(((await fallback.json()) as { analyzer: string }).analyzer).toBe('openai');
    // Jev 키가 오면 OpenAI 키가 있어도 Jev 가 판단한다
    const jev = await handler(post({ 'x-typesafe-key': 'user-jev', 'x-openai-key': 'user-openai' }));
    expect(((await jev.json()) as { analyzer: string }).analyzer).toBe('jev');
    expect((await handler(post())).status).toBe(200);
    expect(used).toEqual(['Bearer user-openai', 'Bearer user-jev', 'Bearer env-openai']);
  });

  it('판단: 어디에도 키가 없으면 400 으로 알린다', async () => {
    const used = fakeUpstream();
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const res = await createJudgeHandler({ apiKey: fromHeader('x-typesafe-key') })(post());
    expect(res.status).toBe(400);
    expect(used).toEqual([]);
  });

  it('임시 키: 요청이 준 OpenAI 키로 발급받는다', async () => {
    const used = fakeUpstream();
    vi.stubEnv('OPENAI_API_KEY', 'env-key');
    const handler = createSessionHandler({ apiKey: fromHeader('x-openai-key') });
    expect((await handler(post({ 'x-openai-key': 'user-key' }))).status).toBe(200);
    expect((await handler(post())).status).toBe(200);
    expect(used).toEqual(['Bearer user-key', 'Bearer env-key']);
  });
});
