import type { Session } from '../shared/types';
import { MouthAnalyser } from '@faceling/core/lipsync';
import type { MouthFeatures } from '../face/engine';

/**
 * 세션의 턴 음성을 시각에 맞춰 재생하고, AI 음성에서 입 모양 값을 뽑는다.
 * 재생 시각의 기준은 AudioContext 시계다.
 */
export class SessionPlayer {
  readonly ctx = new AudioContext();
  /** 녹화용 출력. 스피커로 나가는 소리와 같은 소리가 들어간다. */
  readonly recordOut = this.ctx.createMediaStreamDestination();
  private readonly analyser = this.ctx.createAnalyser();
  private readonly master = this.ctx.createGain();
  private readonly mouthAnalyser = new MouthAnalyser(this.analyser, this.ctx.sampleRate);
  private buffers: AudioBuffer[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private session: Session | null = null;
  private startedAt = 0;
  private stoppedAt = 0;
  playing = false;

  constructor() {
    this.analyser.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.master.connect(this.recordOut);
  }

  async load(session: Session, baseUrl: string): Promise<void> {
    this.stop();
    this.session = session;
    this.stoppedAt = 0;
    this.buffers = await Promise.all(
      session.turns.map(async (turn) => {
        const res = await fetch(`${baseUrl}/${turn.audio}`);
        if (!res.ok) throw new Error(`음성을 불러오지 못했습니다: ${turn.audio}`);
        return this.ctx.decodeAudioData(await res.arrayBuffer());
      }),
    );
  }

  /** 세션 재생 시각(초) */
  get time(): number {
    return this.playing ? this.ctx.currentTime - this.startedAt : this.stoppedAt;
  }

  async play(from = 0): Promise<void> {
    if (!this.session) return;
    this.stop();
    await this.ctx.resume();
    const lead = 0.15;
    this.startedAt = this.ctx.currentTime + lead - from;
    this.session.turns.forEach((turn, i) => {
      const buffer = this.buffers[i];
      if (!buffer || turn.end <= from) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      // AI 음성만 분석기를 거친다. 사용자 음성으로 입이 움직이면 안 된다.
      source.connect(turn.speaker === 'assistant' ? this.analyser : this.master);
      const offset = Math.max(0, from - turn.start);
      source.start(this.startedAt + turn.start + offset, offset);
      this.sources.push(source);
    });
    this.playing = true;
  }

  stop(): void {
    if (this.playing) this.stoppedAt = this.time;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // 아직 시작하지 않은 소스는 무시
      }
      s.disconnect();
    }
    this.sources = [];
    this.playing = false;
  }

  seek(t: number): void {
    this.stop();
    this.stoppedAt = t;
  }

  /** 지금 재생되는 AI 음성의 진폭과 대역 에너지로 입 모양을 추정한다. */
  mouth(): MouthFeatures {
    return this.mouthAnalyser.read();
  }
}
