import { describe, expect, it } from 'vitest';
import type { Word } from '../shared/types';
import { segmentWords } from './segment';

/** 단어마다 0.3초씩 차지하는 가짜 정렬 */
const words = (text: string): Word[] =>
  text.split(/\s+/).map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }));

describe('segmentWords', () => {
  it('문장 끝에서 끊는다', () => {
    const segs = segmentWords(words('정말 축하드려요! 그동안 고생 많으셨어요.'));
    expect(segs.map((s) => s.text)).toEqual(['정말 축하드려요!', '그동안 고생 많으셨어요.']);
  });

  it('쉼표는 충분히 모였을 때만 끊는다', () => {
    const short = segmentWords(words('네, 알겠습니다.'));
    expect(short).toHaveLength(1);

    const long = segmentWords(
      words('면접에서 떨어졌다는 소식을 들으셨다니 속상하셨겠어요, 그래도 다음 기회가 있을 거예요.'),
    );
    expect(long).toHaveLength(2);
    expect(long[0]?.text.endsWith(',')).toBe(true);
  });

  it('구두점이 없어도 최대 길이에서 끊는다', () => {
    const text = Array.from({ length: 30 }, () => '가나다라').join(' ');
    const segs = segmentWords(words(text), { minChars: 15, maxChars: 40 });
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.text.replace(/\s/g, '').length).toBeLessThanOrEqual(40);
  });

  it('시각은 첫 단어의 시작과 마지막 단어의 끝을 따른다', () => {
    const w = words('오늘은 날씨가 좋네요. 산책 갈까요?');
    const segs = segmentWords(w);
    expect(segs[0]?.start).toBe(w[0]?.start);
    expect(segs[0]?.end).toBe(w[2]?.end);
    expect(segs[1]?.start).toBe(w[3]?.start);
    expect(segs[1]?.end).toBe(w[4]?.end);
  });

  it('꼬리의 아주 짧은 조각은 앞 구간에 붙인다', () => {
    const segs = segmentWords(words('그건 정말 놀라운 소식이네요. 와'));
    expect(segs).toHaveLength(1);
    expect(segs[0]?.text.endsWith('와')).toBe(true);
  });

  it('빈 입력은 빈 결과', () => {
    expect(segmentWords([])).toEqual([]);
  });
});
