/**
 * 사용자가 말하는 도중의 전사.
 *
 * 대화용 연결은 사용자의 말이 끝난 뒤에야 전사를 보내 준다. 그래서 같은 마이크 소리를
 * 전사만 하는 두 번째 연결에도 보내고, 거기서 말이 들어오는 대로 글자를 받는다.
 * 이 연결은 말의 시작과 끝을 스스로 알지 못하므로, 끊는 시점은 대화용 연결이 알려 준다(cut).
 */

interface TranscriptionEvent {
  type: string;
  delta?: string;
  error?: { message?: string };
}

export interface LiveTranscriberOptions {
  /** 전사용 임시 키를 발급하는 내 서버 주소. 기본값 '/api/transcription-session'. */
  sessionUrl?: string;
  /** 임시 키 요청에 붙일 헤더 */
  headers?: Record<string, string>;
  /** 임시 키를 받을 때 쓸 fetch. 서버 없이 브라우저 안에서 발급할 때 바꿔 끼운다. */
  fetch?: typeof fetch;
}

export class LiveTranscriber {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private text = '';
  /** 받은 사건 종류별 횟수. 문제를 찾을 때 본다. */
  readonly seen: Record<string, number> = {};
  ready = false;

  constructor(
    /** 이번 발화에서 지금까지 들린 전체 글자를 넘긴다 */
    private readonly onPartial: (text: string) => void,
    private readonly onProblem: (message: string) => void,
    private readonly options: LiveTranscriberOptions = {},
  ) {}

  async connect(mic: MediaStream): Promise<void> {
    const tokenRes = await (this.options.fetch ?? fetch)(this.options.sessionUrl ?? '/api/transcription-session', {
      method: 'POST',
      headers: this.options.headers,
    });
    const token = (await tokenRes.json()) as { value?: string; error?: string };
    if (!tokenRes.ok || !token.value) throw new Error(token.error ?? '전사용 임시 키를 받지 못했습니다');

    const pc = new RTCPeerConnection();
    this.pc = pc;
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    const channel = pc.createDataChannel('oai-events');
    this.channel = channel;
    channel.addEventListener('open', () => (this.ready = true));
    channel.addEventListener('message', (event) => {
      const data = JSON.parse(event.data as string) as TranscriptionEvent;
      this.seen[data.type] = (this.seen[data.type] ?? 0) + 1;
      if (data.type === 'conversation.item.input_audio_transcription.delta' && data.delta) {
        this.text += data.delta;
        this.onPartial(this.text);
      } else if (data.type === 'error') {
        // 들린 소리가 없는데 끊으라고 하면 오류가 온다. 그런 것은 문제 삼지 않는다.
        const message = data.error?.message ?? '';
        if (!/buffer|empty|too small/i.test(message)) this.onProblem(`전사 연결: ${message}`);
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
    });
    if (!sdpRes.ok) throw new Error(`전사 연결 실패 (${sdpRes.status}): ${(await sdpRes.text()).slice(0, 200)}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
  }

  /** 지금까지 들린 글자 */
  get current(): string {
    return this.text;
  }

  /** 사용자의 말 한 번이 끝났다. 지금까지의 소리를 마무리하고 다음 말을 새로 받는다. */
  cut(): void {
    this.text = '';
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  /** 받은 글자를 버린다. AI 가 말하는 동안 스피커 소리가 마이크로 들어온 경우 등에 쓴다. */
  discard(): void {
    this.text = '';
  }

  disconnect(): void {
    this.ready = false;
    this.pc?.close();
    this.pc = null;
    this.channel = null;
    this.text = '';
  }
}
