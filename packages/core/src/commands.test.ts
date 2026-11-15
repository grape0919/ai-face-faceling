import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJevAnalyzer } from './analyzers/jev.js';
import { Compositor } from './compositor.js';
import { facePose } from './face.js';
import type { AnalyzerInput, Judgment } from './judgment.js';
import { LiveDirector, LiveFace } from './live.js';
import { regionCriteria } from './questions.js';
import { onlyAction, restProbs, type Region } from './regions.js';
import { VARIANTS, targetWeights } from './weights.js';

/**
 * 감정이 아니라 "실제로 하는 동작"의 판단: 윙크, 팔 동작.
 * 같은 판단 경로(Jev)로 들어오고, 몸에 따라 묻는 부위만 달라진다.
 */

const j = (picks: Partial<Record<Region, string>>, intensity = 0.5): Judgment => {
  const regions = restProbs();
  for (const [region, action] of Object.entries(picks) as [Region, string][]) regions[region] = onlyAction(region, action, 0.95);
  return { intensity, regions };
};

describe('Jev 분석기의 몸별 질문', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 보낸 질문을 기록하고, 받은 질문마다 첫 선택지를 고르는 가짜 Jev */
  function fakeJev() {
    const sent: Record<string, { criteria?: Record<string, string> }>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const { questions } = JSON.parse(init.body) as { questions: Record<string, { type: string; criteria?: Record<string, string> }> };
      sent.push(questions);
      const answers: Record<string, unknown> = {};
      for (const [name, q] of Object.entries(questions)) {
        if (q.type === 'score') answers[name] = { type: 'score', score: 2, confidence: 1 };
        else {
          const options = Object.keys(q.criteria ?? {});
          const pick = name === 'arm' ? 'right' : options[0]!;
          answers[name] = { type: 'choice', choice: pick, confidence: 1, probabilities: Object.fromEntries(options.map((o) => [o, o === pick ? 1 : 0])) };
        }
      }
      return new Response(JSON.stringify({ model: 'jev', answers }));
    });
    return sent;
  }

  const input = (over: Partial<AnalyzerInput> = {}): AnalyzerInput => ({ speaker: 'assistant', context: '', current: '네, 오른쪽으로 쭉!', ...over });

  it('팔이 없는 캐릭터에는 팔을 묻지 않고, 팔은 쉬는 자세로 채운다', async () => {
    const sent = fakeJev();
    const judgment = await createJevAnalyzer({ apiKey: 'test' }).analyze(input());
    expect(Object.keys(sent[0]!)).not.toContain('arm');
    expect(judgment.regions.arm.rest).toBe(1);
  });

  it('팔이 있는 캐릭터는 말하는 구간에서 팔 동작을 함께 묻는다', async () => {
    const sent = fakeJev();
    const judgment = await createJevAnalyzer({ apiKey: 'test' }).analyze(input({ parts: ['arm'] }));
    expect(Object.keys(sent[0]!)).toContain('arm');
    expect(judgment.regions.arm.right).toBe(1);
  });

  it('듣는 구간에서는 팔 동작을 묻지 않는다', async () => {
    const sent = fakeJev();
    await createJevAnalyzer({ apiKey: 'test' }).analyze(input({ speaker: 'user', parts: ['arm'] }));
    expect(Object.keys(sent[0]!)).not.toContain('arm');
  });

  it('윙크는 말하는 구간의 눈 선택지에만 있다', async () => {
    const sent = fakeJev();
    const analyzer = createJevAnalyzer({ apiKey: 'test' });
    await analyzer.analyze(input());
    await analyzer.analyze(input({ speaker: 'user' }));
    expect(Object.keys(sent[0]!.eyes!.criteria!)).toContain('wink');
    expect(Object.keys(sent[1]!.eyes!.criteria!)).not.toContain('wink');
  });
});

describe('몸에 따라 달라지는 선택지 설명', () => {
  it('로봇팔의 윙크는 눈이 아니라 불빛으로 묻는다', () => {
    expect(regionCriteria('eyes', 'speaking').wink).toMatch(/One eye closes/);
    expect(regionCriteria('eyes', 'speaking', ['arm']).wink).toMatch(/light/);
    expect(regionCriteria('eyes', 'listening', ['arm']).wink).toBeUndefined();
  });
});

describe('팔 동작의 세기', () => {
  const armAt = (p: number, intensity: number) => {
    const regions = restProbs();
    regions.arm = { ...regions.arm, rest: 1 - p, right: p };
    return targetWeights({ intensity, regions }, 'L')['arm.right'] ?? 0;
  };

  it('또렷한 판단이면 표정 세기와 상관없이 온전히 한다', () => {
    expect(armAt(0.95, 0.1)).toBe(1);
  });

  it('방향을 설명만 하는 말처럼 애매한 판단에는 거의 움직이지 않는다', () => {
    expect(armAt(0.59, 1)).toBeLessThan(0.3);
  });
});

describe('윙크', () => {
  it('유지되는 자세가 아니라 순간 동작이다', () => {
    expect(VARIANTS.some((v) => v.key.startsWith('eyes.wink'))).toBe(false);
  });

  it('윙크하는 동안 그쪽 눈만 감긴다', () => {
    const c = new Compositor();
    const input = { turn: 'speaking' as const, target: null, targetSince: 0, mouth: null, blink: 0 };
    const gestures = [{ type: 'wink' as const, t: 0, dur: 0.5, amp: 1, side: 'L' as const }];
    const mid = facePose(c.express(0.2, 10, { ...input, gestures }));
    expect(mid.shapes.eyeBlinkLeft).toBeGreaterThan(0.9);
    expect(mid.shapes.eyeBlinkRight ?? 0).toBeLessThan(0.1);
    const after = facePose(c.express(0.6, 10, { ...input, gestures }));
    expect(after.shapes.eyeBlinkLeft ?? 0).toBeLessThan(0.05);
  });
});

describe('LiveDirector 의 몸', () => {
  function run(parts: Region[], answer: Judgment | ((input: AnalyzerInput) => Judgment)) {
    let now = 0;
    const asked: AnalyzerInput[] = [];
    const face = new LiveFace();
    const director = new LiveDirector(face, {
      clock: () => now,
      secondsPerChar: 0.2,
      judge: async (i) => {
        asked.push(i);
        return typeof answer === 'function' ? answer(i) : answer;
      },
    });
    director.parts = parts;
    return {
      face,
      asked,
      async speak(text: string) {
        director.assistantStarted();
        director.assistantText(text);
        director.assistantTextDone();
        await new Promise((r) => setTimeout(r, 0));
        director.assistantAudioStarted();
      },
      at: (t: number) => ((now = t), face.update(t, null)),
      stop: (t: number) => ((now = t), director.assistantAudioStopped()),
    };
  }

  /** from 부터 to 까지 매 프레임 돌리며 값을 모은다 */
  const sweep = <T>(h: { at: (t: number) => { expression: import('./compositor.js').Expression } }, from: number, to: number, read: (e: import('./compositor.js').Expression) => T): T[] => {
    const out: T[] = [];
    for (let t = from; t <= to; t += 1 / 30) out.push(read(h.at(t).expression));
    return out;
  };

  it('지금 몸의 부위를 판단 요청에 싣는다', async () => {
    const h = run(['arm'], j({ arm: 'right' }));
    await h.speak('네, 오른쪽으로 쭉 뻗어 볼게요!');
    expect(h.asked.length).toBeGreaterThan(0);
    expect(h.asked.every((i) => i.parts?.includes('arm'))).toBe(true);
    // 팔 동작은 그 절이 들리는 동안 세기로 나온다
    expect(h.at(1).expression.weights['arm.right']).toBeGreaterThan(0.5);
  });

  it('윙크 판단이 오면 그 절에서 한쪽 눈을 감는다', async () => {
    const h = run([], j({ eyes: 'wink' }));
    await h.speak('좋아요, 찡긋! 이렇게요.');
    const winks = sweep(h, 0, 1, (e) => e.gesture.winkL);
    expect(Math.max(...winks)).toBeGreaterThan(0.8);
  });

  it('윙크한 것을 설명하는 뒷말에는 또 윙크하지 않는다', async () => {
    const h = run([], j({ eyes: 'wink' }));
    await h.speak('좋아요, 찡긋! 방금 한쪽 눈을 감았다 떴는데 잘 보셨나요? 제법 귀엽게 됐죠?');
    // 눈을 감았다 뜨는 횟수를 센다
    const closed = sweep(h, 0, 8, (e) => e.gesture.winkL > 0.5);
    const times = closed.filter((c, i) => c && !closed[i - 1]).length;
    expect(times).toBe(1);
  });

  it('애매한 윙크 판단(50% 이하)에는 윙크하지 않는다', async () => {
    const regions = restProbs();
    regions.eyes = { ...regions.eyes, relaxed: 0.55, wink: 0.45 };
    const h = run([], { intensity: 0.5, regions });
    await h.speak('찡긋이라는 말 참 귀엽죠, 그렇죠?');
    expect(Math.max(...sweep(h, 0, 3, (e) => e.gesture.winkL))).toBe(0);
  });

  it('부탁받은 팔 자세는 한마디가 끝난 뒤에도 몇 초 남는다', async () => {
    const h = run(['arm'], j({ arm: 'right' }));
    await h.speak('네, 오른쪽으로 쭉!');
    sweep(h, 0, 1.6, () => 0);
    h.stop(1.6);
    // 말은 1.6초에 끝났지만 4초 뒤에도 오른쪽에 있다가, 그 뒤에 돌아온다
    const later = sweep(h, 1.6, 12, (e) => e.weights['arm.right'] ?? 0);
    expect(later[Math.round((5 - 1.6) * 30)]).toBeGreaterThan(0.9);
    expect(later[later.length - 1]).toBeLessThan(0.05);
  });

  it('제자리 명령은 붙잡아 둔 자세를 풀고, 옛 자세가 되살아나지 않는다', async () => {
    const h = run(['arm'], (i) => (i.current.includes('제자리') ? j({ arm: 'home' }) : j({ arm: 'right' })));
    await h.speak('네, 오른쪽으로 쭉!');
    sweep(h, 0, 1.6, () => 0);
    h.stop(1.6);
    await h.speak('네, 제자리로 돌아올게요!');
    const after = sweep(h, 1.6, 5, (e) => e.weights['arm.right'] ?? 0);
    expect(after[after.length - 1]).toBeLessThan(0.05);
  });

  it('부탁받은 고개 돌리기는 머리를 그쪽으로 크게 돌리고 말이 끝난 뒤에도 남는다', async () => {
    const h = run(['turn'], j({ turn: 'right' }));
    await h.speak('네, 오른쪽으로 휙!');
    expect(h.asked.every((i) => i.parts?.includes('turn'))).toBe(true);
    sweep(h, 0, 1.6, () => 0);
    h.stop(1.6);
    // yaw 양수는 보는 사람에게 화면 오른쪽이다
    const yaw = [];
    for (let t = 1.6; t <= 12; t += 1 / 30) yaw.push(h.at(t).head.yaw);
    expect(yaw[Math.round((4 - 1.6) * 30)]).toBeGreaterThan(0.35);
    expect(Math.abs(yaw[yaw.length - 1] as number)).toBeLessThan(0.08);
  });

  it('고개를 위로 들면 숙임과 반대 방향이다', async () => {
    const h = run(['turn'], j({ turn: 'up' }));
    await h.speak('네, 위로 번쩍 들었어요!');
    sweep(h, 0, 1.5, () => 0);
    expect(h.at(1.5).head.pitch).toBeLessThan(-0.2);
  });

  it('새 팔 동작은 앞의 자세를 대신한다', async () => {
    const h = run(['arm'], (i) => (i.current.includes('왼쪽') ? j({ arm: 'left' }) : j({ arm: 'right' })));
    await h.speak('네, 오른쪽으로 쭉!');
    sweep(h, 0, 1.6, () => 0);
    h.stop(1.6);
    await h.speak('이번엔 왼쪽으로 갑니다!');
    const last = sweep(h, 1.6, 5, (e) => [e.weights['arm.right'] ?? 0, e.weights['arm.left'] ?? 0]).pop() as number[];
    expect(last[0]).toBeLessThan(0.05);
    expect(last[1]).toBeGreaterThan(0.9);
  });
});
