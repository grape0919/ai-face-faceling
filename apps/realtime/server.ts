import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJevAnalyzer } from '@faceling/core/analyzers/jev';
import type { Analyzer, AnalyzerInput, Judgment } from '@faceling/core/judgment';
import { REGION_KEYS, topAction } from '@faceling/core/regions';
import { createServer as createViteServer } from 'vite';

/**
 * 실시간 예제의 서버. 하는 일은 두 가지다.
 *  - 브라우저가 OpenAI Realtime 에 직접 붙을 때 쓸 임시 키를 발급한다 (실제 키는 서버에만 있다).
 *  - 브라우저 대신 Jev 를 부른다 (Jev 키도 서버에만 있다).
 * 나머지 요청은 Vite 가 화면 파일로 응답한다. 내 PC 에서만 접속할 수 있게 127.0.0.1 에 연다.
 */

const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5174;

try {
  process.loadEnvFile(path.join(APP_ROOT, '..', '..', '.env'));
} catch {
  // .env 가 없으면 환경 변수만 쓴다
}

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
/** 말하는 도중의 전사에 쓰는 모델. 말이 들어오는 대로 글자를 내보낸다. */
const LIVE_TRANSCRIBE_MODEL = process.env.OPENAI_LIVE_TRANSCRIBE_MODEL || 'gpt-live-transcribe';
const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

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
const INSTRUCTIONS =
  process.env.OPENAI_REALTIME_INSTRUCTIONS ||
  '당신은 다정하고 표정이 풍부한 대화 상대입니다. 한국어로 자연스럽게 말하고, 한 번에 두세 문장 정도로 짧게 답하세요. ' +
    '상대의 기분에 맞춰 반응하고, 가끔 가벼운 농담도 하세요.';

let analyzer: Analyzer | null = null;
const getAnalyzer = (): Analyzer => (analyzer ??= createJevAnalyzer());

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 20_000) throw new Error('요청이 너무 큽니다');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

async function handleApi(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
  if (route === '/api/config' && req.method === 'GET') {
    send(res, 200, {
      openai: Boolean(process.env.OPENAI_API_KEY),
      jev: Boolean(process.env.TYPESAFE_API_KEY),
      model: REALTIME_MODEL,
      voice: REALTIME_VOICE,
      voices: VOICES,
      liveTranscribe: LIVE_TRANSCRIBE_MODEL,
    });
    return;
  }

  // OpenAI Realtime 임시 키. 브라우저는 이 키로 WebRTC 연결을 맺는다.
  if (route === '/api/session' && req.method === 'POST') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      send(res, 400, { error: 'OPENAI_API_KEY 가 없습니다. 루트의 .env 에 넣고 서버를 다시 시작하세요.' });
      return;
    }
    const asked = text((await readJson(req)).voice, 40);
    const voice = VOICES.includes(asked) ? asked : REALTIME_VOICE;
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions: INSTRUCTIONS,
          audio: {
            input: {
              // 사용자 말의 전사. 듣는 반응에 쓴다.
              transcription: { model: TRANSCRIBE_MODEL, language: 'ko' },
              turn_detection: { type: 'semantic_vad' },
            },
            output: { voice },
          },
        },
      }),
    });
    const body = (await upstream.json()) as { value?: string; expires_at?: number; error?: { message?: string } };
    if (!upstream.ok || !body.value) {
      send(res, 502, { error: `OpenAI 임시 키 발급 실패 (${upstream.status}): ${body.error?.message ?? '알 수 없는 오류'}` });
      return;
    }
    send(res, 200, { value: body.value, expires_at: body.expires_at, model: REALTIME_MODEL, voice });
    return;
  }

  // 말하는 도중의 전사만 하는 두 번째 연결용 임시 키
  if (route === '/api/transcription-session' && req.method === 'POST') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      send(res, 400, { error: 'OPENAI_API_KEY 가 없습니다.' });
      return;
    }
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: {
            input: {
              transcription: { model: LIVE_TRANSCRIBE_MODEL, language: 'ko', delay: 'low' },
              // 이 모델은 서버 쪽 말 끝 감지를 지원하지 않는다. 말의 시작과 끝은 대화 연결이 알려 준다.
              turn_detection: null,
            },
          },
        },
      }),
    });
    const body = (await upstream.json()) as { value?: string; error?: { message?: string } };
    if (!upstream.ok || !body.value) {
      send(res, 502, { error: `전사용 임시 키 발급 실패 (${upstream.status}): ${body.error?.message ?? '알 수 없는 오류'}` });
      return;
    }
    send(res, 200, { value: body.value, model: LIVE_TRANSCRIBE_MODEL });
    return;
  }

  // 절 하나에 대한 부위별 판단
  if (route === '/api/judge' && req.method === 'POST') {
    const body = await readJson(req);
    const input: AnalyzerInput = {
      speaker: body.speaker === 'user' ? 'user' : 'assistant',
      context: text(body.context, 1200),
      current: text(body.current, 400),
    };
    if (!input.current.trim()) {
      send(res, 400, { error: 'current 가 비어 있습니다' });
      return;
    }
    const started = performance.now();
    const judgment = await getAnalyzer().analyze(input);
    const ms = Math.round(performance.now() - started);
    void logJudgment(input, judgment, ms).catch(() => undefined);
    send(res, 200, { judgment, ms });
    return;
  }

  send(res, 404, { error: '없는 경로입니다' });
}

const vite = await createViteServer({
  root: APP_ROOT,
  appType: 'spa',
  server: { middlewareMode: true },
});

const server = createServer((req, res) => {
  const route = (req.url ?? '/').split('?')[0] ?? '/';
  if (route.startsWith('/api/')) {
    handleApi(req, res, route).catch((err: unknown) => {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  vite.middlewares(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nFaceling 실시간 예제  http://localhost:${PORT}`);
  console.log(`OpenAI 키 ${process.env.OPENAI_API_KEY ? '있음' : '없음'}, Jev 키 ${process.env.TYPESAFE_API_KEY ? '있음' : '없음'}`);
});
