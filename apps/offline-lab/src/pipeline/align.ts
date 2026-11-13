import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Word } from '../shared/types';
import { readWav, voicedSpan } from './wav';

export interface AlignResult {
  /** 턴 음성 파일 기준 시각 */
  words: Word[];
  duration: number;
}

export interface Aligner {
  name: string;
  align(audioFile: string, text: string): Promise<AlignResult>;
}

const charCount = (s: string): number => s.replace(/\s/g, '').length;
const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/**
 * 글자 수 비례로 단어 시각을 추정한다. 키가 필요 없지만 정확하지 않다.
 * 전체 경로를 시험하거나, 실시간 추정 방식이 얼마나 어긋나는지 비교할 때 쓴다.
 */
export const naiveAligner: Aligner = {
  name: 'naive',
  async align(audioFile, text) {
    const wav = await readWav(audioFile);
    const span = voicedSpan(wav);
    const tokens = splitWords(text);
    const pauseAfter = (t: string): number => (/[.?!…]$/.test(t) ? 4 : /[,;:]$/.test(t) ? 2 : 0);
    const units = tokens.reduce((n, t) => n + charCount(t) + pauseAfter(t), 0) || 1;
    const perUnit = (span.end - span.start) / units;

    let cursor = span.start;
    const words = tokens.map((t) => {
      const start = cursor;
      const end = start + charCount(t) * perUnit;
      cursor = end + pauseAfter(t) * perUnit;
      return { text: t, start, end };
    });
    return { words, duration: wav.duration };
  },
};

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

/**
 * 음성 인식의 단어 타임스탬프를 정답으로 삼는다.
 * 인식된 글자와 대본 글자가 다를 수 있으므로, 인식 결과의 글자 위치 → 시각 대응을 만든 뒤
 * 대본 단어를 글자 비율로 그 위에 얹는다.
 */
export const whisperAligner: Aligner = {
  name: 'whisper',
  async align(audioFile, text) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('whisper 정렬에는 OPENAI_API_KEY 가 필요합니다 (.env)');

    const form = new FormData();
    form.append('file', new Blob([await readFile(audioFile)]), path.basename(audioFile));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new Error(`음성 인식 실패 ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { duration: number; words?: WhisperWord[] };
    const heard = json.words ?? [];
    if (heard.length === 0) throw new Error(`단어 타임스탬프를 받지 못했습니다: ${audioFile}`);

    return { words: mapOntoScript(heard, text), duration: json.duration };
  },
};

/** 인식된 단어 열의 글자 위치 → 시각 대응 위에 대본 단어를 얹는다. */
export function mapOntoScript(heard: WhisperWord[], text: string): Word[] {
  // 누적 글자 수 지점마다 시각을 기록한 꺾은선
  const points: { chars: number; time: number }[] = [];
  let acc = 0;
  for (const h of heard) {
    points.push({ chars: acc, time: h.start });
    acc += Math.max(1, charCount(h.word));
    points.push({ chars: acc, time: h.end });
  }
  const heardTotal = acc;

  const timeAt = (fraction: number): number => {
    const target = fraction * heardTotal;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!a || !b) continue;
      if (target <= b.chars) {
        const span = b.chars - a.chars;
        return span <= 0 ? b.time : a.time + ((target - a.chars) / span) * (b.time - a.time);
      }
    }
    return points[points.length - 1]?.time ?? 0;
  };

  const tokens = splitWords(text);
  const scriptTotal = tokens.reduce((n, t) => n + charCount(t), 0) || 1;
  let pos = 0;
  return tokens.map((t) => {
    const start = timeAt(pos / scriptTotal);
    pos += charCount(t);
    const end = timeAt(pos / scriptTotal);
    return { text: t, start, end: Math.max(end, start) };
  });
}

export function getAligner(name: string): Aligner {
  if (name === 'naive') return naiveAligner;
  if (name === 'whisper') return whisperAligner;
  throw new Error(`알 수 없는 정렬 방식: ${name} (naive | whisper)`);
}
