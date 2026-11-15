import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJevAnalyzer } from './analyzers/jev.js';
import type { BodySpec } from './body.js';
import { FACE_CHANNELS, channelQuestions, readChannelAnswers, settleChannels, type ChannelJudgment, type Duration } from './channels.js';
import type { AnalyzerInput, Judgment } from './judgment.js';
import { LiveDirector, LiveFace } from './live.js';
import { restProbs } from './regions.js';

/**
 * 부위별 수치 판단. 몸은 채널 목록만 선언하고, 엔진은 채널이 무엇인지 모른 채 세기와 유지 시간대로 재생한다.
 */

/** 귀와 눈꺼풀, 고개만 있는 몸. ARKit 에 없는 이름(earsUp)도 그대로 통과해야 한다. */
const DOG: BodySpec = {
  name: 'dog',
  describe: 'a dog face with two big ears.',
  moves: {},
  channels: [
    { name: 'earsUp', describe: 'the ears perk up', opposite: 'earsDown' },
    { name: 'earsDown', describe: 'the ears droop' },
    { name: 'eyeBlinkLeft', describe: 'the left eyelid closes' },
    { name: 'headRight', describe: 'the head turns right', opposite: 'headLeft' },
    { name: 'headLeft', describe: 'the head turns left' },
    { name: 'mouthSmileLeft', describe: 'the left mouth corner pulls up' },
  ],
};

const values = (v: Record<string, [number, Duration]>): ChannelJudgment =>
  Object.fromEntries(Object.entries(v).map(([k, [amount, duration]]) => [k, { amount, duration }]));
const judged = (channels: ChannelJudgment, reset = false): Judgment => ({ intensity: 0, regions: restProbs(), channels, reset });

describe('채널 질문', () => {
  it('채널마다 세기를 묻고, 말하는 구간에서는 유지 시간과 쉬는 자세 신호도 묻는다', () => {
    const speaking = channelQuestions(DOG, 'speaking');
    expect(Object.keys(speaking)).toHaveLength(DOG.channels!.length * 2 + 1);
    expect(JSON.stringify(speaking.earsUp)).toContain('the ears perk up');
    expect(JSON.stringify(speaking.earsUp)).toContain('a dog face with two big ears.');
    const listening = channelQuestions(DOG, 'listening');
    expect(Object.keys(listening)).toHaveLength(DOG.channels!.length);
  });

  it('얼굴의 표준 채널은 이름이 겹치지 않고, 반대 채널은 목록 안에 있다', () => {
    const names = FACE_CHANNELS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of FACE_CHANNELS) if (c.opposite) expect(names, c.name).toContain(c.opposite);
    expect(names).toContain('eyeBlinkLeft');
    expect(names).toContain('tongueOut');
    expect(names).toContain('headNod');
  });
});

describe('채널 값 정리', () => {
  it('반대 채널끼리는 차이만 남긴다', () => {
    const out = settleChannels(DOG, { earsUp: 0.9, earsDown: 0.6 });
    expect(out.earsUp).toBeGreaterThan(0.3);
    expect(out.earsUp).toBeLessThan(0.7);
    expect(out.earsDown).toBeUndefined();
    // 반대쪽이 잡음 수준이면 깎이지 않는다
    expect(settleChannels(DOG, { earsUp: 0.8, earsDown: 0.2 }).earsUp).toBe(1);
  });

  it('반대 채널이 한쪽에만 적혀 있어도 서로 뺀다', () => {
    const out = settleChannels(DOG, { earsUp: 0.2, earsDown: 0.9 });
    expect(out.earsDown).toBeGreaterThan(0.5);
    expect(out.earsUp).toBeUndefined();
  });

  it('바닥 아래의 애매한 값은 버리고, 그 위를 0~1 로 다시 편다', () => {
    expect(settleChannels(DOG, { mouthSmileLeft: 0.25 }).mouthSmileLeft).toBeUndefined();
    expect(settleChannels(DOG, { mouthSmileLeft: 0.8 }).mouthSmileLeft).toBe(1);
    expect(settleChannels(DOG, { mouthSmileLeft: 0.525 }).mouthSmileLeft).toBeCloseTo(0.5, 2);
  });

  it('답을 읽는다: 세기는 점수에서, 유지 시간은 선택에서', () => {
    const { channels, reset } = readChannelAnswers(DOG, 'speaking', {
      earsUp: { score: 3.8 },
      earsUp__d: { choice: 'stay' },
      eyeBlinkLeft: { score: 3.4 },
      eyeBlinkLeft__d: { choice: 'instant' },
      mouthSmileLeft: { score: 3 },
      mouthSmileLeft__d: { choice: 'none' },
      headRight: { score: 0.4 },
      __reset: { choice: 'no', probabilities: { no: 0.95, yes: 0.05 } },
    });
    expect(channels.earsUp?.duration).toBe('stay');
    expect(channels.eyeBlinkLeft?.duration).toBe('instant');
    // 세기는 있는데 "움직이지 않는다"를 골랐으면 말하는 동안으로 본다
    expect(channels.mouthSmileLeft?.duration).toBe('line');
    expect(channels.headRight).toBeUndefined();
    expect(reset).toBe(false);
  });
});

describe('Jev 분석기의 부위별 수치 판단', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mode 가 'channels' 이고 몸에 채널이 있으면 채널 질문을 보내고 채널 판단을 돌려준다", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent = (JSON.parse(init.body) as { questions: Record<string, unknown> }).questions;
      const answers: Record<string, unknown> = {};
      for (const [name, q] of Object.entries(sent as Record<string, { type: string; criteria: Record<string, string> | string[] }>)) {
        if (q.type === 'score') answers[name] = { type: 'score', score: name === 'earsUp' ? 4 : 0, confidence: 1 };
        else {
          const options = Object.keys(q.criteria);
          const choice = name.startsWith('earsUp') ? 'stay' : name.endsWith('__d') ? 'line' : (options[0] as string);
          answers[name] = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(options.map((o) => [o, o === choice ? 1 : 0])) };
        }
      }
      return new Response(JSON.stringify({ model: 'jev', answers }));
    });
    const analyzer = createJevAnalyzer({ apiKey: 'test' });
    const input: AnalyzerInput = { speaker: 'assistant', context: 'user: 귀 움직여봐', current: '네, 귀 쫑긋!', body: DOG };
    const j = await analyzer.analyze({ ...input, mode: 'channels' });
    expect(Object.keys(sent)).toContain('earsUp');
    expect(Object.keys(sent)).not.toContain('brows');
    expect(j.channels).toEqual({ earsUp: { amount: 1, duration: 'stay' } });

    // 같은 몸이라도 mode 를 주지 않으면 선택지 판단이다
    const plain = await analyzer.analyze(input);
    expect(Object.keys(sent)).toContain('brows');
    expect(plain.channels).toBeUndefined();
  });
});

describe('유지 시간대로 재생', () => {
  function run(answer: Judgment | ((input: AnalyzerInput) => Judgment)) {
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
    director.body = DOG;
    director.mode = 'channels';
    return {
      asked,
      director,
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
  /** from 부터 to 까지 매 프레임 돌리며 그 채널의 값을 모은다 */
  const sweep = (h: Harness, from: number, to: number, key: string): number[] => {
    const out: number[] = [];
    for (let t = from; t <= to; t += 1 / 30) out.push(h.at(t).expression.channels[key] ?? 0);
    return out;
  };
  const sayShort = async (h: Harness, text: string) => {
    await h.speak(text);
    sweep(h, 0, 1.6, 'x');
    h.stop(1.6);
  };
  const at = (list: number[], from: number, t: number): number => list[Math.round((t - from) * 30)] ?? 0;

  it('판단 요청에 방식과 몸 명세를 싣는다', async () => {
    const h = run(judged({}));
    await h.speak('네, 귀 쫑긋!');
    expect(h.asked.every((i) => i.mode === 'channels' && i.body === DOG)).toBe(true);
  });

  it('순간: 한 번 치고 빠진다', async () => {
    const h = run(judged(values({ eyeBlinkLeft: [1, 'instant'] })));
    await h.speak('좋아요, 찡긋! 방금 보셨죠? 한 번 더 할까요?');
    const v = sweep(h, 0, 6, 'eyeBlinkLeft');
    const closed = v.map((x) => x > 0.5);
    // 절마다 판단이 같으니 절 수만큼 깜빡이지만, 계속 감고 있지는 않는다
    expect(closed.filter((c, i) => c && !closed[i - 1]).length).toBeGreaterThanOrEqual(1);
    expect(closed.filter(Boolean).length / closed.length).toBeLessThan(0.35);
  });

  it('말하는 동안: 그 말이 끝나면 사라진다', async () => {
    const h = run(judged(values({ mouthSmileLeft: [0.8, 'line'] })));
    await sayShort(h, '와, 축하드려요!');
    const v = sweep(h, 1.6, 6, 'mouthSmileLeft');
    expect(at(v, 1.6, 1.7)).toBeGreaterThan(0.5);
    expect(at(v, 1.6, 5)).toBeLessThan(0.05);
  });

  it('머무는 자세: 말이 끝난 뒤에도 몇 초 남았다가 돌아온다', async () => {
    const h = run(judged(values({ headRight: [1, 'stay'] })));
    await sayShort(h, '네, 오른쪽으로 휙!');
    const v = sweep(h, 1.6, 12, 'headRight');
    expect(at(v, 1.6, 5)).toBeGreaterThan(0.9);
    expect(at(v, 1.6, 11.5)).toBeLessThan(0.05);
  });

  it('시킬 때까지: 훨씬 오래 남고, 쉬는 자세 신호가 오면 풀린다', async () => {
    const h = run((i) => (i.current.includes('정면') ? judged({}, true) : judged(values({ headRight: [1, 'until_told'] }))));
    await sayShort(h, '네, 계속 오른쪽 볼게요.');
    expect(at(sweep(h, 1.6, 40, 'headRight'), 1.6, 39)).toBeGreaterThan(0.9);
    await h.speak('네, 다시 정면으로!');
    const v = sweep(h, 40, 44, 'headRight');
    expect(v[v.length - 1]).toBeLessThan(0.05);
  });

  it('반대쪽 자세가 오면 앞의 자세는 풀린다', async () => {
    const h = run((i) => (i.current.includes('왼쪽') ? judged(values({ headLeft: [1, 'stay'] })) : judged(values({ headRight: [1, 'until_told'] }))));
    await sayShort(h, '네, 계속 오른쪽 볼게요.');
    await h.speak('이번엔 왼쪽으로 갑니다!');
    sweep(h, 1.6, 5, 'x');
    const frame = h.at(5).expression.channels;
    expect(frame.headRight ?? 0).toBeLessThan(0.05);
    expect(frame.headLeft ?? 0).toBeGreaterThan(0.9);
  });

  it('엔진이 모르는 이름의 채널도 프레임과 얼굴 값에 그대로 실린다', async () => {
    const h = run(judged(values({ earsUp: [0.9, 'stay'] })));
    await h.speak('네, 귀 쫑긋!');
    sweep(h, 0, 1.2, 'x');
    const frame = h.at(1.2);
    expect(frame.expression.channels.earsUp).toBeGreaterThan(0.8);
    // 리그는 프레임의 shapes 에서 자기 채널을 읽는다
    expect(frame.shapes.earsUp).toBeGreaterThan(0.8);
  });

  it('머리 채널은 얼굴에서 머리 각도가 된다(오른쪽은 yaw 양수)', async () => {
    const h = run(judged(values({ headRight: [1, 'stay'] })));
    await h.speak('네, 오른쪽으로 휙!');
    sweep(h, 0, 1.2, 'x');
    expect(h.at(1.2).head.yaw).toBeGreaterThan(0.35);
  });
});
