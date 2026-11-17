import type { MouthFeatures } from '@redbridge/faceling-core/compositor';
import { MouthAnalyser } from '@redbridge/faceling-core/lipsync';
import type { LiveDirector } from '@redbridge/faceling-core/live';
import { LiveTranscriber } from './transcriber.js';

/**
 * OpenAI Realtime API 에 WebRTC 로 붙고, 오는 사건을 LiveDirector 에 넘긴다.
 * 이 파일이 "어댑터"다. 다른 음성 대화 서비스에 붙일 때는 이 파일에 해당하는 것만 새로 쓰면 된다.
 * 실제 키는 서버에만 둔다. 이 클래스는 서버(@redbridge/faceling-server 의 createSessionHandler)에서 몇 분짜리 임시 키를 받아 쓴다.
 *
 * 연결 방식은 OpenAI 문서(voice-webrtc)를 따랐다:
 *  1. 내 서버(sessionUrl)에서 임시 키를 받는다.
 *  2. 마이크를 넣고 "oai-events" 데이터 채널을 연 뒤 SDP 를 /v1/realtime/calls 에 보낸다.
 *  3. AI 음성은 오디오 트랙으로, 텍스트와 상태는 데이터 채널로 온다.
 */

export interface RealtimeCallbacks {
  onStatus(text: string): void;
  onCaption(who: 'user' | 'assistant', text: string, final: boolean): void;
  onError(message: string): void;
  /** 연결이 저절로 끊겼을 때 (네트워크 문제 등). 직접 끊은 경우에는 부르지 않는다. */
  onDropped?(): void;
}

export interface ConnectOptions {
  /** AI 목소리 이름. 연결한 뒤에는 바꿀 수 없다. */
  voice?: string;
  /** 사용자가 말하는 도중에도 듣는 반응을 낼지. 전사용 연결을 하나 더 연다. */
  liveReactions?: boolean;
  /** 마이크 대신 쓸 소리. 시험용. */
  micOverride?: () => Promise<MediaStream>;
  /** 마이크 없이 글로만 대화한다. AI 의 답은 여전히 소리로 나온다. */
  withoutMic?: boolean;
  /** 연결되자마자 AI 가 먼저 인사하게 한다. */
  greet?: boolean;
  /** 캐릭터(몸) 이름. 서버가 이 이름으로 AI 에게 자기 몸을 알려 준다(@redbridge/faceling-server 의 characters 옵션). */
  character?: string;
}

export interface RealtimeConnectionOptions {
  /** 대화용 임시 키를 발급하는 내 서버 주소. 기본값 '/api/session'. 본문으로 { voice, character } 를 보낸다. */
  sessionUrl?: string;
  /** 말하는 도중의 전사에 쓸 임시 키를 발급하는 주소. 기본값 '/api/transcription-session'. */
  transcriptionSessionUrl?: string;
  /** 임시 키 요청에 붙일 헤더. 내 서버의 인증에 쓴다. */
  headers?: Record<string, string>;
  /**
   * 임시 키를 받을 때 쓸 fetch. 서버 없이 브라우저 안에서 임시 키를 발급할 때 바꿔 끼운다
   * (@redbridge/faceling-server 의 처리기는 Request 를 받아 Response 를 돌려주므로 그대로 넣을 수 있다).
   */
  fetch?: typeof fetch;
  /** speakFirst() 가 AI 에게 넣는 지시. 기본값은 한국어 인사 요청이다. */
  greeting?: string;
}

const DEFAULT_GREETING = '(대화를 시작합니다. 먼저 반갑게 인사하고 오늘 하루가 어땠는지 물어봐 주세요.)';

interface ServerEvent {
  type: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  response?: { status?: string };
}

export class RealtimeConnection {
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private readonly audio = document.createElement('audio');
  private ctx: AudioContext | null = null;
  private mouthAnalyser: MouthAnalyser | null = null;
  private channel: RTCDataChannel | null = null;
  private assistantLine = '';
  /** 말하는 도중의 전사를 받는 두 번째 연결. 켜지 않았거나 실패하면 null. */
  transcriber: LiveTranscriber | null = null;
  private userSpeaking = false;
  /** AI 가 응답을 만드는 중인지(response.created ~ response.done) */
  private responding = false;
  /** AI 음성이 재생되는 중인지 */
  private speaking = false;
  connected = false;
  /** 마이크를 쓰지 못해(또는 쓰지 않기로 해서) 듣기만 하는 연결인지 */
  listenOnly = false;
  /** 마이크 음소거 여부. 연결은 그대로 두고 입력만 막는다. */
  micEnabled = true;
  /** 받은 사건 종류별 횟수. 문제를 찾을 때 본다. */
  readonly seen: Record<string, number> = {};

  constructor(
    private readonly director: LiveDirector,
    private readonly callbacks: RealtimeCallbacks,
    private readonly options: RealtimeConnectionOptions = {},
  ) {
    this.audio.autoplay = true;
  }

  async connect(options: ConnectOptions = {}): Promise<void> {
    this.callbacks.onStatus('임시 키를 받는 중');
    const tokenRes = await (this.options.fetch ?? fetch)(this.options.sessionUrl ?? '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.options.headers },
      body: JSON.stringify({ voice: options.voice, character: options.character }),
    });
    const token = (await tokenRes.json()) as { value?: string; model?: string; error?: string };
    if (!tokenRes.ok || !token.value) throw new Error(token.error ?? '임시 키를 받지 못했습니다');

    this.callbacks.onStatus('마이크를 여는 중');
    try {
      if (options.withoutMic) throw new Error('마이크 없이 연결');
      this.mic = options.micOverride
        ? await options.micOverride()
        : await navigator.mediaDevices.getUserMedia({ audio: true });
      this.listenOnly = false;
    } catch {
      // 마이크를 쓸 수 없으면 소리 없는 트랙을 넣고 듣기만 한다. "AI 가 먼저 말하기"로 표정은 볼 수 있다.
      const silent = new AudioContext();
      this.mic = silent.createMediaStreamDestination().stream;
      this.listenOnly = true;
    }
    this.micEnabled = !this.listenOnly;

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      this.audio.srcObject = stream;
      // 입 모양용 분석. 스피커로 나가는 소리는 audio 요소가 맡고, 여기서는 분석만 한다.
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.ctx = ctx;
      this.mouthAnalyser = new MouthAnalyser(analyser, ctx.sampleRate);
    };
    for (const track of this.mic.getTracks()) pc.addTrack(track, this.mic);

    const channel = pc.createDataChannel('oai-events');
    this.channel = channel;
    channel.addEventListener('message', (event) => {
      try {
        this.handle(JSON.parse(event.data as string) as ServerEvent);
      } catch (err) {
        this.callbacks.onError(err instanceof Error ? err.message : String(err));
      }
    });
    channel.addEventListener('open', () => {
      this.connected = true;
      this.callbacks.onStatus(
        this.listenOnly
          ? `연결됨 (${token.model ?? ''}). 마이크를 쓸 수 없어 듣기만 합니다. "AI 가 먼저 말하기"를 눌러 보세요.`
          : `연결됨 (${token.model ?? ''}). 말을 걸어 보세요.`,
      );
      if (options.greet) this.speakFirst();
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (this.pc !== pc) return;
        this.callbacks.onStatus('연결이 끊겼습니다');
        this.disconnect();
        this.callbacks.onDropped?.();
      }
    });

    this.callbacks.onStatus('연결하는 중');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
    });
    if (!sdpRes.ok) throw new Error(`OpenAI 연결 실패 (${sdpRes.status}): ${(await sdpRes.text()).slice(0, 300)}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

    // 말하는 도중의 전사. 실패해도 대화는 계속되고, 듣는 반응만 말이 끝난 뒤에 나온다.
    if (options.liveReactions !== false && !this.listenOnly && this.mic) {
      const transcriber = new LiveTranscriber(
        (text) => this.onPartial(text),
        (message) => this.callbacks.onError(message),
        { sessionUrl: this.options.transcriptionSessionUrl, headers: this.options.headers, fetch: this.options.fetch },
      );
      try {
        await transcriber.connect(this.mic);
        this.transcriber = transcriber;
      } catch (err) {
        transcriber.disconnect();
        this.callbacks.onError(`말하는 도중의 반응을 켜지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** 말하는 도중에 들린 글자. 사용자가 말하는 중일 때만 쓴다. */
  private onPartial(text: string): void {
    // AI 가 말하는 동안 들어온 글자는 스피커 소리가 마이크로 돌아온 것일 수 있다
    if (!this.userSpeaking && this.director.face.turn === 'speaking') {
      this.transcriber?.discard();
      return;
    }
    this.callbacks.onCaption('user', text, false);
    this.director.userPartial(text);
  }

  disconnect(): void {
    this.connected = false;
    this.pc?.close();
    this.pc = null;
    this.channel = null;
    this.transcriber?.disconnect();
    this.transcriber = null;
    this.userSpeaking = false;
    this.responding = false;
    this.speaking = false;
    for (const track of this.mic?.getTracks() ?? []) track.stop();
    this.mic = null;
    void this.ctx?.close();
    this.ctx = null;
    this.mouthAnalyser = null;
    this.audio.srcObject = null;
    this.director.assistantInterrupted();
    this.director.face.turn = 'idle';
  }

  /**
   * 마이크를 켜고 끈다. 연결은 그대로 두고 소리만 막는다.
   * 전사용 연결도 같은 트랙을 쓰므로 함께 막힌다.
   */
  setMicEnabled(on: boolean): void {
    if (this.listenOnly) return;
    this.micEnabled = on;
    for (const track of this.mic?.getAudioTracks() ?? []) track.enabled = on;
    if (!on && this.userSpeaking) {
      this.userSpeaking = false;
      this.director.userSpeechStopped();
      this.transcriber?.cut();
    }
  }

  /** AI 가 먼저 말을 꺼내게 한다. */
  speakFirst(): void {
    // 응답에 지시를 따로 주면 세션의 지시(한국어로 말하기 등)가 덮인다. 그래서 대화 항목으로 넣는다.
    this.say(this.options.greeting ?? DEFAULT_GREETING);
  }

  /** 마이크 대신 글로 말을 건다. 듣는 반응도 같이 건다. */
  sendText(text: string): void {
    const line = text.trim();
    if (!line || this.channel?.readyState !== 'open') return;
    this.callbacks.onCaption('user', line, true);
    this.director.face.turn = 'thinking';
    this.director.userTranscript(line);
    this.say(line);
  }

  /** AI 가 말하는 중이면 끊는다. 사용자가 끼어든 것과 같은 효과다. */
  interrupt(): void {
    if (this.channel?.readyState !== 'open') return;
    // 아직 만들고 있는 응답이 있으면 그것부터 멈춘다. 재생 버퍼만 비우면 남은 소리가 이어서 들어온다.
    if (this.responding) this.channel.send(JSON.stringify({ type: 'response.cancel' }));
    this.channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
  }

  private say(text: string): void {
    if (this.channel?.readyState !== 'open') return;
    // AI 가 말하는 도중에 글을 보내면 끼어든 것으로 본다. 끊지 않으면 새 응답의 소리가 앞 소리 뒤에 이어 붙어
    // "소리 시작" 신호가 오지 않고, 그 응답에는 표정과 몸짓이 하나도 걸리지 않는다.
    if (this.responding || this.speaking) this.interrupt();
    this.channel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }),
    );
    this.channel.send(JSON.stringify({ type: 'response.create' }));
  }

  /** 지금 나오는 AI 음성의 입 모양. 연결 전이면 null. */
  mouth(): MouthFeatures | null {
    return this.mouthAnalyser?.read() ?? null;
  }

  private handle(event: ServerEvent): void {
    const d = this.director;
    this.seen[event.type] = (this.seen[event.type] ?? 0) + 1;
    switch (event.type) {
      // ── AI 발화 ──
      case 'response.created':
        this.responding = true;
        this.assistantLine = '';
        d.assistantStarted();
        break;
      case 'response.done':
        this.responding = false;
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.assistantLine += event.delta;
          d.assistantText(event.delta);
          this.callbacks.onCaption('assistant', this.assistantLine, false);
        }
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        d.assistantTextDone();
        this.callbacks.onCaption('assistant', event.transcript ?? this.assistantLine, true);
        break;
      // 아래 셋은 WebRTC 에서만 온다. 서버가 실제 재생 위치를 알고 알려 준다.
      case 'output_audio_buffer.started':
        if (!this.userSpeaking) this.transcriber?.discard();
        this.speaking = true;
        d.assistantAudioStarted();
        break;
      case 'output_audio_buffer.stopped':
        this.speaking = false;
        d.assistantAudioStopped();
        break;
      case 'output_audio_buffer.cleared':
        this.speaking = false;
        d.assistantInterrupted();
        break;

      // ── 사용자 발화 ──
      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true;
        d.userSpeechStarted();
        // 말의 시작을 알아채기 전에 이미 들린 글자가 있으면 바로 반영한다
        if (this.transcriber?.current) this.onPartial(this.transcriber.current);
        break;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false;
        d.userSpeechStopped();
        this.transcriber?.cut();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          this.callbacks.onCaption('user', event.transcript, true);
          d.userTranscript(event.transcript);
        }
        break;

      case 'error':
        this.callbacks.onError(event.error?.message ?? 'OpenAI 오류');
        break;
      default:
        break;
    }
  }
}
