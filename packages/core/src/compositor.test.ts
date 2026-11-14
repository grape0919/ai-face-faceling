import { describe, expect, it } from 'vitest';
import { Compositor, type CompositorInput } from './compositor.js';
import { facePose } from './face.js';
import { zeroWeights } from './weights.js';

const input = (over: Partial<CompositorInput> = {}): CompositorInput => ({
  turn: 'speaking',
  target: { ...zeroWeights(), 'brows.inner_up': 0.8, 'head.tilt': 0.5 },
  targetSince: 0,
  gestures: [{ type: 'nod', t: 0, dur: 0.6, amp: 0.1 }],
  mouth: { jaw: 0.6, funnel: 0.2, stretch: 0.1 },
  blink: 0,
  ...over,
});

describe('Compositor', () => {
  it('얼굴 출력은 표현을 얼굴 어댑터에 넣은 것과 같다', () => {
    const a = new Compositor();
    const b = new Compositor();
    const pose = a.step(0.3, 10, input());
    const expression = b.express(0.3, 10, input());
    expect(facePose(expression)).toEqual(pose);
  });

  it('표현은 얼굴 없이도 쓸 수 있는 값만 담는다', () => {
    const e = new Compositor().express(0.3, 10, input());
    // 눈썹은 시작 직후 잠깐 더 크게 움직인다
    expect(e.weights['brows.inner_up']).toBeGreaterThan(0.8);
    expect(e.weights['head.tilt']).toBeCloseTo(0.5, 2);
    expect(e.turn.speaking).toBeCloseTo(1, 3);
    expect(e.gesture.nod).toBeGreaterThan(0.05);
    expect(e.mouth.jaw).toBeCloseTo(0.6, 2);
    expect(e).not.toHaveProperty('shapes');
  });

  it('말하지 않을 때는 입 모양이 0 이다', () => {
    const e = new Compositor().express(0.3, 10, input({ turn: 'listening' }));
    expect(e.mouth).toEqual({ jaw: 0, funnel: 0, stretch: 0 });
  });
});
