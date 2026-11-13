import { describe, expect, it } from 'vitest';
import { ClauseSplitter } from './clauses';
import type { AnalyzerInput, Judgment } from './judgment';
import { LiveDirector, LiveFace } from './live';
import { onlyAction, restProbs, type Region } from './regions';

const j = (picks: Partial<Record<Region, string>>, intensity = 1): Judgment => {
  const regions = restProbs();
  for (const [region, action] of Object.entries(picks) as [Region, string][]) {
    regions[region] = onlyAction(region, action, 0.95);
  }
  return { intensity, regions };
};

/** 손으로 돌리는 시계와, 정해진 시간 뒤에 답하는 분석기 */
function harness(latency: number, answer: (input: AnalyzerInput) => Judgment = () => j({ mouth: 'smile' })) {
  let now = 0;
  const waiting: { at: number; run: () => void }[] = [];
  const asked: AnalyzerInput[] = [];
  const face = new LiveFace();
  const director = new LiveDirector(face, {
    clock: () => now,
    secondsPerChar: 0.2,
    judge: (input) => {
      asked.push(input);
      return new Promise((resolve) => waiting.push({ at: now + latency, run: () => resolve(answer(input)) }));
    },
  });
  /** 시각을 to 까지 흘려보내며 그 사이에 도착할 응답을 차례로 돌려준다 */
  const advance = async (to: number): Promise<void> => {
    for (;;) {
      const next = waiting.filter((w) => w.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      waiting.splice(waiting.indexOf(next), 1);
      now = next.at;
      next.run();
      await new Promise((r) => setTimeout(r, 0));
    }
    now = to;
  };
  return { face, director, asked, advance, now: () => now };
}

describe('ClauseSplitter', () => {
  it('조각으로 들어온 텍스트를 문장 끝에서 끊는다', () => {
    const s = new ClauseSplitter();
    expect(s.push('안녕하')).toEqual([]);
    expect(s.push('세요! 오늘 ')).toEqual([{ text: '안녕하세요!', charsBefore: 0, chars: 6 }]);
    expect(s.push('하루는 어떠셨어요?')).toEqual([]);
    expect(s.flush()).toEqual([{ text: '오늘 하루는 어떠셨어요?', charsBefore: 6, chars: 11 }]);
  });

  it('쉼표에서는 충분히 모였을 때만 끊고, 너무 길면 강제로 끊는다', () => {
    const s = new ClauseSplitter({ minChars: 15, maxChars: 40 });
    expect(s.push('네, 그런데 방금 다른 회사에서 최종 합격했다는 ').map((c) => c.text)).toEqual([]);
    const long = s.push('메일이 왔고 그래서 지금 기분이 아주 좋은 상태입니다 정말로 ').map((c) => c.text);
    expect(long).toHaveLength(1);
    expect(long[0]?.replace(/\s/g, '').length).toBeGreaterThanOrEqual(40);
  });
});

describe('LiveDirector', () => {
  it('판단이 소리보다 먼저 오면 그 절의 소리 시각에 표정을 건다', async () => {
    const h = harness(0.2);
    h.director.assistantStarted();
    h.director.assistantText('안녕하세요! 만나서 정말 반갑습니다. ');
    await h.advance(0.5);
    h.director.assistantAudioStarted();

    // 둘째 절은 첫 절(6글자 × 0.2초)과 문장 뒤 쉼(0.3초) 다음에 시작한다
    expect(h.face.activeCue(0.6)?.text).toBe('안녕하세요!');
    expect(h.face.activeCue(0.5 + 1.2 + 0.3 + 0.1)?.text).toBe('만나서 정말 반갑습니다.');
    expect(h.director.stats.judged).toBe(2);
    expect(h.director.stats.missed).toBe(0);
    expect(h.director.stats.lastLead).toBeCloseTo(1.5);
  });

  it('판단이 늦으면 도착한 때부터 걸고, 절이 이미 지나갔으면 버린다', async () => {
    const h = harness(1.7);
    h.director.assistantStarted();
    h.director.assistantAudioStarted();
    h.director.assistantText('알겠습니다. 지금부터 천천히 하나씩 설명해 드리겠습니다. ');
    await h.advance(1.8);

    // 첫 절은 0~1.2초에 나온다. 판단이 1.7초에 왔으므로 이미 지나갔다.
    expect(h.director.stats.missed).toBe(1);
    // 둘째 절은 1.5초에 시작했고, 판단이 도착한 1.7초부터 걸린다
    const cue = h.face.activeCue(1.8);
    expect(cue?.text).toBe('지금부터 천천히 하나씩 설명해 드리겠습니다.');
    expect(cue?.t).toBeCloseTo(1.7);
  });

  it('사용자가 끼어들면 예약된 표정을 거둔다', async () => {
    const h = harness(0.1);
    h.director.assistantStarted();
    h.director.assistantText('안녕하세요! 만나서 정말 반갑습니다. ');
    h.director.assistantAudioStarted();
    await h.advance(0.3);
    expect(h.face.activeCue(0.3)).not.toBeNull();

    h.director.assistantInterrupted();
    expect(h.face.activeCue(0.31)).toBeNull();
    expect(h.face.activeCue(2)).toBeNull();
    expect(h.face.turn).toBe('listening');
  });

  it('사용자 말에는 듣는 반응을 걸고, AI 가 말을 시작하면 거둔다', async () => {
    const h = harness(0.2, (input) => (input.speaker === 'user' ? j({ brows: 'inner_up' }) : j({ mouth: 'smile' })));
    h.director.userSpeechStarted();
    expect(h.face.turn).toBe('listening');
    await h.advance(2);
    h.director.userSpeechStopped();
    expect(h.face.turn).toBe('thinking');
    h.director.userTranscript('오늘 좀 힘들었어요.');
    await h.advance(2.3);
    expect(h.face.activeCue(2.3)?.kind).toBe('react');

    h.director.assistantStarted();
    h.director.assistantAudioStarted();
    expect(h.face.turn).toBe('speaking');
    // 말을 시작한 직후에는 듣는 반응이 이어지고, 조금 뒤에 사라진다
    expect(h.face.activeCue(2.3 + 0.5)?.kind).toBe('react');
    expect(h.face.activeCue(2.3 + 1.2)).toBeNull();
    expect(h.asked[0]?.speaker).toBe('user');
  });

  it('사용자가 말하는 도중에도 들리는 대로 반응한다', async () => {
    const h = harness(0.2, (input) => (input.speaker === 'user' ? j({ brows: 'inner_up' }) : j({ mouth: 'smile' })));
    h.director.userSpeechStarted();
    h.director.userPartial('사실');
    expect(h.asked).toHaveLength(0);
    h.director.userPartial('사실 오늘 좀 힘들었어요');
    expect(h.asked).toHaveLength(1);
    // 판단을 기다리는 동안 더 들린 말은 쌓아 두었다가, 다음에 충분히 모이면 다시 묻는다
    h.director.userPartial('사실 오늘 좀 힘들었어요. 지난주에');
    expect(h.asked).toHaveLength(1);
    await h.advance(0.3);
    expect(h.face.activeCue(0.3)?.kind).toBe('react');
    expect(h.face.turn).toBe('listening');
    h.director.userPartial('사실 오늘 좀 힘들었어요. 지난주에 본 면접에서 떨어졌다는');
    expect(h.asked).toHaveLength(2);
  });

  it('AI 의 말을 판단할 때 직전 사용자 말과 방금 한 말을 함께 넘긴다', async () => {
    const h = harness(0.05);
    h.director.userSpeechStarted();
    h.director.userPartial('저 오늘 회사에서 해고됐어요');
    h.director.userSpeechStopped();
    // 최종 전사는 아직 오지 않았다. 그래도 도중에 들린 말이 맥락에 들어간다.
    h.director.assistantStarted();
    h.director.assistantText('정말요? 많이 놀라셨겠어요. 지금 기분은 좀 어떠세요? 천천히 말씀해 주세요. ');
    const asked = h.asked.filter((a) => a.speaker === 'assistant');
    expect(asked[0]?.context).toBe('user: 저 오늘 회사에서 해고됐어요');
    // 응답이 길어져도 사용자의 말은 맥락에 남는다
    expect(asked[3]?.context).toBe(
      'user: 저 오늘 회사에서 해고됐어요\nassistant: 많이 놀라셨겠어요.\nassistant: 지금 기분은 좀 어떠세요?',
    );

    // 늦게 온 최종 전사는 같은 자리를 채운다(대화 순서가 뒤바뀌거나 겹치지 않는다)
    h.director.assistantAudioStarted();
    h.director.userTranscript('저 오늘 회사에서 해고됐어요.');
    await h.advance(6);
    h.director.assistantAudioStopped();
    h.director.assistantStarted();
    h.director.assistantText('힘내세요. ');
    const last = h.asked[h.asked.length - 1];
    expect(last?.context.split('\n')[0]).toBe('user: 저 오늘 회사에서 해고됐어요.');
    expect(last?.context.split('\n')).toHaveLength(2);
  });

  it('첫 절이 길면 앞머리만 보고 시작 표정을 먼저 건다', async () => {
    const h = harness(0.2);
    h.director.assistantStarted();
    h.director.assistantAudioStarted();
    // 첫 절이 아직 끝나지 않았다
    h.director.assistantText('아이고, 그 소식 들었을 때 ');
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]?.current).toBe('아이고, 그 소식 들었을 때');
    await h.advance(0.3);
    expect(h.face.activeCue(0.3)?.text).toContain('아이고');
    expect(h.director.stats.meanFirstDelay).toBeCloseTo(0.2);

    // 첫 절이 완성되면 그 판단이 이어받는다
    h.director.assistantText('마음이 푹 꺼졌겠어요. ');
    await h.advance(0.6);
    expect(h.face.activeCue(0.6)?.text).toBe('아이고, 그 소식 들었을 때 마음이 푹 꺼졌겠어요.');
  });

  it('응답이 끝나면 실제 재생 시간으로 말 빠르기를 고친다', async () => {
    const h = harness(0.05);
    h.director.assistantStarted();
    h.director.assistantText('오늘은 날씨가 아주 맑고 따뜻합니다.');
    h.director.assistantTextDone();
    h.director.assistantAudioStarted();
    // 16글자를 0.1초씩 말하고 문장 뒤에 0.3초 쉬었다고 하자
    await h.advance(1.6 + 0.3);
    h.director.assistantAudioStopped();
    expect(h.director.stats.secondsPerChar).toBeCloseTo(0.15);
    expect(h.face.turn).toBe('idle');
  });

  it('얼굴은 예약된 표정을 향해 움직인다', async () => {
    const h = harness(0.05);
    h.director.assistantStarted();
    h.director.assistantText('정말 축하드려요! ');
    h.director.assistantAudioStarted();
    await h.advance(0.1);
    let frame = h.face.update(0.1, null);
    for (let t = 0.1; t <= 1; t += 1 / 60) frame = h.face.update(t, null);
    expect(frame.shapes.mouthSmileLeft ?? 0).toBeGreaterThan(0.3);
    expect(frame.debug.turn).toBe('speaking');
  });
});
