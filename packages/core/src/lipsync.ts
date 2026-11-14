import type { MouthFeatures } from './compositor.js';

/**
 * 재생되는 음성의 진폭과 대역 에너지로 입 모양을 추정한다.
 * 감정 분석이 아니라 "입이 얼마나, 어떤 모양으로 벌어지는가"만 본다. 지연이 없다.
 */
export class MouthAnalyser {
  private readonly timeData: Float32Array<ArrayBuffer>;
  private readonly freqData: Uint8Array<ArrayBuffer>;
  private jaw = 0;

  /** analyser 는 AI 음성만 지나가는 AnalyserNode. fftSize 는 여기서 맞춘다. */
  constructor(
    private readonly analyser: AnalyserNode,
    private readonly sampleRate: number,
  ) {
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    this.timeData = new Float32Array(analyser.fftSize);
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  /** 매 프레임 호출한다. */
  read(): MouthFeatures {
    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0;
    for (const v of this.timeData) sum += v * v;
    const rms = Math.sqrt(sum / this.timeData.length);
    const target = Math.min(1, rms * 7);
    // 열릴 때는 빠르게, 닫힐 때는 조금 느리게
    this.jaw += (target - this.jaw) * (target > this.jaw ? 0.55 : 0.3);

    this.analyser.getByteFrequencyData(this.freqData);
    const hz = this.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number): number => {
      let e = 0;
      for (let i = Math.floor(lo / hz); i < Math.min(this.freqData.length, Math.ceil(hi / hz)); i++) {
        e += this.freqData[i] ?? 0;
      }
      return e;
    };
    const low = band(100, 600);
    const mid = band(600, 2200);
    const high = band(2200, 6000);
    const total = low + mid + high + 1;
    return {
      jaw: this.jaw,
      // 낮은 대역이 우세하면 오·우 계열, 높은 대역이 우세하면 이·에 계열로 본다
      funnel: this.jaw * Math.min(1, Math.max(0, (low / total - 0.45) * 2.5)),
      stretch: this.jaw * Math.min(1, Math.max(0, (high / total - 0.2) * 3)),
    };
  }
}
