import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJevAnalyzer } from '@redbridge/faceling-core/analyzers/jev';
import type { Judgment } from '@redbridge/faceling-core/judgment';
import { LiveDirector, LiveFace } from '@redbridge/faceling-core/live';
import { ARM_BODY, DOG_BODY, FACE_BODY } from '@redbridge/faceling-rigs/bodies';
import { recordKey, type Recordings } from '../src/recorded';
import { Simulation, demoLines } from '../src/simulate';

/**
 * 예시 대화를 실제 Jev 로 한 번 돌려 판단을 녹화한다(npm run record -w @redbridge/faceling-realtime).
 * 화면과 똑같은 경로(모의 대화 → LiveDirector → 판단)를 몸과 언어마다 돌리고,
 * 그때 오간 판단을 public/recordings.json 에 남긴다. 정적 페이지가 이 파일을 재생한다.
 * 예시 대화의 글이나 질문을 바꾸면 다시 돌려야 한다. TYPESAFE_API_KEY 가 필요하다.
 */

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
try {
  process.loadEnvFile(path.join(APP_ROOT, '..', '..', '.env'));
} catch {
  // .env 가 없으면 환경 변수만 쓴다
}

const analyzer = createJevAnalyzer();
const recordings: Recordings = {};

const round = (n: number): number => Math.round(n * 1000) / 1000;
/** 파일이 커지지 않게 소수 셋째 자리까지만 남긴다 */
const compact = (j: Judgment): Judgment => ({
  ...j,
  intensity: round(j.intensity),
  regions: Object.fromEntries(
    Object.entries(j.regions).map(([region, probs]) => [region, Object.fromEntries(Object.entries(probs).map(([action, p]) => [action, round(p)]))]),
  ) as Judgment['regions'],
});

async function record(lang: 'ko' | 'en', body: typeof FACE_BODY): Promise<void> {
  const clock = (): number => performance.now() / 1000;
  const face = new LiveFace();
  const director = new LiveDirector(face, {
    clock,
    judge: async (input) => {
      const judgment = compact(await analyzer.analyze(input));
      recordings[recordKey(input)] = judgment;
      return judgment;
    },
  });
  director.body = body;
  // 화면처럼 프레임을 계속 돌려 준다
  const frames = setInterval(() => face.update(clock(), null), 33);
  try {
    await new Simulation(director, () => undefined).run(demoLines(lang, body.name));
  } finally {
    clearInterval(frames);
  }
  console.log(`녹화 끝: ${lang} / ${body.name}`);
}

const runs: Array<Promise<void>> = [];
for (const lang of ['ko', 'en'] as const) for (const body of [FACE_BODY, DOG_BODY, ARM_BODY]) runs.push(record(lang, body));
await Promise.all(runs);
// 마지막 판단이 돌아올 시간을 준다
await new Promise((r) => setTimeout(r, 1500));

const sorted = Object.fromEntries(Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)));
const file = path.join(APP_ROOT, 'public', 'recordings.json');
await writeFile(file, `${JSON.stringify(sorted)}\n`, 'utf8');
console.log(`판단 ${Object.keys(sorted).length}개를 ${file} 에 남겼습니다.`);
