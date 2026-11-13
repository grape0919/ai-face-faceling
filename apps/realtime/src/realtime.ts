import type { MouthFeatures } from '@faceling/core/compositor';
import { MouthAnalyser } from '@faceling/core/lipsync';
import type { LiveDirector } from '@faceling/core/live';
import { LiveTranscriber } from './transcriber';

/**
 * OpenAI Realtime API 에 WebRTC 로 붙고, 오는 사건을 LiveDirector 에 넘긴다.
 * 이 파일이 "어댑터"다. 다른 음성 대화 서비스에 붙일 때는 이 파일에 해당하는 것만 새로 쓰면 된다.
 *
 * 연결 방식은 OpenAI 문서(voice-webrtc)를 따랐다:
 *  1. 우리 서버에서 임시 키를 받는다.
 *  2. 마이크를 넣고 "oai-events" 데이터 채널을 연 뒤 SDP 를 /v1/realtime/calls 에 보낸다.
 *  3. AI 음성은 오디오 트랙으로, 텍스트와 상태는 데이터 채널로 온다.
 */

export interface RealtimeCallbacks {
  onStatus(text: string): void;
  onCaption(who: 'user' | 'assistant', text: string, final: boolean): void;
  onError(message: string): void;
}

export interface ConnectOptions {
  /** AI 목소리 이름. 연결한 뒤에는 바꿀 수 없다. */
  voice?: string;
  /** 사용자가 말하는 도중에도 듣는 반응을 낼지. 전사용 연결을 하나 더 연다. */
  liveReactions?: boolean;
  /** 마이크 대신 쓸 소리. 시험용. */
  micOverride?: () => Promise<MediaStream>;
}

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
  connected = false;
  /** 마이크를 쓰지 못해 듣기만 하는 연결인지 */
  listenOnly = false;
  /** 받은 사건 종류별 횟수. 문제를 찾을 때 본다. */
  readonly seen: Record<string, number> = {};

  constructor(
    private readonly director: LiveDirector,
    private readonly callbacks: RealtimeCallbacks,
  ) {
    this.audio.autoplay = true;
  }

  async connect(options: ConnectOptions = {}): Promise<void> {
    this.callbacks.onStatus('임시 키를 받는 중');
    const tokenRes = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: options.voice }),
    });
    const token = (await tokenRes.json()) as { value?: string; model?: string; error?: string };
    if (!tokenRes.ok || !token.value) throw new Error(token.error ?? '임시 키를 받지 못했습니다');

    this.callbacks.onStatus('마이크를 여는 중');
    try {
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
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.callbacks.onStatus('연결이 끊겼습니다');
        this.disconnect();
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
    for (const track of this.mic?.getTracks() ?? []) track.stop();
    this.mic = null;
    void this.ctx?.close();
    this.ctx = null;
    this.mouthAnalyser = null;
    this.audio.srcObject = null;
    this.director.assistantInterrupted();
    this.director.face.turn = 'idle';
  }

  /** AI 가 먼저 말을 꺼내게 한다. */
  speakFirst(): void {
    // 응답에 지시를 따로 주면 세션의 지시(한국어로 말하기 등)가 덮인다. 그래서 대화 항목으로 넣는다.
    this.say('(대화를 시작합니다. 먼저 반갑게 인사하고 오늘 하루가 어땠는지 물어봐 주세요.)');
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
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
  }

  private say(text: string): void {
    if (this.channel?.readyState !== 'open') return;
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
        this.assistantLine = '';
        d.assistantStarted();
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
        d.assistantAudioStarted();
        break;
      case 'output_audio_buffer.stopped':
        d.assistantAudioStopped();
        break;
      case 'output_audio_buffer.cleared':
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
