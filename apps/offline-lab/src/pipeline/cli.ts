import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_FORMAT, type Analyzer, type AnalyzerInput, type Judgment, type Script, type Segment, type Session, type Turn } from '../shared/types';
import { getAligner } from './align';
import { createJevAnalyzer } from './analyzers/jev';
import { createLlmAnalyzer } from './analyzers/llm';
import { mockAnalyzer } from './analyzers/mock';
import { segmentWords } from './segment';
import { synthesizeWithSapi } from './tts';

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SESSIONS_ROOT = path.join(APP_ROOT, 'public', 'sessions');

/** 턴 사이 간격. 사용자 말이 끝난 뒤의 간격은 AI 가 생각하는 시간에 해당한다. */
const LEAD_IN = 0.5;
const GAP_AFTER_USER = 0.9;
const GAP_AFTER_ASSISTANT = 0.5;
/** 판단할 때 참고로 넘기는 직전 구간 수 */
const CONTEXT_SEGMENTS = 2;
const CONCURRENCY = 4;

const USAGE = `사용법: npm run lab:session -- <세션 이름> [옵션]

  --analyzer mock|jev|llm     구간 분석기 (기본 mock)
  --aligner  naive|whisper    단어 시각 정렬 (기본 naive)
  --tts      none|sapi        음성 파일이 없는 턴을 합성할지 (기본 none)

세션 폴더: apps/offline-lab/public/sessions/<세션 이름>/script.json`;

interface Options {
  session: string;
  analyzer: string;
  aligner: string;
  tts: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { session: '', analyzer: 'mock', aligner: 'naive', tts: 'none' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--analyzer' || arg === '--aligner' || arg === '--tts') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} 에 값이 없습니다`);
      opts[arg.slice(2) as 'analyzer' | 'aligner' | 'tts'] = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`알 수 없는 옵션: ${arg}`);
    } else {
      opts.session = arg;
    }
  }
  if (!opts.session) throw new Error('세션 이름이 필요합니다');
  return opts;
}

function getAnalyzer(name: string): Analyzer {
  if (name === 'mock') return mockAnalyzer;
  if (name === 'jev') return createJevAnalyzer();
  if (name === 'llm') return createLlmAnalyzer();
  throw new Error(`알 수 없는 분석기: ${name} (mock | jev | llm)`);
}

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

async function main(): Promise<void> {
  try {
    process.loadEnvFile(path.join(APP_ROOT, '..', '..', '.env'));
  } catch {
    // .env 가 없으면 환경 변수만 쓴다
  }

  const opts = parseArgs(process.argv.slice(2));
  const dir = path.join(SESSIONS_ROOT, opts.session);
  const scriptFile = path.join(dir, 'script.json');
  if (!(await exists(scriptFile))) throw new Error(`대본이 없습니다: ${scriptFile}`);
  const script = JSON.parse(await readFile(scriptFile, 'utf8')) as Script;

  const aligner = getAligner(opts.aligner);
  const analyzer = getAnalyzer(opts.analyzer);
  await mkdir(path.join(dir, 'audio'), { recursive: true });
  await mkdir(path.join(dir, 'cache'), { recursive: true });

  // 1. 턴마다 음성 확보 → 단어 정렬 → 세션 시각으로 옮기고 절 단위로 분할
  const turns: Turn[] = [];
  let cursor = LEAD_IN;
  for (const [i, st] of script.turns.entries()) {
    const rel = st.audio ?? `audio/${String(i + 1).padStart(2, '0')}-${st.speaker}.wav`;
    const file = path.join(dir, rel);
    if (!(await exists(file))) {
      if (opts.tts !== 'sapi') {
        throw new Error(`음성 파일이 없습니다: ${file}\n직접 넣거나 --tts sapi 로 시험용 음성을 만드세요.`);
      }
      await synthesizeWithSapi(st.text, st.speaker, file);
      console.log(`음성 합성  ${rel}`);
    }

    const aligned = await aligner.align(file, st.text);
    const words = aligned.words.map((w) => ({ text: w.text, start: w.start + cursor, end: w.end + cursor }));
    const segments: Segment[] = segmentWords(words).map((s) => ({
      index: 0,
      text: s.text,
      start: s.start,
      end: s.end,
      judgment: null as unknown as Judgment,
    }));
    turns.push({
      index: i,
      speaker: st.speaker,
      text: st.text,
      audio: rel.replace(/\\/g, '/'),
      start: cursor,
      end: cursor + aligned.duration,
      words,
      segments,
    });
    cursor += aligned.duration + (st.speaker === 'user' ? GAP_AFTER_USER : GAP_AFTER_ASSISTANT);
  }

  // 2. 구간마다 분석. 결과는 입력 해시로 캐시한다.
  const cacheFile = path.join(dir, 'cache', `${analyzer.name}.json`);
  const cache: Record<string, Judgment> = (await exists(cacheFile))
    ? (JSON.parse(await readFile(cacheFile, 'utf8')) as Record<string, Judgment>)
    : {};

  const jobs: { segment: Segment; input: AnalyzerInput }[] = [];
  const history: string[] = [];
  let index = 0;
  for (const turn of turns) {
    for (const segment of turn.segments) {
      segment.index = index++;
      const input: AnalyzerInput = {
        speaker: turn.speaker,
        context: history.slice(-CONTEXT_SEGMENTS).join('\n'),
        current: segment.text,
      };
      jobs.push({ segment, input });
      history.push(`${turn.speaker}: ${segment.text}`);
    }
  }

  const timings: number[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const job = jobs[next++];
      if (!job) return;
      const key = createHash('sha1')
        .update(JSON.stringify([analyzer.name, analyzer.version, job.input]))
        .digest('hex');
      const cached = cache[key];
      if (cached) {
        job.segment.judgment = cached;
        continue;
      }
      const started = performance.now();
      const judgment = await analyzer.analyze(job.input);
      timings.push(performance.now() - started);
      job.segment.judgment = judgment;
      cache[key] = judgment;
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    // 중간에 실패해도 받은 결과는 남겨서 다시 돌릴 때 재사용한다
    await writeFile(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  }

  // 3. 세션 파일 저장
  const session: Session = {
    format: SESSION_FORMAT,
    title: script.title,
    name: opts.session,
    analyzer: analyzer.name,
    aligner: aligner.name,
    duration: (turns[turns.length - 1]?.end ?? 0) + 1,
    turns,
  };
  if (timings.length > 0) {
    const sorted = [...timings].sort((a, b) => a - b);
    session.latency = {
      count: sorted.length,
      p50: Math.round(percentile(sorted, 0.5)),
      p95: Math.round(percentile(sorted, 0.95)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  }
  const outFile = path.join(dir, `session.${analyzer.name}.json`);
  await writeFile(outFile, JSON.stringify(session, null, 2), 'utf8');

  console.log(`\n${script.title}`);
  console.log(`턴 ${turns.length}개, 구간 ${jobs.length}개, 길이 ${session.duration.toFixed(1)}초`);
  console.log(`정렬 ${aligner.name}, 분석 ${analyzer.name} (새 호출 ${timings.length}회, 캐시 ${jobs.length - timings.length}회)`);
  if (session.latency) {
    console.log(`분석 지연 p50 ${session.latency.p50}ms, p95 ${session.latency.p95}ms, 최대 ${session.latency.max}ms`);
  }
  console.log(`저장  ${path.relative(process.cwd(), outFile)}`);
  console.log(`보기  http://localhost:5173/?session=${opts.session}&analyzer=${analyzer.name}`);
}

main().catch((err: unknown) => {
  console.error(`\n오류: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && /필요합니다$|알 수 없는/.test(err.message)) console.error(USAGE);
  process.exitCode = 1;
});
