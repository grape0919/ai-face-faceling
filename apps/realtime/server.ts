import { appendFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalyzerInput, Judgment } from '@redbridge/faceling-core/judgment';
import { REGION_KEYS, topAction } from '@redbridge/faceling-core/regions';
import { ARM_BODY, DOG_BODY, FACE_BODY } from '@redbridge/faceling-rigs/bodies';
import {
  DEFAULT_LIVE_TRANSCRIBE_MODEL,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VOICE,
  DEFAULT_VOICES,
  createFacelingHandler,
  toNodeHandler,
} from '@redbridge/faceling-server';
import { createServer as createViteServer, defaultClientConditions } from 'vite';
import * as persona from './src/persona';

/**
 * 실시간 예제의 서버. 임시 키 발급(/api/session, /api/transcription-session)과 Jev 중계(/api/judge)는
 * @redbridge/faceling-server 가 맡고, 여기서는 화면 설정(/api/config), 판단 기록, 화면 파일 제공만 한다.
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
// AI 의 말투와 자기 몸 지시는 화면과 함께 쓰는 src/persona.ts 에 있다. 말투만 환경 변수로 바꿀 수 있다.
const INSTRUCTIONS = process.env.OPENAI_REALTIME_INSTRUCTIONS || persona.INSTRUCTIONS;
const INSTRUCTIONS_EN = process.env.OPENAI_REALTIME_INSTRUCTIONS_EN || persona.INSTRUCTIONS_EN;
const { CHARACTERS, CHARACTERS_EN } = persona;

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
  // 부위별 수치 판단이면 세기가 큰 채널 순으로 남긴다
  const channels = judgment.channels
    ? Object.entries(judgment.channels)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 12)
        .map(([name, v]) => `${name} ${Math.round(v.amount * 100)} ${v.duration}`)
    : undefined;
  const row = { at: new Date().toISOString(), ms, ...input, body: input.body?.name, channels, reset: judgment.reset, intensity: Number(judgment.intensity.toFixed(2)), picks };
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, `${JSON.stringify(row)}\n`, 'utf8');
}

/**
 * 사용자가 화면에 넣은 자기 키. 화면이 요청 헤더로 보내면 .env 의 키 대신 그것을 쓴다. 키는 저장하지도 기록하지도 않는다.
 * 이 서버는 내 PC(127.0.0.1)에서만 열리므로 키가 내 PC 밖으로 나가는 곳은 OpenAI 와 TypeSafe 뿐이다.
 */
const headerKey =
  (name: string) =>
  (request: Request): string | undefined =>
    request.headers.get(name)?.trim() || undefined;
const openaiKey = headerKey('x-openai-key');

/** 화면 언어마다 처리기를 하나씩 둔다. AI 의 말투·자기 몸 지시와 전사 언어가 다르고, 판단은 같다. */
// Jev 키가 없으면 OpenAI 키로 OpenAI 모델이 대신 판단한다.
const judgeOptions = {
  bodies: [FACE_BODY, DOG_BODY, ARM_BODY],
  onJudgment: logJudgment,
  apiKey: headerKey('x-typesafe-key'),
  openaiApiKey: openaiKey,
};
const apis = {
  ko: toNodeHandler(
    createFacelingHandler({
      session: { model: MODEL, voice: VOICE, instructions: INSTRUCTIONS, characters: CHARACTERS, language: 'ko', apiKey: openaiKey },
      transcription: { model: LIVE_TRANSCRIBE_MODEL, language: 'ko', apiKey: openaiKey },
      judge: judgeOptions,
    }),
  ),
  en: toNodeHandler(
    createFacelingHandler({
      session: { model: MODEL, voice: VOICE, instructions: INSTRUCTIONS_EN, characters: CHARACTERS_EN, language: 'en', apiKey: openaiKey },
      transcription: { model: LIVE_TRANSCRIBE_MODEL, language: 'en', apiKey: openaiKey },
      judge: judgeOptions,
    }),
  ),
};

/** 화면이 처음 열릴 때 읽는 설정. .env 의 키는 있는지만 알려 준다. 없는 키는 사용자가 화면에서 넣을 수 있다. */
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
  // 정적 페이지 빌드용 vite.config.ts 는 읽지 않는다
  configFile: false,
  appType: 'spa',
  server: { middlewareMode: true },
  // 저장소 안의 @redbridge/faceling-* 패키지는 빌드하지 않고 TS 원본을 그대로 쓴다
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
    // 화면이 주소에 ?lang=en 을 붙여 보낸다
    const english = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('lang') === 'en';
    void apis[english ? 'en' : 'ko'](req, res);
    return;
  }
  vite.middlewares(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nFaceling 실시간 예제  http://localhost:${PORT}`);
  console.log(`OpenAI 키 ${process.env.OPENAI_API_KEY ? '있음' : '없음'}, Jev 키 ${process.env.TYPESAFE_API_KEY ? '있음' : '없음'}`);
});
