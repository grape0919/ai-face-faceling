import type { Word } from '../shared/types';

export interface SegmentOptions {
  /** 쉼표에서 끊으려면 최소 이만큼은 모여 있어야 한다 (공백 제외 글자 수) */
  minChars: number;
  /** 구두점이 없어도 이 길이를 넘으면 끊는다 */
  maxChars: number;
}

export interface RawSegment {
  text: string;
  start: number;
  end: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = { minChars: 15, maxChars: 40 };

const SENTENCE_END = /[.?!…。？！]["')\]」』]*$/;
const CLAUSE_END = /[,，、;:]$/;
/** 이보다 짧은 조각은 독립 구간으로 두지 않는다 */
const TINY = 4;

const charCount = (s: string): number => s.replace(/\s/g, '').length;

/**
 * 단어 열을 절 단위 구간으로 나눈다.
 * 문장 끝에서는 항상 끊고, 쉼표에서는 minChars 이상 모였을 때 끊고, maxChars 를 넘으면 강제로 끊는다.
 */
export function segmentWords(
  words: Word[],
  options: SegmentOptions = DEFAULT_SEGMENT_OPTIONS,
): RawSegment[] {
  const out: RawSegment[] = [];
  let buf: Word[] = [];
  let len = 0;

  const flush = (): void => {
    const first = buf[0];
    const last = buf[buf.length - 1];
    if (!first || !last) return;
    out.push({ text: buf.map((w) => w.text).join(' '), start: first.start, end: last.end });
    buf = [];
    len = 0;
  };

  for (const word of words) {
    buf.push(word);
    len += charCount(word.text);
    if (SENTENCE_END.test(word.text)) {
      if (len >= TINY) flush();
    } else if (CLAUSE_END.test(word.text)) {
      if (len >= options.minChars) flush();
    } else if (len >= options.maxChars) {
      flush();
    }
  }
  flush();

  // 꼬리에 남은 아주 짧은 조각은 앞 구간에 붙인다
  const tail = out[out.length - 1];
  const prev = out[out.length - 2];
  if (tail && prev && charCount(tail.text) < TINY) {
    prev.text = `${prev.text} ${tail.text}`;
    prev.end = tail.end;
    out.pop();
  }
  return out;
}
