import { charCount, ClauseSplitter, type Clause } from './clauses';
import { BLINK_DURATION, Compositor, bell, type MouthFeatures, type TurnState } from './compositor';
import type { AnalyzerInput, Judgment } from './judgment';
import type { FacePose } from './mapping';
import { actionWeight, amplitude, targetWeights, type Gesture, type Weights } from './weights';

/**
 * 실시간 대화용 표정 엔진.
 *
 * 음성 대화 서비스에서 오는 사건(텍스트 조각, 소리 시작·끝, 사용자 말 시작·끝)을 LiveDirector 에 넣으면,
 * 절 단위로 분석기를 부르고, 그 절이 소리로 나올 시각을 추정해 표정을 예약한다.
 * 화면 쪽은 매 프레임 LiveFace.update() 로 얼굴 한 장을 받는다.
 *
 * 시각은 모두 초 단위이며 바깥에서 넣는 시계 하나(clock)를 기준으로 한다.
 */

export interface LiveCue {
  t: number;
  until: number;
  weights: Weights;
  kind: 'speak' | 'react';
  text: string;
  judgment: Judgment;
}

export interface LiveFrame extends FacePose {
  debug: { turn: TurnState; weights: Weights; cue: LiveCue | null };
}

/** 예약된 표정을 시각에 맞춰 얼굴로 만든다. */
export class LiveFace {
  turn: TurnState = 'idle';
  private cues: LiveCue[] = [];
  private gestures: Gesture[] = [];
  private readonly compositor = new Compositor();
  private lastT: number | null = null;
  private nextBlink = 0;
  private blinkAt = -10;

  schedule(cue: LiveCue): void {
    this.cues.push(cue);
    this.cues.sort((a, b) => a.t - b.t);
  }

  addGesture(gesture: Gesture): void {
    this.gestures.push(gesture);
  }

  /** 지금 걸린 표정과 앞으로 예약된 표정을 모두 거둔다. kind 를 주면 그 종류만. */
  cancel(now: number, kind?: LiveCue['kind']): void {
    this.cues = this.cues.filter((cue) => {
      if (kind && cue.kind !== kind) return true;
      if (cue.t > now) return false;
      cue.until = Math.min(cue.until, now);
      return true;
    });
    this.gestures = this.gestures.filter((g) => g.t <= now);
  }

  /** 지금 걸려 있는 표정을 until 까지만 유지한다. */
  endBy(until: number, kind: LiveCue['kind']): void {
    for (const cue of this.cues) if (cue.kind === kind) cue.until = Math.min(cue.until, until);
  }

  activeCue(now: number): LiveCue | null {
    let active: LiveCue | null = null;
    for (const cue of this.cues) {
      if (cue.t > now) break;
      if (now <= cue.until) active = cue;
    }
    return active;
  }

  update(now: number, mouth: MouthFeatures | null): LiveFrame {
    const dt = this.lastT === null ? 10 : Math.min(0.25, Math.max(0, now - this.lastT));
    this.lastT = now;

    // 지나간 예약은 치운다
    this.cues = this.cues.filter((cue) => cue.until > now - 2);
    this.gestures = this.gestures.filter((g) => g.t + g.dur > now - 0.1);

    // 깜빡임은 2.5~5.5초 간격으로 계속 예약한다
    if (now >= this.nextBlink) {
      this.blinkAt = now;
      this.nextBlink = now + 2.5 + Math.random() * 3;
    }

    const cue = this.activeCue(now);
    const pose = this.compositor.step(now, dt, {
      turn: this.turn,
      target: cue?.weights ?? null,
      targetSince: cue?.t ?? 0,
      gestures: this.gestures,
      mouth,
      blink: bell((now - this.blinkAt) / BLINK_DURATION),
    });
    return { ...pose, debug: { turn: this.turn, weights: { ...this.compositor.weights }, cue } };
  }
}

export interface DirectorOptions {
  /** 분석기 호출. 실패하면 그 절은 표정 없이 지나간다. */
  judge: (input: AnalyzerInput) => Promise<Judgment>;
  clock: () => number;
  /** 듣는 반응을 낼지. 끄면 AI 가 말하는 표정만 낸다. */
  reactToUser?: boolean;
  /** 처음에 쓸 말 빠르기(글자당 초, 공백 제외). 응답이 끝날 때마다 실제 값으로 고쳐 나간다. */
  secondsPerChar?: number;
  onStats?: (stats: DirectorStats) => void;
}

export interface DirectorStats {
  /** 판단한 절 수 */
  judged: number;
  /** 소리가 이미 지나가서 버린 절 수 */
  missed: number;
  /** 가장 최근 절에서 판단이 소리보다 얼마나 먼저 도착했는지(초). 음수면 늦은 것. */
  lastLead: number | null;
  /** 판단이 소리보다 먼저 도착한 시간의 평균(초) */
  meanLead: number | null;
  /** 소리가 시작된 뒤 그 응답의 첫 표정이 걸리기까지 걸린 시간의 평균(초). 0 이면 소리와 함께 시작. */
  meanFirstDelay: number | null;
  /** 분석기 응답 시간의 평균(초) */
  meanLatency: number | null;
  /** 지금 쓰는 말 빠르기 추정값(글자당 초) */
  secondsPerChar: number;
}

/** 문장부호 뒤에 쉬는 시간(초) */
const PAUSE_SENTENCE = 0.3;
const PAUSE_COMMA = 0.14;
const pauseAfter = (text: string): number =>
  /[.?!…。？！]["')\]」』]*$/.test(text) ? PAUSE_SENTENCE : /[,，、;:]$/.test(text) ? PAUSE_COMMA : 0;

/** 판단에 참고로 넘기는 직전 대화의 대사 수(사용자와 AI 의 말을 합쳐서) */
const CONTEXT_TURNS = 4;
/** 같은 응답 안에서 바로 앞에 한 말을 몇 절까지 함께 넘길지 */
const CONTEXT_CLAUSES = 2;
/** 대사 하나가 너무 길면 뒤쪽만 넘긴다(글자 수) */
const CONTEXT_LINE_MAX = 160;
/** 사용자가 말하는 도중: 이만큼(공백 제외 글자 수) 새로 들릴 때마다 다시 판단한다 */
const PARTIAL_STEP = 10;
/** 사용자 말이 길면 판단 대상은 끝부분 이만큼만(글자 수), 앞부분은 맥락으로 넘긴다 */
const USER_WINDOW = 60;
/** 응답의 첫 절이 완성되기 전에, 앞머리가 이만큼(공백 제외 글자 수) 들어오면 먼저 판단해 둔다 */
const PRIME_CHARS = 6;
/** 앞머리로 건 표정이 유지되는 최대 시간(초). 첫 절의 표정이 걸리면 그쪽으로 넘어간다. */
const PRIME_HOLD = 2.5;
/** 듣는 도중의 끄덕임은 이 간격보다 자주 하지 않는다(초) */
const NOD_GAP = 1.8;
/** 표정은 절의 소리가 끝난 뒤 이만큼 더 남는다 */
const HOLD_AFTER = 0.4;
/** 듣는 반응은 AI 가 말을 시작하지 않아도 이 시간이 지나면 사라진다 */
const REACT_MAX = 6;
const REACT_SCALE = 0.85;
/** AI 가 말을 시작한 뒤 듣는 반응이 남아 있는 시간 */
const REACT_BRIDGE = 1.0;

interface PendingClause {
  clause: Clause;
  /** 응답의 소리 시작을 0 으로 본 추정 시작·끝 시각 */
  start: number;
  end: number;
  judgment: Judgment | null;
  /** 판단이 도착한 시각 */
  arrived: number;
  scheduled: boolean;
}

interface ResponseState {
  id: number;
  splitter: ClauseSplitter;
  clauses: PendingClause[];
  /** 소리가 실제로 나오기 시작한 시각. 아직이면 null. */
  audioStart: number | null;
  cursor: number;
  pauses: number;
  cancelled: boolean;
  /** 지금까지 도착한 텍스트 */
  raw: string;
  /** 앞머리만 보고 미리 받은 판단. 첫 절이 길 때 표정이 늦지 않게 한다. */
  primeAsked: boolean;
  prime: Judgment | null;
  /** 이 응답에서 표정이 처음 걸렸는지 */
  shown: boolean;
}

/** 대화의 사건을 받아 표정을 예약한다. */
export class LiveDirector {
  readonly stats: DirectorStats;
  private response: ResponseState | null = null;
  private nextId = 1;
  /** 지난 대화. 사용자 말의 전사는 늦게 오므로, 말이 끝난 시점에 자리를 먼저 잡아 두고 나중에 채운다. */
  private history: { who: 'user' | 'assistant'; text: string }[] = [];
  /** 말은 끝났지만 최종 전사가 아직 오지 않은 사용자 발화들. 전사는 말한 순서대로 온다. */
  private openSlots: { who: 'user' | 'assistant'; text: string }[] = [];
  private userTalking = false;
  /** 이번 사용자 발화에서 지금까지 들린 말(말하는 도중의 전사) */
  private liveUser = '';
  private liveJudgedChars = 0;
  private liveBusy = false;
  private lastNod = -10;
  private rate: number;
  private leads: number[] = [];
  private latencies: number[] = [];
  private firstDelays: number[] = [];
  /** 사용자 말 판단은 최신 것만 쓴다 */
  private reactSeq = 0;
  private side: 'L' | 'R' = 'L';

  constructor(
    readonly face: LiveFace,
    private readonly options: DirectorOptions,
  ) {
    this.rate = options.secondsPerChar ?? 0.18;
    this.stats = { judged: 0, missed: 0, lastLead: null, meanLead: null, meanFirstDelay: null, meanLatency: null, secondsPerChar: this.rate };
  }

  // ── AI 발화 ──────────────────────────────────────────────

  /** AI 응답이 만들어지기 시작했다. */
  assistantStarted(): void {
    this.response = {
      id: this.nextId++,
      splitter: new ClauseSplitter(),
      clauses: [],
      audioStart: null,
      cursor: 0,
      pauses: 0,
      cancelled: false,
      raw: '',
      primeAsked: false,
      prime: null,
      shown: false,
    };
  }

  /** AI 응답의 텍스트 조각이 도착했다. */
  assistantText(delta: string): void {
    if (!this.response) this.assistantStarted();
    const response = this.response as ResponseState;
    for (const clause of response.splitter.push(delta)) this.addClause(response, clause);
    response.raw += delta;
    // 첫 절이 아직 완성되지 않았으면 앞머리만으로 먼저 판단해 둔다
    if (!response.primeAsked && response.clauses.length === 0 && charCount(response.raw) >= PRIME_CHARS) {
      response.primeAsked = true;
      void this.options
        .judge({ speaker: 'assistant', context: this.contextLines(true).join('\n'), current: response.raw.trim() })
        .then((judgment) => {
          response.prime = judgment;
          this.tryPrime(response);
        })
        .catch(() => undefined);
    }
  }

  /** AI 응답의 텍스트가 끝났다. */
  assistantTextDone(): void {
    const response = this.response;
    if (!response) return;
    for (const clause of response.splitter.flush()) this.addClause(response, clause);
  }

  /** AI 음성이 실제로 재생되기 시작했다. */
  assistantAudioStarted(): void {
    const now = this.options.clock();
    if (!this.response) this.assistantStarted();
    const response = this.response as ResponseState;
    response.audioStart = now;
    this.face.turn = 'speaking';
    // 말을 시작할 때 눈썹이 살짝 올라간다
    this.face.addGesture({ type: 'flash', t: now, dur: 0.4, amp: 0.3 });
    // 듣는 반응은 말을 시작하고 조금 뒤에 거둔다. 그 전에 첫 절의 표정이 걸리면 그쪽이 우선한다.
    // 이렇게 하면 첫 절의 판단이 소리보다 늦어도 얼굴이 무표정으로 돌아갔다 오지 않는다.
    this.face.endBy(now + REACT_BRIDGE, 'react');
    for (const pending of response.clauses) this.trySchedule(response, pending);
    this.tryPrime(response);
  }

  /** AI 음성 재생이 끝났다. */
  assistantAudioStopped(): void {
    const now = this.options.clock();
    const response = this.response;
    if (this.face.turn === 'speaking') this.face.turn = 'idle';
    if (!response || response.audioStart === null || response.cancelled) return;
    // 실제 재생 시간으로 말 빠르기 추정을 고친다
    const chars = response.clauses.reduce((n, p) => n + p.clause.chars, 0);
    const spoken = now - response.audioStart - response.pauses;
    if (chars >= 8 && spoken > 0.5) {
      const measured = Math.min(0.4, Math.max(0.08, spoken / chars));
      this.rate = this.rate * 0.5 + measured * 0.5;
      this.stats.secondsPerChar = this.rate;
      this.options.onStats?.(this.stats);
    }
    this.rememberAssistant(response.clauses);
    this.response = null;
  }

  /** 사용자가 끼어들어 AI 음성이 끊겼다. */
  assistantInterrupted(): void {
    const now = this.options.clock();
    const response = this.response;
    if (response) {
      response.cancelled = true;
      const elapsed = response.audioStart === null ? 0 : now - response.audioStart;
      this.rememberAssistant(response.clauses.filter((p) => p.start < elapsed));
    }
    this.response = null;
    this.face.cancel(now, 'speak');
    if (this.face.turn === 'speaking') this.face.turn = 'listening';
  }

  // ── 사용자 발화 ──────────────────────────────────────────

  userSpeechStarted(): void {
    this.face.turn = 'listening';
    this.userTalking = true;
    this.liveUser = '';
    this.liveJudgedChars = 0;
  }

  userSpeechStopped(): void {
    if (this.face.turn === 'listening') this.face.turn = 'thinking';
    // 전사가 늦게 와도 대화 순서가 뒤바뀌지 않게 자리를 잡아 둔다. 도중에 들린 말이 있으면 우선 그것을 넣는다.
    const slot = { who: 'user' as const, text: this.liveUser };
    this.openSlots.push(slot);
    this.history.push(slot);
    this.userTalking = false;
    this.liveUser = '';
    this.trimHistory();
  }

  /**
   * 사용자가 말하는 도중의 전사. text 는 이번 발화에서 지금까지 들린 전체다(말이 끝나면 바깥에서 비운다).
   * 일정량이 새로 들릴 때마다 듣는 반응을 다시 판단한다. 판단은 한 번에 하나만 보낸다.
   */
  userPartial(text: string): void {
    this.liveUser = text.trim();
    if (this.options.reactToUser === false || this.liveBusy) return;
    if (charCount(this.liveUser) - this.liveJudgedChars < PARTIAL_STEP) return;
    this.liveJudgedChars = charCount(this.liveUser);
    this.liveBusy = true;
    this.judgeUser(this.liveUser, this.contextLines(false)).finally(() => {
      this.liveBusy = false;
    });
  }

  /** 사용자 말의 최종 전사가 도착했다. 대화 기록을 확정하고 듣는 반응을 건다. */
  userTranscript(text: string): void {
    const current = text.trim();
    if (!current) return;
    const slot = this.openSlots.shift();
    // 이 말 자체는 판단 대상이므로 맥락에서는 뺀다
    if (slot) slot.text = '';
    const context = this.contextLines(false);
    if (slot) slot.text = current;
    else this.history.push({ who: 'user', text: current });
    this.trimHistory();
    if (this.options.reactToUser === false) return;
    void this.judgeUser(current, context);
  }

  /** 사용자 말에 대한 듣는 반응을 판단해 건다. 더 새로운 판단이 있으면 버린다. */
  private judgeUser(text: string, history: string[]): Promise<void> {
    // 말이 길면 끝부분만 판단하고 앞부분은 맥락으로 넘긴다
    let head = '';
    let current = text;
    if (text.length > USER_WINDOW) {
      const cut = text.indexOf(' ', text.length - USER_WINDOW);
      const at = cut < 0 ? text.length - USER_WINDOW : cut + 1;
      head = text.slice(0, at).trim();
      current = text.slice(at).trim();
    }
    const context = [...history, ...(head ? [`user: ${clip(head)}`] : [])].join('\n');
    const seq = ++this.reactSeq;
    return this.options
      .judge({ speaker: 'user', context, current })
      .then((judgment) => {
        // 더 새로운 말이 있거나 AI 가 이미 말을 시작했으면 버린다
        if (seq !== this.reactSeq || this.face.turn === 'speaking') return;
        const now = this.options.clock();
        this.face.cancel(now, 'react');
        this.face.schedule({
          t: now,
          until: now + REACT_MAX,
          weights: targetWeights(judgment, this.nextSide(), REACT_SCALE),
          kind: 'react',
          text: current,
          judgment,
        });
        if (now - this.lastNod >= NOD_GAP && this.addHeadGestures(judgment, now + 0.1)) this.lastNod = now;
      })
      .catch(() => undefined);
  }

  // ── 내부 ────────────────────────────────────────────────

  private addClause(response: ResponseState, clause: Clause): void {
    const start = response.cursor;
    const end = start + clause.chars * this.rate;
    const pause = pauseAfter(clause.text);
    response.cursor = end + pause;
    response.pauses += pause;
    const pending: PendingClause = { clause, start, end, judgment: null, arrived: 0, scheduled: false };
    response.clauses.push(pending);

    const said = response.clauses.slice(0, -1).slice(-CONTEXT_CLAUSES).map((p) => `assistant: ${p.clause.text}`);
    const context = [...this.contextLines(true), ...said].join('\n');
    const asked = this.options.clock();
    void this.options
      .judge({ speaker: 'assistant', context, current: clause.text })
      .then((judgment) => {
        const now = this.options.clock();
        pending.judgment = judgment;
        pending.arrived = now;
        this.latencies.push(now - asked);
        this.trySchedule(response, pending);
      })
      .catch(() => undefined);
  }

  /** 앞머리 판단으로 응답의 시작 표정을 건다. 첫 절의 표정이 이미 걸렸으면 하지 않는다. */
  private tryPrime(response: ResponseState): void {
    if (!response.prime || response.audioStart === null || response.cancelled || response.shown) return;
    const now = this.options.clock();
    const t = Math.max(now, response.audioStart);
    this.markShown(response, t);
    this.face.schedule({
      t,
      until: t + PRIME_HOLD,
      weights: targetWeights(response.prime, this.nextSide()),
      kind: 'speak',
      text: `${response.raw.trim().slice(0, 24)}…`,
      judgment: response.prime,
    });
  }

  /** 이 응답에서 표정이 처음 걸린 시각을 기록한다 */
  private markShown(response: ResponseState, t: number): void {
    if (response.shown || response.audioStart === null) return;
    response.shown = true;
    this.firstDelays.push(Math.max(0, t - response.audioStart));
    this.stats.meanFirstDelay = mean(this.firstDelays);
  }

  /** 판단과 소리 시작 시각이 둘 다 있으면 표정을 예약한다. */
  private trySchedule(response: ResponseState, pending: PendingClause): void {
    if (pending.scheduled || !pending.judgment || response.audioStart === null || response.cancelled) return;
    pending.scheduled = true;
    const now = this.options.clock();
    const start = response.audioStart + pending.start;
    const end = response.audioStart + pending.end;

    // 판단이 소리보다 얼마나 먼저 준비됐는가
    const lead = start - Math.max(pending.arrived, response.audioStart);
    this.leads.push(lead);
    this.stats.judged += 1;
    this.stats.lastLead = lead;
    this.stats.meanLead = mean(this.leads);
    this.stats.meanLatency = mean(this.latencies);
    if (pending === response.clauses[0]) this.markShown(response, Math.max(now, start));

    if (now >= end) {
      // 그 절의 소리가 이미 지나갔다
      this.stats.missed += 1;
    } else {
      const t = Math.max(now, start);
      this.face.schedule({
        t,
        until: end + HOLD_AFTER,
        weights: targetWeights(pending.judgment, this.nextSide()),
        kind: 'speak',
        text: pending.clause.text,
        judgment: pending.judgment,
      });
      this.addHeadGestures(pending.judgment, t + 0.15);
    }
    this.options.onStats?.(this.stats);
  }

  private addHeadGestures(judgment: Judgment, t: number): boolean {
    const amp = amplitude(judgment.intensity);
    const nod = actionWeight(judgment.regions.head?.nod ?? 0);
    const shake = actionWeight(judgment.regions.head?.shake ?? 0);
    if (nod > 0.3) this.face.addGesture({ type: 'nod', t, dur: 0.5, amp: 0.09 * nod * amp });
    if (shake > 0.3) this.face.addGesture({ type: 'shake', t, dur: 0.9, amp: 0.1 * shake * amp });
    return nod > 0.3 || shake > 0.3;
  }

  /** 좌우가 있는 동작의 방향. 왼쪽이 더 자주 나온다. */
  private nextSide(): 'L' | 'R' {
    this.side = Math.random() < 0.7 ? 'L' : 'R';
    return this.side;
  }

  /**
   * 판단에 참고로 넘길 지난 대화.
   * includeLive 가 참이면, 최종 전사가 아직 안 온 사용자 말도 도중에 들린 대로 넣는다.
   */
  private contextLines(includeLive: boolean): string[] {
    const lines = this.history
      .filter((h) => h.text)
      .slice(-CONTEXT_TURNS)
      .map((h) => `${h.who}: ${clip(h.text)}`);
    if (includeLive && this.userTalking && this.liveUser) lines.push(`user: ${clip(this.liveUser)}`);
    return lines;
  }

  private rememberAssistant(clauses: PendingClause[]): void {
    const line = clauses.map((p) => p.clause.text).join(' ');
    if (!line) return;
    this.history.push({ who: 'assistant', text: line });
    this.trimHistory();
  }

  private trimHistory(): void {
    while (this.history.length > 12) this.history.shift();
  }
}

/** 너무 긴 대사는 뒤쪽만 남긴다 */
const clip = (text: string): string => (text.length > CONTEXT_LINE_MAX ? `…${text.slice(-CONTEXT_LINE_MAX)}` : text);

const mean = (values: number[]): number | null => {
  const recent = values.slice(-30);
  return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
};

export { charCount };
