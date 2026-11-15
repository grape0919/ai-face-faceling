import { appendFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalyzerInput, Judgment } from '@faceling/core/judgment';
import { REGION_KEYS, topAction } from '@faceling/core/regions';
import { ARM_BODY, DOG_BODY, FACE_BODY } from '@faceling/rigs/bodies';
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

/**
 * 캐릭터(몸)별로 AI 에게 알려 줄 자기 몸. AI 가 "찡긋!", "오른쪽으로 쭉!"처럼 실제로 해 보이는 말을 하면
 * 표정 판단이 그 말을 보고 얼굴과 팔을 움직인다. 할 수 없는 동작은 할 수 없다고 하게 한다.
 */
const CHARACTERS: Record<string, string> = {
  [FACE_BODY.name]:
    '당신에게는 화면에 보이는 표정 풍부한 얼굴이 있습니다. 사용자가 윙크, 미소, 놀란 표정 같은 것을 부탁하면 ' +
    '"좋아요, 찡긋!"처럼 지금 그 표정을 해 보이는 말 한마디로 답하세요. 표정을 자세히 설명하지 마세요. 사용자가 화면으로 직접 봅니다. ' +
    '얼굴이 없다거나 표정을 지을 수 없다고 말하지 마세요. ' +
    '고개도 움직일 수 있습니다. 위로 들고, 아래로 숙이고, 왼쪽이나 오른쪽으로 돌리고, 다시 정면을 볼 수 있습니다. ' +
    '부탁받으면 "네, 오른쪽으로 휙!"처럼 지금 하는 말 한마디로 답하세요. 방향은 사용자가 화면을 보는 쪽 기준입니다. ' +
    '팔이나 손은 없으니 그런 동작을 부탁받으면 대신 고개를 끄덕이거나 웃어 보이겠다고 하세요.',
  [DOG_BODY.name]: '', // 아래에서 얼굴 설명에 귀를 더해 채운다
  [ARM_BODY.name]:
    '당신은 얼굴이 없는 작업대 로봇팔입니다. 받침 위에 어깨, 팔꿈치, 손목, 집게가 있고 손목에 불빛이 있습니다. ' +
    '팔을 오른쪽, 왼쪽, 위, 아래로 뻗고, 사용자 쪽으로 내밀고, 흔들 수 있으며, 감정도 몸짓으로 드러냅니다. ' +
    '사용자가 움직여 보라고 하면 "네, 오른쪽으로 쭉!"처럼 지금 그 동작을 하는 말 한마디로 답하세요. ' +
    '관절이 어떻게 움직였는지 자세히 설명하지 마세요. 사용자가 화면으로 직접 봅니다. 직접 움직일 수 없다고 말하지 마세요. ' +
    '방향은 사용자가 화면을 보는 쪽 기준입니다. 눈이 없어 윙크는 못 하지만, 부탁받으면 "대신 불빛을 찡긋!"처럼 불빛을 깜빡여 보이세요.',
};

CHARACTERS[DOG_BODY.name] =
  `${CHARACTERS[FACE_BODY.name]} ` +
  '당신은 큰 귀가 달린 강아지입니다. 귀를 쫑긋 세우거나 축 늘어뜨릴 수 있고, 부탁받으면 "네, 귀 쫑긋!"처럼 지금 하는 말 한마디로 답하세요.';

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

const api = toNodeHandler(
  createFacelingHandler({
    session: { model: MODEL, voice: VOICE, instructions: INSTRUCTIONS, characters: CHARACTERS, language: 'ko' },
    transcription: { model: LIVE_TRANSCRIBE_MODEL, language: 'ko' },
    judge: { bodies: [FACE_BODY, DOG_BODY, ARM_BODY], onJudgment: logJudgment },
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
