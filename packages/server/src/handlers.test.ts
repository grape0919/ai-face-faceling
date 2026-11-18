import { afterEach, describe, expect, it, vi } from 'vitest';
import { neutralJudgment } from '@redbridge/faceling-core/judgment';
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
    if (url.includes('/v1/decisions')) {
      // Decisions API: 질문마다 첫 선택지를 고르고, 점수는 2 를 준다
      const sent = JSON.parse(String(init.body)) as { questions: Array<{ name: string; type: string; choices?: Array<{ value: string }> }> };
      const answers = sent.questions.map((q) =>
        q.type === 'score'
          ? { type: 'score', name: q.name, score: 2 }
          : { type: 'choice', name: q.name, choice: q.choices![0]!.value, probabilities: q.choices!.map((c, i) => ({ value: c.value, probability: i === 0 ? 1 : 0 })) },
      );
      return Response.json({ answers });
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

const post = (headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Request =>
  new Request('http://localhost/api/x', { method: 'POST', headers, body: JSON.stringify({ current: '안녕하세요.', ...extra }) });
const judgedBy = async (res: Response): Promise<string> => ((await res.json()) as { analyzer: string }).analyzer;

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

  it('판단: Jev 키가 없고 OpenAI 키가 있으면 OpenAI Decisions 가 대신 판단한다', async () => {
    const used = fakeUpstream();
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', 'env-openai');
    const handler = createJudgeHandler({ apiKey: fromHeader('x-typesafe-key'), openaiApiKey: fromHeader('x-openai-key') });
    const fallback = await handler(post({ 'x-openai-key': 'user-openai' }));
    expect(((await fallback.json()) as { analyzer: string }).analyzer).toBe('decisions');
    // Jev 키가 오면 OpenAI 키가 있어도 Jev 가 판단한다
    const jev = await handler(post({ 'x-typesafe-key': 'user-jev', 'x-openai-key': 'user-openai' }));
    expect(((await jev.json()) as { analyzer: string }).analyzer).toBe('jev');
    expect((await handler(post())).status).toBe(200);
    expect(used).toEqual(['Bearer user-openai', 'Bearer user-jev', 'Bearer env-openai']);
  });

  it('판단: 요청이 판단 모델을 이름으로 고른다', async () => {
    fakeUpstream();
    vi.stubEnv('TYPESAFE_API_KEY', 'env-jev');
    vi.stubEnv('OPENAI_API_KEY', 'env-openai');
    const handler = createJudgeHandler();
    expect(await judgedBy(await handler(post()))).toBe('jev');
    expect(await judgedBy(await handler(post({}, { judge: 'decisions' })))).toBe('decisions');
    expect(await judgedBy(await handler(post({}, { judge: 'openai' })))).toBe('openai');
    // 모르는 이름과, 키가 없는 모델은 다른 모델로 넘어가지 않고 400 으로 알린다
    expect((await handler(post({}, { judge: 'nope' }))).status).toBe(400);
    vi.stubEnv('TYPESAFE_API_KEY', '');
    expect((await handler(post({}, { judge: 'jev' }))).status).toBe(400);
  });

  it('판단: 새 판단 모델을 이름으로 더하고, 순서를 정할 수 있다', async () => {
    fakeUpstream();
    vi.stubEnv('TYPESAFE_API_KEY', 'env-jev');
    const mine = { name: 'mine', version: '1', analyze: async () => neutralJudgment() };
    // 더한 모델은 기본 순서의 맨 앞에 온다
    const handler = createJudgeHandler({ judges: { mine } });
    expect(await judgedBy(await handler(post()))).toBe('mine');
    expect(await judgedBy(await handler(post({}, { judge: 'jev' })))).toBe('jev');
    // order 로 순서를 바꾼다. 쓸 수 없으면(undefined) 다음으로 넘어간다
    const ordered = createJudgeHandler({ judges: { mine, off: () => undefined }, order: ['off', 'jev', 'mine'] });
    expect(await judgedBy(await ordered(post()))).toBe('jev');
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
