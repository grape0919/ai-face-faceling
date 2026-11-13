/**
 * 조금씩 도착하는 텍스트를 절 단위로 끊는다. 실시간 대화에서 AI 응답의 텍스트 조각을 그대로 넣으면 된다.
 * 문장 끝에서는 항상 끊고, 쉼표에서는 minChars 이상 모였을 때 끊고, maxChars 를 넘으면 낱말 경계에서 강제로 끊는다.
 * 오프라인 도구의 segmentWords 와 같은 규칙이다.
 */

export interface ClauseOptions {
  /** 쉼표에서 끊으려면 최소 이만큼은 모여 있어야 한다 (공백 제외 글자 수) */
  minChars: number;
  /** 구두점이 없어도 이 길이를 넘으면 끊는다 */
  maxChars: number;
}

export interface Clause {
  text: string;
  /** 이 절 앞까지 나온 글자 수(공백 제외). 재생 시각을 추정하는 데 쓴다. */
  charsBefore: number;
  /** 이 절의 글자 수(공백 제외) */
  chars: number;
}

export const DEFAULT_CLAUSE_OPTIONS: ClauseOptions = { minChars: 15, maxChars: 40 };

const SENTENCE_END = /[.?!…。？！]["')\]」』]*$/;
const CLAUSE_END = /[,，、;:]$/;
/** 이보다 짧은 조각은 독립 절로 두지 않는다 */
const TINY = 4;

export const charCount = (s: string): number => s.replace(/\s/g, '').length;

export class ClauseSplitter {
  private pending = '';
  private buf: string[] = [];
  private len = 0;
  private emitted = 0;

  constructor(private readonly options: ClauseOptions = DEFAULT_CLAUSE_OPTIONS) {}

  /** 텍스트 조각을 넣고, 이번에 완성된 절들을 돌려받는다. */
  push(delta: string): Clause[] {
    this.pending += delta;
    const out: Clause[] = [];
    // 마지막 낱말은 아직 이어질 수 있으므로 공백이 나올 때까지 기다린다
    const parts = this.pending.split(/\s+/);
    this.pending = parts.pop() ?? '';
    for (const word of parts) this.addWord(word, out);
    return out;
  }

  /** 응답이 끝났을 때 남은 텍스트를 마지막 절로 내보낸다. */
  flush(): Clause[] {
    const out: Clause[] = [];
    if (this.pending) this.addWord(this.pending, out);
    this.pending = '';
    this.emit(out);
    return out;
  }

  private addWord(word: string, out: Clause[]): void {
    if (!word) return;
    this.buf.push(word);
    this.len += charCount(word);
    if (SENTENCE_END.test(word)) {
      if (this.len >= TINY) this.emit(out);
    } else if (CLAUSE_END.test(word)) {
      if (this.len >= this.options.minChars) this.emit(out);
    } else if (this.len >= this.options.maxChars) {
      this.emit(out);
    }
  }

  private emit(out: Clause[]): void {
    if (this.buf.length === 0) return;
    out.push({ text: this.buf.join(' '), charsBefore: this.emitted, chars: this.len });
    this.emitted += this.len;
    this.buf = [];
    this.len = 0;
  }
}
