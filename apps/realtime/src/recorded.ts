import type { AnalyzerInput, Judgment } from '@redbridge/faceling-core/judgment';
import { restProbs } from '@redbridge/faceling-core/regions';

/**
 * 녹화된 판단. 서버와 키 없이 정적 페이지(GitHub Pages)에서 예시 대화를 재생할 때 쓴다.
 * scripts/record.ts 가 예시 대화를 실제 Jev 로 한 번 돌려 public/recordings.json 에 남기고,
 * 정적 페이지는 판단을 묻는 대신 여기서 같은 구간의 답을 찾아 돌려준다.
 */
export type Recordings = Record<string, Judgment>;

/** 같은 몸, 같은 화자끼리 묶는 앞머리 */
const group = (input: AnalyzerInput): string => `${input.body?.name ?? ''}|${input.speaker}|`;

/** 판단 하나를 찾는 열쇠: 몸, 화자, 판단 대상 구간 */
export const recordKey = (input: AnalyzerInput): string => group(input) + input.current.trim();

/**
 * 녹화에서 이 구간의 판단을 찾는다. 글이 도착하는 박자에 따라 구간이 조금 다르게 잘릴 수 있어,
 * 꼭 맞는 것이 없으면 같은 몸·화자의 녹화 가운데 앞부분이 가장 길게 겹치는 것을 쓴다.
 * 그것도 없으면 아무 표정도 짓지 않는 판단을 돌려준다.
 */
export function findRecorded(recordings: Recordings, input: AnalyzerInput): Judgment {
  const exact = recordings[recordKey(input)];
  if (exact) return exact;
  const prefix = group(input);
  const text = input.current.trim();
  let best: Judgment | null = null;
  let overlap = 0;
  for (const [key, judgment] of Object.entries(recordings)) {
    if (!key.startsWith(prefix)) continue;
    const other = key.slice(prefix.length);
    if (!other.startsWith(text) && !text.startsWith(other)) continue;
    const length = Math.min(other.length, text.length);
    if (length > overlap) [best, overlap] = [judgment, length];
  }
  return best ?? { intensity: 0, regions: restProbs() };
}
