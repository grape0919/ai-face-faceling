import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecisionsAnalyzer } from './decisions.js';

interface SentQuestion {
  name: string;
  type: 'choice' | 'score';
  instructions: string;
  choices?: Array<{ value: string; description: string }>;
  levels?: Array<{ label: string; description: string }>;
}
interface Sent {
  model: string;
  input: string;
  questions: SentQuestion[];
}

/** Decisions API 를 흉내 낸다. 고르기 질문은 첫 선택지에 0.8, 나머지에 남은 확률을 나눠 주고, 점수는 3 을 준다. */
function fakeDecisions(): Sent[] {
  const all: Sent[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as Sent;
    all.push(sent);
    const answers = sent.questions.map((q) => {
      if (q.type === 'score') return { type: 'score', name: q.name, score: 3, confidence: 0.5, probabilities: [] };
      const rest = 0.2 / Math.max(1, q.choices!.length - 1);
      return {
        type: 'choice',
        name: q.name,
        choice: q.choices![0]!.value,
        confidence: 0.8,
        probabilities: q.choices!.map((c, i) => ({ value: c.value, probability: i === 0 ? 0.8 : rest })),
      };
    });
    return Response.json({ model: sent.model, answers });
  });
  return all;
}

afterEach(() => vi.unstubAllGlobals());

describe('Decisions 판단 분석기', () => {
  it('Jev 와 같은 질문을 Decisions 모양으로 보내고, 선택지별 확률을 그대로 옮긴다', async () => {
    const sent = fakeDecisions();
    const judgment = await createDecisionsAnalyzer({ apiKey: 'test' }).analyze({ speaker: 'assistant', context: '', current: '정말 축하드려요!' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.model).toBe('gpt-6-luna');
    expect(sent[0]!.input).toContain('정말 축하드려요!');
    const intensity = sent[0]!.questions.find((q) => q.name === 'intensity')!;
    expect(intensity.type).toBe('score');
    expect(intensity.levels).toHaveLength(5);
    const mouth = sent[0]!.questions.find((q) => q.name === 'mouth')!;
    expect(mouth.type).toBe('choice');

    // 점수 3 은 0~4 단계에서 0.75
    expect(judgment.intensity).toBeCloseTo(0.75);
    // 첫 선택지는 0.8, 나머지도 확률이 남는다(채팅 모델처럼 고른 것 하나만 오지 않는다)
    const first = mouth.choices![0]!.value;
    const second = mouth.choices![1]!.value;
    expect(judgment.regions.mouth![first]).toBeCloseTo(0.8);
    expect(judgment.regions.mouth![second]).toBeGreaterThan(0);
  });

  it('요청이 실패하면 상태 코드를 담아 알린다', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 401 }));
    await expect(createDecisionsAnalyzer({ apiKey: 'test' }).analyze({ speaker: 'user', context: '', current: '안녕' })).rejects.toThrow('401');
  });
});
