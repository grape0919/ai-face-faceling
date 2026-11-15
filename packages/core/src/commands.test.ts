import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJevAnalyzer } from './analyzers/jev.js';
import type { BodySpec } from './body.js';
import { Compositor, type Expression } from './compositor.js';
import { facePose } from './face.js';
import type { AnalyzerInput, Judgment } from './judgment.js';
import { LiveDirector, LiveFace } from './live.js';
import { regionCriteria, regionInstructions } from './questions.js';
import { onlyAction, restProbs, type Region } from './regions.js';
import { createRemoteJudge } from './remote.js';
import { VARIANTS, targetWeights } from './weights.js';

/**
 * 감정이 아니라 "일부러 하는 동작"의 판단: 윙크와 움직임(move).
 * 엔진은 몸의 종류를 모른다. 몸 명세(BodySpec)만 보고 질문을 만들고, 결과는 몸과 상관없는 이름으로 나온다.
 */

/** 고개만 돌릴 수 있는 몸 */
const HEAD: BodySpec = {
  name: 'head',
  describe: 'a face with a head it can turn.',
  moves: { up: 'Lifting its head.', left: 'Turning its head left.', right: 'Turning its head right.', home: 'Facing front again.' },
};
/** 팔이 있고 눈은 없는 몸 */
const ARM: BodySpec = {
  name: 'arm',
  describe: 'a robot arm without a face.',
  moves: { left: 'Reaching the arm left.', right: 'Reaching the arm right.', wave: 'Waving the arm.', home: 'Arm back to rest.' },
  actions: { 'eyes.wink': 'The light on its wrist blinks like a wink.' },
};

const j = (picks: Partial<Record<Region, string>>, intensity = 0.5): Judgment => {
  const regions = restProbs();
  for (const [region, action] of Object.entries(picks) as [Region, string][]) regions[region] = onlyAction(region, action, 0.95);
  return { intensity, regions };
};

describe('몸 명세로 만드는 질문', () => {
  it('움직임은 그 몸이 할 수 있는 것만, 그 몸의 설명으로 묻는다', () => {
    const head = regionCriteria('move', 'speaking', HEAD);
    expect(Object.keys(head).sort()).toEqual(['home', 'left', 'rest', 'right', 'up']);
    expect(head.left).toBe('Turning its head left.');
    const arm = regionCriteria('move', 'speaking', ARM);
    expect(Object.keys(arm).sort()).toEqual(['home', 'left', 'rest', 'right', 'wave']);
    expect(arm.left).toBe('Reaching the arm left.');
  });

  it('움직임 질문에 그 몸이 어떤 것인지가 들어간다', () => {
    expect(regionInstructions('move', 'speaking', ARM)).toContain('a robot arm without a face.');
    expect(regionInstructions('move', 'speaking', ARM)).not.toContain('{body}');
  });

  it('그 몸에서 뜻이 달라지는 동작은 명세의 설명으로 묻는다', () => {
    expect(regionCriteria('eyes', 'speaking').wink).toMatch(/One eye closes/);
    expect(regionCriteria('eyes', 'speaking', ARM).wink).toMatch(/light/);
    expect(regionCriteria('eyes', 'speaking', HEAD).wink).toMatch(/One eye closes/);
    expect(regionCriteria('eyes', 'listening', ARM).wink).toBeUndefined();
  });
});

describe('Jev 분석기', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 보낸 질문을 기록하고, 받은 질문마다 첫 선택지를(움직임은 right 를) 고르는 가짜 Jev */
  function fakeJev() {
    const sent: Record<string, { instructions?: string; criteria?: Record<string, string> }>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const { questions } = JSON.parse(init.body) as { questions: Record<string, { type: string; criteria?: Record<string, string> }> };
      sent.push(questions);
      const answers: Record<string, unknown> = {};
      for (const [name, q] of Object.entries(questions)) {
        if (q.type === 'score') answers[name] = { type: 'score', score: 2, confidence: 1 };
        else {
          const options = Object.keys(q.criteria ?? {});
          const pick = name === 'move' ? 'right' : (options[0] as string);
          answers[name] = { type: 'choice', choice: pick, confidence: 1, probabilities: Object.fromEntries(options.map((o) => [o, o === pick ? 1 : 0])) };
        }
      }
      return new Response(JSON.stringify({ model: 'jev', answers }));
    });
    return sent;
  }

  const input = (over: Partial<AnalyzerInput> = {}): AnalyzerInput => ({ speaker: 'assistant', context: '', current: '네, 오른쪽으로 쭉!', ...over });

  it('몸 명세가 없으면 움직임을 묻지 않고, 쉬는 것으로 채운다', async () => {
    const sent = fakeJev();
    const judgment = await createJevAnalyzer({ apiKey: 'test' }).analyze(input());
    expect(Object.keys(sent[0] ?? {})).not.toContain('move');
    expect(judgment.regions.move.rest).toBe(1);
  });

  it('몸 명세가 있으면 말하는 구간에서 움직임을 함께 묻는다', async () => {
    const sent = fakeJev();
    const judgment = await createJevAnalyzer({ apiKey: 'test' }).analyze(input({ body: ARM }));
    expect(Object.keys(sent[0]?.move?.criteria ?? {}).sort()).toEqual(['home', 'left', 'rest', 'right', 'wave']);
    expect(judgment.regions.move.right).toBe(1);
    // 이 몸이 못 하는 움직임은 0 으로 채워진다
    expect(judgment.regions.move.up).toBe(0);
  });

  it('몸이 달라도 결과의 이름은 같고, 질문만 그 몸에 맞게 달라진다', async () => {
    const sent = fakeJev();
    const analyzer = createJevAnalyzer({ apiKey: 'test' });
    const head = await analyzer.analyze(input({ body: HEAD }));
    const arm = await analyzer.analyze(input({ body: ARM }));
    expect(head.regions.move.right).toBe(1);
    expect(arm.regions.move.right).toBe(1);
    expect(sent[0]?.move?.criteria?.right).toBe('Turning its head right.');
    expect(sent[1]?.move?.criteria?.right).toBe('Reaching the arm right.');
  });

  it('듣는 구간에서는 움직임을 묻지 않는다', async () => {
    const sent = fakeJev();
    await createJevAnalyzer({ apiKey: 'test' }).analyze(input({ speaker: 'user', body: ARM }));
    expect(Object.keys(sent[0] ?? {})).not.toContain('move');
  });

  it('윙크는 말하는 구간의 눈 선택지에만 있다', async () => {
    const sent = fakeJev();
    const analyzer = createJevAnalyzer({ apiKey: 'test' });
    await analyzer.analyze(input());
    await analyzer.analyze(input({ speaker: 'user' }));
    expect(Object.keys(sent[0]?.eyes?.criteria ?? {})).toContain('wink');
    expect(Object.keys(sent[1]?.eyes?.criteria ?? {})).not.toContain('wink');
  });
});

describe('서버에 묻는 판단', () => {
  it('몸 명세는 이름만 보낸다', async () => {
    let sent: Record<string, unknown> = {};
    const judge = createRemoteJudge({
      fetch: (async (_url: string, init: { body: string }) => {
        sent = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(JSON.stringify({ judgment: j({}) }));
      }) as never,
    });
    await judge({ speaker: 'assistant', context: '', current: '네!', body: ARM });
    expect(sent.body).toBe('arm');
  });
});

describe('움직임의 세기', () => {
  const moveAt = (p: number, intensity: number) => {
    const regions = restProbs();
    regions.move = { ...regions.move, rest: 1 - p, right: p };
    return targetWeights({ intensity, regions }, 'L')['move.right'] ?? 0;
  };

  it('또렷한 판단이면 표정 세기와 상관없이 온전히 한다', () => {
    expect(moveAt(0.95, 0.1)).toBe(1);
  });

  it('방향을 설명만 하는 말처럼 애매한 판단에는 거의 움직이지 않는다', () => {
    expect(moveAt(0.59, 1)).toBeLessThan(0.3);
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

describe('LiveDirector 의 일부러 하는 동작', () => {
  function run(body: BodySpec | null, answer: Judgment | ((input: AnalyzerInput) => Judgment)) {
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
    director.body = body;
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
  type Harness = ReturnType<typeof run>;

  /** from 부터 to 까지 매 프레임 돌리며 값을 모은다 */
  const sweep = <T>(h: Harness, from: number, to: number, read: (frame: ReturnType<Harness['at']>) => T): T[] => {
    const out: T[] = [];
    for (let t = from; t <= to; t += 1 / 30) out.push(read(h.at(t)));
    return out;
  };
  const weight = (key: string) => (frame: { expression: Expression }) => frame.expression.weights[key] ?? 0;
  /** 한마디를 하고 1.6초에 말을 마친다 */
  const sayShort = async (h: Harness, text: string) => {
    await h.speak(text);
    sweep(h, 0, 1.6, () => 0);
    h.stop(1.6);
  };

  it('지금 몸의 명세를 판단 요청에 싣는다', async () => {
    const h = run(ARM, j({ move: 'right' }));
    await h.speak('네, 오른쪽으로 쭉 뻗어 볼게요!');
    expect(h.asked.length).toBeGreaterThan(0);
    expect(h.asked.every((i) => i.body === ARM)).toBe(true);
    // 움직임은 그 절이 들리는 동안 세기로 나온다
    expect(weight('move.right')(h.at(1))).toBeGreaterThan(0.5);
  });

  it('같은 움직임이 어느 몸에서나 같은 이름의 세기로 나온다', async () => {
    for (const body of [HEAD, ARM]) {
      const h = run(body, j({ move: 'right' }));
      await h.speak('네, 오른쪽으로 쭉!');
      expect(weight('move.right')(h.at(1))).toBeGreaterThan(0.5);
    }
  });

  it('윙크 판단이 오면 그 절에서 한쪽 눈을 감는다', async () => {
    const h = run(null, j({ eyes: 'wink' }));
    await h.speak('좋아요, 찡긋! 이렇게요.');
    expect(Math.max(...sweep(h, 0, 1, (f) => f.expression.gesture.winkL))).toBeGreaterThan(0.8);
  });

  it('윙크한 것을 설명하는 뒷말에는 또 윙크하지 않는다', async () => {
    const h = run(null, j({ eyes: 'wink' }));
    await h.speak('좋아요, 찡긋! 방금 한쪽 눈을 감았다 떴는데 잘 보셨나요? 제법 귀엽게 됐죠?');
    // 눈을 감았다 뜨는 횟수를 센다
    const closed = sweep(h, 0, 8, (f) => f.expression.gesture.winkL > 0.5);
    expect(closed.filter((c, i) => c && !closed[i - 1]).length).toBe(1);
  });

  it('애매한 윙크 판단(50% 이하)에는 윙크하지 않는다', async () => {
    const regions = restProbs();
    regions.eyes = { ...regions.eyes, relaxed: 0.55, wink: 0.45 };
    const h = run(null, { intensity: 0.5, regions });
    await h.speak('찡긋이라는 말 참 귀엽죠, 그렇죠?');
    expect(Math.max(...sweep(h, 0, 3, (f) => f.expression.gesture.winkL))).toBe(0);
  });

  it('부탁받은 자세는 한마디가 끝난 뒤에도 몇 초 남는다', async () => {
    const h = run(ARM, j({ move: 'right' }));
    await sayShort(h, '네, 오른쪽으로 쭉!');
    // 말은 1.6초에 끝났지만 5초에도 오른쪽에 있다가, 그 뒤에 돌아온다
    const later = sweep(h, 1.6, 12, weight('move.right'));
    expect(later[Math.round((5 - 1.6) * 30)]).toBeGreaterThan(0.9);
    expect(later[later.length - 1]).toBeLessThan(0.05);
  });

  it('제자리 명령은 붙잡아 둔 자세를 풀고, 옛 자세가 되살아나지 않는다', async () => {
    const h = run(ARM, (i) => (i.current.includes('제자리') ? j({ move: 'home' }) : j({ move: 'right' })));
    await sayShort(h, '네, 오른쪽으로 쭉!');
    await h.speak('네, 제자리로 돌아올게요!');
    const after = sweep(h, 1.6, 5, weight('move.right'));
    expect(after[after.length - 1]).toBeLessThan(0.05);
  });

  it('새 움직임은 앞의 자세를 대신한다', async () => {
    const h = run(ARM, (i) => (i.current.includes('왼쪽') ? j({ move: 'left' }) : j({ move: 'right' })));
    await sayShort(h, '네, 오른쪽으로 쭉!');
    await h.speak('이번엔 왼쪽으로 갑니다!');
    const last = sweep(h, 1.6, 5, (f) => [weight('move.right')(f), weight('move.left')(f)]).pop() as number[];
    expect(last[0]).toBeLessThan(0.05);
    expect(last[1]).toBeGreaterThan(0.9);
  });

  it('얼굴은 움직임을 고개로 옮긴다: 오른쪽은 크게 돌리고 말이 끝난 뒤에도 남는다', async () => {
    const h = run(HEAD, j({ move: 'right' }));
    await sayShort(h, '네, 오른쪽으로 휙!');
    // yaw 양수는 보는 사람에게 화면 오른쪽이다
    const yaw = sweep(h, 1.6, 12, (f) => f.head.yaw);
    expect(yaw[Math.round((4 - 1.6) * 30)]).toBeGreaterThan(0.35);
    expect(Math.abs(yaw[yaw.length - 1] as number)).toBeLessThan(0.08);
  });

  it('얼굴은 위로 움직이면 고개를 든다(숙임과 반대 방향)', async () => {
    const h = run(HEAD, j({ move: 'up' }));
    await h.speak('네, 위로 번쩍 들었어요!');
    sweep(h, 0, 1.5, () => 0);
    expect(h.at(1.5).head.pitch).toBeLessThan(-0.2);
  });
});
