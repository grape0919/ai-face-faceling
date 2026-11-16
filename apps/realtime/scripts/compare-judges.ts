import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJevAnalyzer } from '@faceling/core/analyzers/jev';
import { createOpenAIAnalyzer } from '@faceling/core/analyzers/openai';
import type { Analyzer, AnalyzerInput, Judgment } from '@faceling/core/judgment';
import { REGION_KEYS, topAction } from '@faceling/core/regions';
import { ARM_BODY, FACE_BODY } from '@faceling/rigs/bodies';

/**
 * Jev 와 OpenAI 판단 모델을 같은 문장으로 나란히 돌려, 고른 동작과 걸린 시간을 비교한다.
 *   npm run compare -w @faceling/realtime -- gpt-4.1-mini gpt-6-luna@none
 * 모델 이름 뒤에 @값 을 붙이면 reasoning_effort 를 바꾼다. 추론 모델은 가장 낮은 값을 줘야 빠르다.
 * TYPESAFE_API_KEY 와 OPENAI_API_KEY 가 필요하다.
 */

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
try {
  process.loadEnvFile(path.join(APP_ROOT, '..', '..', '.env'));
} catch {
  // .env 가 없으면 환경 변수만 쓴다
}

const say = (current: string, context = '', extra: Partial<AnalyzerInput> = {}): AnalyzerInput => ({
  speaker: 'assistant',
  context,
  current,
  body: FACE_BODY,
  ...extra,
});

const CASES: AnalyzerInput[] = [
  say('정말요? 와, 축하드려요!', '사용자: 나 오늘 드디어 합격했어.'),
  say('아이고, 많이 속상하셨겠어요.', '사용자: 오늘 키우던 강아지가 아파서 병원에 다녀왔어.'),
  say('회의는 오후 세 시에 시작합니다.', '사용자: 회의가 몇 시였지?'),
  say('좋아요, 찡긋!', '사용자: 윙크 한번 해 봐.'),
  say('네, 오른쪽으로 휙!', '사용자: 고개를 오른쪽으로 돌려 봐.'),
  say('Okay, reaching to the right!', 'user: Can you reach to the right?', { body: ARM_BODY }),
  say('오늘 회사에서 발표를 했는데 완전히 망쳤어.', '', { speaker: 'user' }),
  say('나 다음 달에 결혼해!', '', { speaker: 'user' }),
];

const picks = (j: Judgment): string =>
  REGION_KEYS.map((r) => topAction(j.regions[r]))
    .map((t, i) => `${REGION_KEYS[i]}=${t.action}${Math.round(t.p * 100)}`)
    .join(' ');

const judges: Array<[string, Analyzer]> = [['jev', createJevAnalyzer()]];
for (const arg of process.argv.slice(2)) {
  const [model, effort] = arg.split('@');
  judges.push([arg, createOpenAIAnalyzer({ model, ...(effort !== undefined && { reasoningEffort: effort }) })]);
}

for (const [label, judge] of judges) {
  const times: number[] = [];
  console.log(`\n== ${label}`);
  // 첫 요청은 연결과 캐시 준비가 섞이므로 한 번 버린다
  await judge.analyze(CASES[0]!).catch((err: unknown) => console.log(`  준비 요청 실패: ${String(err).slice(0, 200)}`));
  for (const input of CASES) {
    const started = performance.now();
    try {
      const judgment = await judge.analyze(input);
      const ms = Math.round(performance.now() - started);
      times.push(ms);
      console.log(`  ${String(ms).padStart(5)}ms  세기 ${judgment.intensity.toFixed(2)}  ${picks(judgment)}  ← ${input.speaker === 'user' ? '(듣기) ' : ''}${input.current}`);
    } catch (err) {
      console.log(`  실패: ${String(err).slice(0, 200)}`);
      break;
    }
  }
  if (times.length) {
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`  가운데 ${sorted[Math.floor(sorted.length / 2)]}ms, 가장 느림 ${sorted[sorted.length - 1]}ms`);
  }
}
