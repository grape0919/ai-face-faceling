import { charCount } from '@redbridge/faceling-core/clauses';
import type { MouthFeatures } from '@redbridge/faceling-core/compositor';
import type { LiveDirector } from '@redbridge/faceling-core/live';
import { ARM_BODY } from '@redbridge/faceling-rigs/bodies';

/**
 * OpenAI 연결 없이 실시간 경로를 돌려 보는 모의 대화.
 * 음성 대화 서비스가 보내는 것과 같은 순서로 사건을 흘려 넣는다. 분석기(Jev)는 실제로 부른다.
 * 소리는 나지 않고, 입은 가짜 값으로 움직인다. 말 빠르기와 텍스트 도착 속도는 가정한 값이다.
 */

export interface SimLine {
  speaker: 'user' | 'assistant';
  text: string;
}

/** 가정: 글자당 재생 시간(초. 한글은 한 글자가 한 음절이라 로마자보다 길다), 문장부호 뒤 쉼, 텍스트가 소리보다 얼마나 빨리 도착하는지 */
const SECONDS_PER_HANGUL = 0.17;
const SECONDS_PER_LETTER = 0.07;
const TEXT_CHUNK = 6;
const TEXT_INTERVAL_MS = 45;
const AUDIO_DELAY_MS = 350;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const spokenSeconds = (text: string): number => {
  const pauses = (text.match(/[.?!…]/g) ?? []).length * 0.3 + (text.match(/[,;:]/g) ?? []).length * 0.14;
  return charCount(text) * (/[가-힣]/.test(text) ? SECONDS_PER_HANGUL : SECONDS_PER_LETTER) + pauses;
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
        await this.pause(400);
      }
    } finally {
      this.running = false;
      this.speakingUntil = 0;
      // 도중에 멈췄으면 얼굴을 쉬는 상태로 돌려놓는다
      if (this.stopped) {
        this.director.assistantInterrupted();
        this.director.face.turn = 'idle';
      }
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

  /** 멈추라고 하면 바로 깨어나는 쉼 */
  private async pause(ms: number): Promise<boolean> {
    const until = performance.now() + ms;
    while (!this.stopped && performance.now() < until) await sleep(Math.min(50, until - performance.now()));
    return !this.stopped;
  }

  private async user(text: string): Promise<void> {
    this.director.userSpeechStarted();
    this.onCaption('user', text, false);
    const finished = await this.pause(spokenSeconds(text) * 1000);
    this.director.userSpeechStopped();
    if (!finished) return;
    // 전사는 말이 끝난 뒤에 도착한다
    if (!(await this.pause(300))) return;
    this.onCaption('user', text, true);
    this.director.userTranscript(text);
    await this.pause(500);
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

const say = (speaker: SimLine['speaker'], text: string): SimLine => ({ speaker, text });

/** 감정이 오르내리는 대화. 어느 몸이든 같다. */
const STORY: Record<'ko' | 'en', SimLine[]> = {
  ko: [
    say('assistant', '안녕하세요! 오늘 하루는 어떠셨어요?'),
    say('user', '사실 오늘 좀 힘들었어요. 지난주에 본 면접에서 떨어졌다는 연락을 받았거든요.'),
    say('assistant', '아, 그러셨군요. 많이 속상하셨겠어요. 준비도 오래 하셨을 텐데, 마음이 많이 무거우시죠?'),
    say('user', '네, 그런데 방금 다른 회사에서 최종 합격했다는 메일이 왔어요!'),
    say('assistant', '정말요? 와, 축하드려요! 그동안 고생하신 보람이 있네요. 어느 회사인지 여쭤봐도 될까요?'),
    say('user', '서울에 있는 회사인데, 출근은 다음 달 첫 주부터예요.'),
    say('assistant', '그렇군요. 다음 달 첫 주면 준비할 시간이 삼 주 정도 있네요. 필요한 서류는 미리 챙겨 두시면 좋아요.'),
  ],
  en: [
    say('assistant', 'Hi there! How has your day been?'),
    say('user', 'Honestly, it was rough. I heard back about the interview I did last week, and I did not get the job.'),
    say('assistant', 'Oh, I am so sorry to hear that. That must have been really disappointing. You put so much into preparing, did you not?'),
    say('user', 'I did. But just now I got an email saying another company wants to hire me!'),
    say('assistant', 'Really? Wow, congratulations! All that hard work paid off. Can I ask which company it is?'),
    say('user', 'It is a company in Seoul, and I start the first week of next month.'),
    say('assistant', 'I see. That gives you about three weeks to get ready. It is a good idea to gather the paperwork you need ahead of time.'),
  ],
};

/** 시키는 대로 움직여 보이는 대목. 몸이 할 수 있는 것이 달라서 얼굴과 팔의 대사가 다르다. */
const FACE_MOVES: Record<'ko' | 'en', SimLine[]> = {
  ko: [
    say('user', '축하하는 뜻으로 윙크 한번 해 줄래요?'),
    say('assistant', '좋아요, 찡긋!'),
    say('user', '이번에는 오른쪽을 봐 주세요.'),
    say('assistant', '네, 오른쪽으로 휙!'),
    say('user', '이제 다시 앞을 봐요.'),
    say('assistant', '네, 다시 정면!'),
  ],
  en: [
    say('user', 'Could you give me a wink to celebrate?'),
    say('assistant', 'Sure thing, wink!'),
    say('user', 'Now look to the right for me.'),
    say('assistant', 'Okay, turning to the right!'),
    say('user', 'And look straight ahead again.'),
    say('assistant', 'Okay, back to the front!'),
  ],
};
const ARM_MOVES: Record<'ko' | 'en', SimLine[]> = {
  ko: [
    say('user', '축하하는 뜻으로 손 한번 흔들어 줄래요?'),
    say('assistant', '좋아요, 흔들흔들! 축하해요!'),
    say('user', '이번에는 팔을 오른쪽으로 뻗어 봐요.'),
    say('assistant', '네, 오른쪽으로 쭉!'),
    say('user', '이제 제자리로 돌아와요.'),
    say('assistant', '네, 제자리로!'),
  ],
  en: [
    say('user', 'Could you give me a wave to celebrate?'),
    say('assistant', 'Sure thing, waving! Congratulations!'),
    say('user', 'Now reach your arm out to the right.'),
    say('assistant', 'Okay, reaching to the right!'),
    say('user', 'And come back to where you started.'),
    say('assistant', 'Okay, back home!'),
  ],
};

/** 그 언어와 몸(BodySpec 의 name)에 맞는 예시 대화 */
export function demoLines(lang: 'ko' | 'en', body: string): SimLine[] {
  return [...STORY[lang], ...(body === ARM_BODY.name ? ARM_MOVES : FACE_MOVES)[lang]];
}
