import { appendFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalyzerInput, Judgment } from '@faceling/core/judgment';
import { REGION_KEYS, topAction } from '@faceling/core/regions';
import {
  DEFAULT_LIVE_TRANSCRIBE_MODEL,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VOICE,
  DEFAULT_VOICES,
  createFacelingHandler,
  toNodeHandler,
} from '@faceling/server';
import { createServer as createViteServer, defaultClientConditions } from 'vite';

/**
 * 실시간 예제의 서버. 임시 키 발급(/api/session, /api/transcription-session)과 Jev 중계(/api/judge)는
 * @faceling/server 가 맡고, 여기서는 화면 설정(/api/config), 판단 기록, 화면 파일 제공만 한다.
 * 내 PC 에서만 접속할 수 있게 127.0.0.1 에 연다.
 */

const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5174;

try {
  process.loadEnvFile(path.join(APP_ROOT, '..', '..', '.env'));
} catch {
  // .env 가 없으면 환경 변수만 쓴다
}

const MODEL = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
const VOICE = process.env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE;
const LIVE_TRANSCRIBE_MODEL = process.env.OPENAI_LIVE_TRANSCRIBE_MODEL || DEFAULT_LIVE_TRANSCRIBE_MODEL;
const INSTRUCTIONS =
  process.env.OPENAI_REALTIME_INSTRUCTIONS ||
  '당신은 다정하고 표정이 풍부한 대화 상대입니다. 한국어로 자연스럽게 말하고, 한 번에 두세 문장 정도로 짧게 답하세요. ' +
    '상대의 기분에 맞춰 반응하고, 가끔 가벼운 농담도 하세요.';

/** 판단 기록. 어떤 맥락으로 무엇을 물었고 무엇이 나왔는지 한 줄씩 남긴다. */
const LOG_DIR = path.join(APP_ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, `judge-${new Date().toISOString().slice(0, 10)}.jsonl`);
async function logJudgment(input: AnalyzerInput, judgment: Judgment, ms: number): Promise<void> {
  const picks = Object.fromEntries(
    REGION_KEYS.map((r) => {
      const top = topAction(judgment.regions[r]);
      return [r, `${top.action} ${Math.round(top.p * 100)}`];
    }),
  );
  const row = { at: new Date().toISOString(), ms, ...input, intensity: Number(judgment.intensity.toFixed(2)), picks };
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, `${JSON.stringify(row)}\n`, 'utf8');
}

const api = toNodeHandler(
  createFacelingHandler({
    session: { model: MODEL, voice: VOICE, instructions: INSTRUCTIONS, language: 'ko' },
    transcription: { model: LIVE_TRANSCRIBE_MODEL, language: 'ko' },
    judge: { onJudgment: logJudgment },
  }),
);

/** 화면이 처음 열릴 때 읽는 설정. 키는 있는지만 알려 준다. */
const config = JSON.stringify({
  openai: Boolean(process.env.OPENAI_API_KEY),
  jev: Boolean(process.env.TYPESAFE_API_KEY),
  model: MODEL,
  voice: VOICE,
  voices: DEFAULT_VOICES,
  liveTranscribe: LIVE_TRANSCRIBE_MODEL,
});

const vite = await createViteServer({
  root: APP_ROOT,
  appType: 'spa',
  server: { middlewareMode: true },
  // 저장소 안의 @faceling/* 패키지는 빌드하지 않고 TS 원본을 그대로 쓴다
  resolve: { conditions: ['faceling-source', ...defaultClientConditions] },
});

const server = createServer((req, res) => {
  const route = (req.url ?? '/').split('?')[0] ?? '/';
  if (route === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(config);
    return;
  }
  if (route.startsWith('/api/')) {
    void api(req, res);
    return;
  }
  vite.middlewares(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nFaceling 실시간 예제  http://localhost:${PORT}`);
  console.log(`OpenAI 키 ${process.env.OPENAI_API_KEY ? '있음' : '없음'}, Jev 키 ${process.env.TYPESAFE_API_KEY ? '있음' : '없음'}`);
});
