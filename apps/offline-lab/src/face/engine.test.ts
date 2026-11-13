import { describe, expect, it } from 'vitest';
import { REGION_KEYS, onlyAction, regionSpec, restProbs, type Region } from '../shared/regions';
import { SESSION_FORMAT, type Judgment, type Session, type Speaker } from '../shared/types';
import { VARIANTS, actionWeight, buildCues, buildGestures, targetWeights, type Level } from './cues';
import { FaceEngine } from './engine';
import { ACTION_POSES, ARKIT_52, applyActions, emptyPose, gazeShapes } from './mapping';

const j = (picks: Partial<Record<Region, string>>, intensity = 1): Judgment => {
  const regions = restProbs();
  for (const [region, action] of Object.entries(picks) as [Region, string][]) {
    regions[region] = onlyAction(region, action, 0.95);
  }
  return { intensity, regions };
};

const turn = (index: number, speaker: Speaker, start: number, end: number, judgment: Judgment) => ({
  index,
  speaker,
  text: 'x',
  audio: 'x.wav',
  start,
  end,
  words: [],
  segments: [{ index, text: 'x', start, end, judgment }],
});

/** 0~4초 사용자가 힘든 이야기(듣는 반응: 걱정), 5~9초 AI 가 기뻐함, 10~14초 AI 가 사과 */
const session: Session = {
  format: SESSION_FORMAT,
  title: 't',
  name: 't',
  analyzer: 'test',
  aligner: 'test',
  duration: 16,
  turns: [
    turn(0, 'user', 0, 4, j({ brows: 'inner_up', head: 'nod' })),
    turn(1, 'assistant', 5, 9, j({ mouth: 'grin', eyes: 'smiling', cheeks: 'raised' })),
    turn(2, 'assistant', 10, 14, j({ brows: 'inner_up', gaze: 'down', head: 'lowered', mouth: 'pressed' })),
  ],
};

/** 0초부터 until 까지 60fps 로 돌린 뒤 마지막 프레임을 돌려준다 */
const runTo = (level: Level, until: number) => {
  const engine = new FaceEngine(session, level);
  let frame = engine.update(0, null);
  for (let t = 0; t <= until; t += 1 / 60) frame = engine.update(t, null);
  return frame;
};

describe('판단값 → 동작 세기', () => {
  it('확률이 낮은 선택지는 버리고 높은 선택지는 온전히 준다', () => {
    expect(actionWeight(0.1)).toBe(0);
    expect(actionWeight(0.2)).toBe(0);
    expect(actionWeight(0.45)).toBeCloseTo(0.5);
    expect(actionWeight(0.9)).toBe(1);
  });

  it('분석기가 고른 동작만 켜진다', () => {
    const w = targetWeights(j({ brows: 'raised' }), 'L');
    expect(w['brows.raised']).toBe(1);
    expect(w['brows.lowered']).toBe(0);
    expect(w['mouth.smile']).toBe(0);
  });

  it('표정 세기 판단이 낮으면 동작이 약해진다', () => {
    expect(targetWeights(j({ brows: 'raised' }, 0), 'L')['brows.raised']).toBeCloseTo(0.25);
  });

  it('좌우가 있는 동작은 정해진 쪽만 켜진다', () => {
    const w = targetWeights(j({ mouth: 'smirk' }), 'R');
    expect(w['mouth.smirk@R']).toBe(1);
    expect(w['mouth.smirk@L']).toBe(0);
  });
});

describe('동작 → 얼굴', () => {
  it('기본 선택지와 순간 동작을 뺀 모든 동작에 얼굴 정의가 있다', () => {
    for (const v of VARIANTS) expect(ACTION_POSES[`${v.region}.${v.action}`], v.key).toBeDefined();
    for (const region of REGION_KEYS) {
      for (const action of Object.keys(regionSpec(region).actions)) {
        const known = VARIANTS.some((v) => v.region === region && v.action === action);
        const skipped = action === regionSpec(region).rest || ['head.nod', 'head.shake'].includes(`${region}.${action}`);
        expect(known || skipped, `${region}.${action}`).toBe(true);
      }
    }
  });

  it('동작과 립싱크, 깜빡임, 시선을 합치면 ARKit 52개가 모두 쓰인다', () => {
    const used = new Set<string>(['jawOpen', 'mouthFunnel', 'eyeBlinkLeft', 'eyeBlinkRight']);
    for (const side of [1, -1]) {
      const pose = emptyPose();
      applyActions(pose, Object.fromEntries(VARIANTS.map((v) => [v.key, 1])));
      pose.gaze = { x: side, y: side };
      gazeShapes(pose);
      for (const [name, value] of Object.entries(pose.shapes)) if (value > 0) used.add(name);
    }
    expect(ARKIT_52.filter((name) => !used.has(name))).toEqual([]);
    expect([...used].filter((name) => !(ARKIT_52 as readonly string[]).includes(name))).toEqual([]);
  });

  it('한쪽 미소는 고른 쪽 입꼬리가 더 올라간다', () => {
    const pose = emptyPose();
    applyActions(pose, { 'mouth.smirk@R': 1 });
    expect(pose.shapes.mouthSmileRight ?? 0).toBeGreaterThan((pose.shapes.mouthSmileLeft ?? 0) + 0.3);
  });
});

describe('수준별 예약', () => {
  it('L0 은 예약이 없고, L1 은 AI 구간만, L2 는 사용자 구간도 가진다', () => {
    expect(buildCues(session, 'L0')).toHaveLength(0);
    expect(buildCues(session, 'L1').map((c) => c.kind)).toEqual(['speak', 'speak']);
    expect(buildCues(session, 'L2').map((c) => c.kind)).toEqual(['react', 'speak', 'speak']);
  });

  it('분석기가 고른 끄덕임은 L2 에서만 사용자 구간에 들어간다', () => {
    const nodsIn = (level: Level) => buildGestures(session, level).filter((g) => g.type === 'nod' && g.t > 3.5 && g.t < 4);
    expect(nodsIn('L2')).toHaveLength(1);
    expect(nodsIn('L1')).toHaveLength(0);
  });
});

describe('FaceEngine', () => {
  it('턴 상태를 구분한다', () => {
    const engine = new FaceEngine(session, 'L0');
    expect(engine.turnAt(2)).toBe('listening');
    expect(engine.turnAt(4.5)).toBe('thinking');
    expect(engine.turnAt(7)).toBe('speaking');
    expect(engine.turnAt(9.5)).toBe('idle');
  });

  it('L1 은 웃음 구간에서 웃고 L0 은 웃지 않는다', () => {
    expect(runTo('L1', 7).shapes.mouthSmileLeft ?? 0).toBeGreaterThan(0.6);
    expect(runTo('L0', 7).shapes.mouthSmileLeft ?? 0).toBe(0);
  });

  it('L1 은 사과 구간에서 눈썹 안쪽이 올라가고 고개와 시선이 내려간다', () => {
    const l1 = runTo('L1', 12);
    const l0 = runTo('L0', 12);
    expect(l1.shapes.browInnerUp ?? 0).toBeGreaterThan((l0.shapes.browInnerUp ?? 0) + 0.5);
    expect(l1.head.pitch).toBeGreaterThan(l0.head.pitch + 0.05);
    expect(l1.shapes.eyeLookDownLeft ?? 0).toBeGreaterThan(0.3);
  });

  it('L2 만 사용자가 말하는 동안 반응한다', () => {
    expect(runTo('L2', 4).debug.weights['brows.inner_up']).toBeGreaterThan(0.3);
    expect(runTo('L1', 4).debug.weights['brows.inner_up']).toBe(0);
  });

  it('눈썹은 입보다 먼저 사라진다', () => {
    const frame = runTo('L1', 10.2);
    // 5~9초 구간이 끝난 뒤. 입꼬리는 아직 남아 있고, 그 구간에 없던 눈썹은 새 구간의 것으로 바뀌는 중이다.
    const after = runTo('L1', 9.9);
    expect(after.debug.weights['mouth.grin']).toBeGreaterThan(after.debug.weights['eyes.smiling'] ?? 0);
    expect(frame.debug.weights['mouth.grin']).toBeLessThan(after.debug.weights['mouth.grin'] ?? 0);
  });

  it('표정이 시작될 때 눈썹이 잠깐 더 크게 움직인다', () => {
    const early = runTo('L1', 10.45).debug.weights['brows.inner_up'] ?? 0;
    const settled = runTo('L1', 13).debug.weights['brows.inner_up'] ?? 0;
    expect(early).toBeGreaterThan(settled);
  });

  it('깜빡임은 수준과 무관하게 같은 시각에 일어난다', () => {
    const blinkTimes = (level: Level): number[] => {
      const engine = new FaceEngine(session, level);
      const times: number[] = [];
      let prev = 0;
      for (let t = 0; t <= 9.5; t += 1 / 60) {
        const v = engine.update(t, null).shapes.eyeBlinkLeft ?? 0;
        if (prev < 0.5 && v >= 0.5) times.push(Math.round(t * 10));
        prev = v;
      }
      return times;
    };
    const base = blinkTimes('L0');
    expect(base.length).toBeGreaterThan(1);
    expect(blinkTimes('L2')).toEqual(base);
  });

  it('모든 blendshape 값은 0~1 범위이고 이름은 ARKit 52개 안에 있다', () => {
    const engine = new FaceEngine(session, 'L2');
    for (let t = 0; t <= 15; t += 1 / 30) {
      const frame = engine.update(t, { jaw: 1, funnel: 1, stretch: 1 });
      for (const [name, v] of Object.entries(frame.shapes)) {
        expect(ARKIT_52 as readonly string[]).toContain(name);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
