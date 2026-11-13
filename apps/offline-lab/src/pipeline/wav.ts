import { readFile } from 'node:fs/promises';

export interface WavInfo {
  sampleRate: number;
  duration: number;
  /** 모노로 합친 -1~1 샘플 */
  samples: Float32Array;
}

/** 16비트 PCM WAV 를 읽는다. 다른 형식이면 오류를 던진다. */
export async function readWav(file: string): Promise<WavInfo> {
  const buf = await readFile(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`WAV 파일이 아닙니다: ${file}`);
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  let data: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    offset = body + size + (size % 2);
  }

  if (!data || !sampleRate || !channels) throw new Error(`WAV 헤더를 읽지 못했습니다: ${file}`);
  if (format !== 1 || bits !== 16) {
    throw new Error(`16비트 PCM WAV 만 지원합니다 (format=${format}, bits=${bits}): ${file}`);
  }

  const frames = Math.floor(data.length / (2 * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2);
    samples[i] = sum / channels / 32768;
  }
  return { sampleRate, duration: frames / sampleRate, samples };
}

/** 앞뒤 무음을 뺀, 소리가 나는 구간 [start, end] 를 찾는다. */
export function voicedSpan(wav: WavInfo, threshold = 0.01): { start: number; end: number } {
  const win = Math.max(1, Math.floor(wav.sampleRate * 0.01));
  const count = Math.floor(wav.samples.length / win);
  let first = -1;
  let last = -1;
  for (let w = 0; w < count; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) {
      const s = wav.samples[i] ?? 0;
      sum += s * s;
    }
    if (Math.sqrt(sum / win) > threshold) {
      if (first < 0) first = w;
      last = w;
    }
  }
  if (first < 0) return { start: 0, end: wav.duration };
  return { start: (first * win) / wav.sampleRate, end: ((last + 1) * win) / wav.sampleRate };
}
