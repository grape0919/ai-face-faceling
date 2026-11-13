import { charCount } from '@faceling/core/clauses';
import type { MouthFeatures } from '@faceling/core/compositor';
import type { LiveDirector } from '@faceling/core/live';

/**
 * OpenAI 연결 없이 실시간 경로를 돌려 보는 모의 대화.
 * 음성 대화 서비스가 보내는 것과 같은 순서로 사건을 흘려 넣는다. 분석기(Jev)는 실제로 부른다.
 * 소리는 나지 않고, 입은 가짜 값으로 움직인다. 말 빠르기와 텍스트 도착 속도는 가정한 값이다.
 */

export interface SimLine {
  speaker: 'user' | 'assistant';
  text: string;
}

/** 가정: 글자당 재생 시간(초), 문장부호 뒤 쉼, 텍스트가 소리보다 얼마나 빨리 도착하는지 */
const SECONDS_PER_CHAR = 0.17;
const TEXT_CHUNK = 6;
const TEXT_INTERVAL_MS = 45;
const AUDIO_DELAY_MS = 350;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const spokenSeconds = (text: string): number => {
  const pauses = (text.match(/[.?!…]/g) ?? []).length * 0.3 + (text.match(/[,;:]/g) ?? []).length * 0.14;
  return charCount(text) * SECONDS_PER_CHAR + pauses;
};

export class Simulation {
  private speakingUntil = 0;
  private stopped = false;
  running = false;

  constructor(
    private readonly director: LiveDirector,
    private readonly onCaption: (who: 'user' | 'assistant', text: string, final: boolean) => void,
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async run(lines: SimLine[]): Promise<void> {
    this.running = true;
    this.stopped = false;
    try {
      for (const line of lines) {
        if (this.stopped) break;
        if (line.speaker === 'user') await this.user(line.text);
        else await this.assistant(line.text);
        await sleep(400);
      }
    } finally {
      this.running = false;
      this.speakingUntil = 0;
    }
  }

  /** 모의 대화 중 AI 가 말하는 동안의 가짜 입 모양 */
  mouth(): MouthFeatures | null {
    const now = performance.now();
    if (now >= this.speakingUntil) return null;
    const t = now / 1000;
    const jaw = Math.max(0, 0.35 + 0.3 * Math.sin(t * 19) + 0.2 * Math.sin(t * 7.3));
    return { jaw, funnel: jaw * Math.max(0, Math.sin(t * 3.1)) * 0.6, stretch: jaw * Math.max(0, Math.sin(t * 2.3 + 1)) * 0.5 };
  }

  private async user(text: string): Promise<void> {
    this.director.userSpeechStarted();
    this.onCaption('user', text, false);
    await sleep(spokenSeconds(text) * 1000);
    this.director.userSpeechStopped();
    // 전사는 말이 끝난 뒤에 도착한다
    await sleep(300);
    this.onCaption('user', text, true);
    this.director.userTranscript(text);
    await sleep(500);
  }

  private async assistant(text: string): Promise<void> {
    this.director.assistantStarted();
    const duration = spokenSeconds(text) * 1000;
    const begun = performance.now();
    let audioStarted = false;
    const startAudio = (): void => {
      if (audioStarted) return;
      audioStarted = true;
      this.speakingUntil = performance.now() + duration;
      this.director.assistantAudioStarted();
    };

    // 텍스트는 소리보다 훨씬 빨리 도착한다
    let shown = '';
    for (let i = 0; i < text.length; i += TEXT_CHUNK) {
      if (this.stopped) break;
      const delta = text.slice(i, i + TEXT_CHUNK);
      shown += delta;
      this.director.assistantText(delta);
      this.onCaption('assistant', shown, false);
      if (performance.now() - begun >= AUDIO_DELAY_MS) startAudio();
      await sleep(TEXT_INTERVAL_MS);
    }
    this.director.assistantTextDone();
    this.onCaption('assistant', text, true);
    const wait = AUDIO_DELAY_MS - (performance.now() - begun);
    if (wait > 0) await sleep(wait);
    startAudio();

    while (performance.now() < this.speakingUntil && !this.stopped) await sleep(50);
    if (this.stopped) this.director.assistantInterrupted();
    else this.director.assistantAudioStopped();
    this.speakingUntil = 0;
  }
}

export const DEMO_LINES: SimLine[] = [
  { speaker: 'assistant', text: '안녕하세요! 오늘 하루는 어떠셨어요?' },
  { speaker: 'user', text: '사실 오늘 좀 힘들었어요. 지난주에 본 면접에서 떨어졌다는 연락을 받았거든요.' },
  { speaker: 'assistant', text: '아, 그러셨군요. 많이 속상하셨겠어요. 준비도 오래 하셨을 텐데, 마음이 많이 무거우시죠?' },
  { speaker: 'user', text: '네, 그런데 방금 다른 회사에서 최종 합격했다는 메일이 왔어요!' },
  { speaker: 'assistant', text: '정말요? 와, 축하드려요! 그동안 고생하신 보람이 있네요. 어느 회사인지 여쭤봐도 될까요?' },
  { speaker: 'user', text: '서울에 있는 회사인데, 출근은 다음 달 첫 주부터예요.' },
  { speaker: 'assistant', text: '그렇군요. 다음 달 첫 주면 준비할 시간이 삼 주 정도 있네요. 필요한 서류는 미리 챙겨 두시면 좋아요.' },
];
