import { createJevAnalyzer } from '@faceling/core/analyzers/jev';
import type { Analyzer, AnalyzerInput, Judgment } from '@faceling/core/judgment';
import type { BodySpec } from '@faceling/core/body';

/**
 * 프레임워크에 상관없는 요청 처리기. 표준 Request 를 받아 Response 를 돌려준다.
 * Next.js 라우트 핸들러, Hono, Bun, Deno 등에는 그대로 넣고, Node http·Express 에는 toNodeHandler() 로 감싼다.
 */
export type FetchHandler = (request: Request) => Promise<Response>;

/** 요청 본문의 최대 크기(바이트). 판단 요청 하나는 이보다 훨씬 작다. */
const MAX_BODY = 20_000;
const OPENAI_CLIENT_SECRETS = 'https://api.openai.com/v1/realtime/client_secrets';

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
export const DEFAULT_VOICE = 'marin';
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
export const DEFAULT_LIVE_TRANSCRIBE_MODEL = 'gpt-live-transcribe';
/** 브라우저가 고를 수 있는 목소리. 이 밖의 이름이 오면 기본 목소리를 쓴다. */
export const DEFAULT_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

const env = (name: string): string | undefined => process.env[name] || undefined;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다');
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, '본문이 JSON 이 아닙니다');
  }
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** POST 만 받고, 처리 중 오류는 { error } 로 바꾼다. */
const postOnly =
  (handle: (request: Request) => Promise<Response>): FetchHandler =>
  async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'POST 만 받습니다' });
    try {
      return await handle(request);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      return json(500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

async function clientSecret(apiKey: string, session: Record<string, unknown>): Promise<{ ok: boolean; status: number; value?: string; expires_at?: number; message?: string }> {
  const upstream = await fetch(OPENAI_CLIENT_SECRETS, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });
  const body = (await upstream.json().catch(() => ({}))) as { value?: string; expires_at?: number; error?: { message?: string } };
  return { ok: upstream.ok && Boolean(body.value), status: upstream.status, value: body.value, expires_at: body.expires_at, message: body.error?.message };
}

// ── 대화용 임시 키 ─────────────────────────────────────────

export interface SessionHandlerOptions {
  /** OpenAI API 키. 없으면 환경 변수 OPENAI_API_KEY. */
  apiKey?: string;
  /** 대화 모델. 없으면 OPENAI_REALTIME_MODEL, 그것도 없으면 'gpt-realtime-2.1'. */
  model?: string;
  /** 기본 목소리. 없으면 OPENAI_REALTIME_VOICE, 그것도 없으면 'marin'. */
  voice?: string;
  /** 브라우저가 고를 수 있는 목소리 목록 */
  voices?: string[];
  /** AI 의 성격과 말투 지시. 없으면 OPENAI_REALTIME_INSTRUCTIONS. */
  instructions?: string;
  /** 사용자 말의 최종 전사에 쓰는 모델. 없으면 OPENAI_TRANSCRIBE_MODEL, 그것도 없으면 'gpt-4o-mini-transcribe'. */
  transcribeModel?: string;
  /** 사용자 말의 언어(ISO 639-1, 예: 'ko', 'en'). 비우면 OpenAI 가 알아서 판단한다. */
  language?: string;
  /**
   * 몸(캐릭터)별로 instructions 뒤에 덧붙일 지시. 브라우저가 본문의 character 로 고른다(예: { arm: '당신은 로봇팔입니다…' }).
   * AI 가 자기 몸을 알아야 "오른쪽으로 쭉!"처럼 그 몸으로 하는 말을 하고, 표정 판단이 그 말을 보고 몸을 움직인다.
   * 브라우저는 이름만 보내므로 지시 내용은 서버가 정한다.
   */
  characters?: Record<string, string>;
  /** 세션 설정을 마지막에 고친다. 도구(tools)를 넣는 등 위 옵션으로 안 되는 것에 쓴다. */
  customize?: (session: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * 브라우저가 OpenAI Realtime 에 직접 붙을 때 쓸 임시 키를 발급한다(POST, 본문 { voice?, character? }).
 * 응답은 { value, expires_at, model, voice }. @faceling/openai-realtime 의 RealtimeConnection 이 이 형식을 읽는다.
 */
export function createSessionHandler(options: SessionHandlerOptions = {}): FetchHandler {
  return postOnly(async (request) => {
    const apiKey = options.apiKey || env('OPENAI_API_KEY');
    if (!apiKey) return json(400, { error: 'OPENAI_API_KEY 가 없습니다. 환경 변수나 apiKey 옵션으로 넘기세요.' });
    const model = options.model || env('OPENAI_REALTIME_MODEL') || DEFAULT_REALTIME_MODEL;
    const fallbackVoice = options.voice || env('OPENAI_REALTIME_VOICE') || DEFAULT_VOICE;
    const voices = options.voices ?? DEFAULT_VOICES;
    const body = await readJson(request);
    const asked = text(body.voice, 40);
    const voice = voices.includes(asked) ? asked : fallbackVoice;
    // 목록에 직접 적힌 이름만 받는다. 'constructor' 같은 이름이 객체의 기본 속성을 꺼내 오지 않게 한다.
    const name = text(body.character, 40);
    const character = options.characters && Object.prototype.hasOwnProperty.call(options.characters, name) ? options.characters[name] : undefined;
    const instructions = [options.instructions ?? env('OPENAI_REALTIME_INSTRUCTIONS'), character].filter(Boolean).join('\n\n');
    const transcribeModel = options.transcribeModel || env('OPENAI_TRANSCRIBE_MODEL') || DEFAULT_TRANSCRIBE_MODEL;

    let session: Record<string, unknown> = {
      type: 'realtime',
      model,
      ...(instructions && { instructions }),
      audio: {
        input: {
          // 사용자 말의 전사. 듣는 반응에 쓴다.
          transcription: { model: transcribeModel, ...(options.language && { language: options.language }) },
          turn_detection: { type: 'semantic_vad' },
        },
        output: { voice },
      },
    };
    if (options.customize) session = options.customize(session);

    const secret = await clientSecret(apiKey, session);
    if (!secret.ok) {
      return json(502, { error: `OpenAI 임시 키 발급 실패 (${secret.status}): ${secret.message ?? '알 수 없는 오류'}` });
    }
    return json(200, { value: secret.value, expires_at: secret.expires_at, model, voice });
  });
}

// ── 말하는 도중의 전사용 임시 키 ───────────────────────────

export interface TranscriptionSessionHandlerOptions {
  /** OpenAI API 키. 없으면 환경 변수 OPENAI_API_KEY. */
  apiKey?: string;
  /** 말이 들어오는 대로 글자를 내보내는 전사 모델. 없으면 OPENAI_LIVE_TRANSCRIBE_MODEL, 그것도 없으면 'gpt-live-transcribe'. */
  model?: string;
  /** 사용자 말의 언어(ISO 639-1). 비우면 OpenAI 가 알아서 판단한다. */
  language?: string;
}

/**
 * 사용자가 말하는 도중의 전사만 하는 두 번째 연결용 임시 키(POST). 응답은 { value, model }.
 * 이 연결이 있어야 사용자가 말을 마치기 전에 듣는 반응이 나온다. 없어도 대화는 된다.
 */
export function createTranscriptionSessionHandler(options: TranscriptionSessionHandlerOptions = {}): FetchHandler {
  return postOnly(async () => {
    const apiKey = options.apiKey || env('OPENAI_API_KEY');
    if (!apiKey) return json(400, { error: 'OPENAI_API_KEY 가 없습니다.' });
    const model = options.model || env('OPENAI_LIVE_TRANSCRIBE_MODEL') || DEFAULT_LIVE_TRANSCRIBE_MODEL;
    const secret = await clientSecret(apiKey, {
      type: 'transcription',
      audio: {
        input: {
          transcription: { model, delay: 'low', ...(options.language && { language: options.language }) },
          // 이 모델은 서버 쪽 말 끝 감지를 지원하지 않는다. 말의 시작과 끝은 대화 연결이 알려 준다.
          turn_detection: null,
        },
      },
    });
    if (!secret.ok) {
      return json(502, { error: `전사용 임시 키 발급 실패 (${secret.status}): ${secret.message ?? '알 수 없는 오류'}` });
    }
    return json(200, { value: secret.value, model });
  });
}

// ── 절 하나의 판단 ─────────────────────────────────────────

export interface JudgeHandlerOptions {
  /** 판단에 쓸 분석기. 없으면 Jev 분석기를 처음 요청 때 만든다. */
  analyzer?: Analyzer;
  /** Jev 를 쓸 때의 TypeSafe API 키. 없으면 환경 변수 TYPESAFE_API_KEY. */
  apiKey?: string;
  /** Jev 모델. 없으면 JEV_MODEL, 그것도 없으면 'jev-latest'. */
  model?: string;
  /**
   * 판단에 쓸 수 있는 몸 명세들(예: @faceling/rigs 의 FACE_BODY, ARM_BODY). 브라우저가 본문의 body 로 이름을 보내면
   * 그 몸이 할 수 있는 움직임을 함께 묻는다. 없으면 감정 표현만 판단한다.
   */
  bodies?: BodySpec[];
  /** 판단이 끝날 때마다 부른다. 기록을 남길 때 쓴다. 여기서 난 오류는 응답에 영향을 주지 않는다. */
  onJudgment?: (input: AnalyzerInput, judgment: Judgment, ms: number) => void | Promise<void>;
}

/**
 * 브라우저 대신 분석기(기본은 Jev)를 부른다(POST, 본문은 AnalyzerInput). 응답은 { judgment, ms }.
 * 브라우저 쪽은 @faceling/core 의 createRemoteJudge() 로 이 주소를 부른다.
 */
export function createJudgeHandler(options: JudgeHandlerOptions = {}): FetchHandler {
  let analyzer: Analyzer | null = options.analyzer ?? null;
  const getAnalyzer = (): Analyzer => (analyzer ??= createJevAnalyzer({ apiKey: options.apiKey, model: options.model }));

  return postOnly(async (request) => {
    const body = await readJson(request);
    const input: AnalyzerInput = {
      speaker: body.speaker === 'user' ? 'user' : 'assistant',
      context: text(body.context, 1200),
      current: text(body.current, 400),
      following: text(body.following, 400),
      // 브라우저는 몸의 이름만 보낸다. 질문에 들어가는 설명은 서버가 가진 명세에서만 나온다.
      body: options.bodies?.find((b) => b.name === text(body.body, 40)),
      mode: body.mode === 'channels' ? 'channels' : undefined,
    };
    if (!input.current.trim()) return json(400, { error: 'current 가 비어 있습니다' });
    const started = performance.now();
    const judgment = await getAnalyzer().analyze(input);
    const ms = Math.round(performance.now() - started);
    if (options.onJudgment) {
      try {
        void Promise.resolve(options.onJudgment(input, judgment, ms)).catch(() => undefined);
      } catch {
        // 기록 실패는 무시한다
      }
    }
    return json(200, { judgment, ms });
  });
}

// ── 한데 묶기 ──────────────────────────────────────────────

export interface FacelingHandlerOptions {
  session?: SessionHandlerOptions;
  transcription?: TranscriptionSessionHandlerOptions;
  judge?: JudgeHandlerOptions;
}

/**
 * 세 처리기를 경로의 마지막 부분으로 나눠 부른다.
 *  …/session → createSessionHandler, …/transcription-session → createTranscriptionSessionHandler, …/judge → createJudgeHandler
 * '/api/*' 처럼 한 곳에 걸어 두면 브라우저 쪽 기본 주소와 맞는다. 그 밖의 경로는 404.
 */
export function createFacelingHandler(options: FacelingHandlerOptions = {}): FetchHandler {
  const routes: Record<string, FetchHandler> = {
    session: createSessionHandler(options.session),
    'transcription-session': createTranscriptionSessionHandler(options.transcription),
    judge: createJudgeHandler(options.judge),
  };
  return async (request) => {
    const last = new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
    const route = routes[last];
    return route ? route(request) : json(404, { error: '없는 경로입니다' });
  };
}
