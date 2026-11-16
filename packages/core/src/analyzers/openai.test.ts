import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyzerInput } from '../judgment.js';
import { createOpenAIAnalyzer } from './openai.js';

interface Sent {
  model: string;
  reasoning_effort?: string;
  messages: Array<{ role: string; content: string }>;
  response_format: { json_schema: { schema: { properties: Record<string, { type: string; enum?: string[] }>; required: string[] } } };
}

/** 질문 이름 → 답의 키(q0, q1, …). system 글의 "## [q3] eyes (choice)" 에서 읽는다. */
const codeOf = (sent: Sent, name: string): string => new RegExp(`## \\[(q\\d+)\\] ${name} `).exec(sent.messages[0]!.content)![1]!;
const optionsOf = (sent: Sent, name: string): string[] => sent.response_format.json_schema.schema.properties[codeOf(sent, name)]!.enum!;

/** OpenAI 를 흉내 낸다. 보낸 요청을 모으고, reply 가 만든 JSON 을 모델의 답으로 돌려준다. */
function fakeOpenAI(reply: (sent: Sent) => Record<string, unknown>): Sent[] {
  const all: Sent[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as Sent;
    all.push(sent);
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply(sent)) } }] });
  });
  return all;
}

/** 질문마다 첫 선택지를 고르고, 점수는 3 을 준다. overrides(질문 이름 → 답)로 일부를 바꾼다. */
const firstChoices =
  (overrides: Record<string, unknown> = {}) =>
  (sent: Sent): Record<string, unknown> => ({
    ...Object.fromEntries(Object.entries(sent.response_format.json_schema.schema.properties).map(([key, p]) => [key, p.type === 'number' ? 3 : p.enum![0]])),
    ...Object.fromEntries(Object.entries(overrides).map(([name, value]) => [codeOf(sent, name), value])),
  });

const input = (extra: Partial<AnalyzerInput> = {}): AnalyzerInput => ({ speaker: 'assistant', context: '', current: '정말 축하드려요!', ...extra });

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI 판단 분석기', () => {
  it('Jev 와 같은 질문을 한 요청에 묻고, 답의 모양을 스키마로 묶는다', async () => {
    const sent = fakeOpenAI(firstChoices());
    await createOpenAIAnalyzer({ apiKey: 'test', model: 'some-model' }).analyze(input());
    expect(sent).toHaveLength(1);
    for (const name of ['intensity', 'brows', 'eyes', 'gaze', 'cheeks', 'mouth', 'head']) {
      expect(sent[0]!.response_format.json_schema.schema.required).toContain(codeOf(sent[0]!, name));
    }
    expect(optionsOf(sent[0]!, 'eyes')).toContain('wink');
    // 질문 글은 system 에, 대화는 user 에 간다
    expect(JSON.parse(sent[0]!.messages[1]!.content)).toMatchObject({ role: 'speaking', current: '정말 축하드려요!' });
    // 기본 모델이 아니면 생각하는 정도를 보내지 않는다(받지 않는 모델이 있다)
    expect(sent[0]!.model).toBe('some-model');
    expect(sent[0]!.reasoning_effort).toBeUndefined();
  });

  it('고른 선택지에만 확률을 싣고, 점수는 0~1 세기로 옮긴다', async () => {
    fakeOpenAI(firstChoices({ mouth: 'grin', intensity: 3 }));
    const judgment = await createOpenAIAnalyzer({ apiKey: 'test' }).analyze(input());
    expect(judgment.intensity).toBeCloseTo(0.75);
    expect(judgment.regions.mouth.grin).toBeCloseTo(0.9);
    expect(judgment.regions.mouth.smile).toBe(0);
  });

  it('듣는 구간에는 듣는 동안 고를 수 없는 선택지를 묻지 않는다', async () => {
    const sent = fakeOpenAI(firstChoices());
    await createOpenAIAnalyzer({ apiKey: 'test' }).analyze(input({ speaker: 'user' }));
    expect(optionsOf(sent[0]!, 'eyes')).not.toContain('wink');
  });

  it('기본 모델에는 생각 없이 바로 답하게 한다', async () => {
    const sent = fakeOpenAI(firstChoices());
    await createOpenAIAnalyzer({ apiKey: 'test' }).analyze(input());
    expect(sent[0]!.reasoning_effort).toBe('none');
  });

  it('모델이 없는 선택지를 답하면 오류로 알린다', async () => {
    fakeOpenAI(firstChoices({ mouth: '없는 동작' }));
    await expect(createOpenAIAnalyzer({ apiKey: 'test' }).analyze(input())).rejects.toThrow('mouth');
  });
});
