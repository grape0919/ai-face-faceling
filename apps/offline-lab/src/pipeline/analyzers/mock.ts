import { onlyAction, restProbs, type Region } from '../../shared/regions';
import { type Analyzer, type AnalyzerInput, type Judgment } from '../../shared/types';

const has = (text: string, patterns: RegExp[]): boolean => patterns.some((p) => p.test(text));

const POSITIVE = [/축하/, /좋(아|은|네|겠|다)/, /기쁘|기뻐/, /다행/, /대단/, /멋지|멋진/, /잘됐|잘 됐/, /합격/, /고마|감사/, /최고/];
const NEGATIVE = [/힘들|힘드/, /슬프|슬퍼/, /속상/, /떨어졌/, /걱정/, /아프|아파/, /우울/, /실망/, /안타깝/, /망했/];
const APOLOGY = [/죄송/, /미안/, /사과드/];
const EMPATHY = [/힘드셨|힘들었겠/, /속상하셨|속상했겠/, /마음이/, /괜찮(으세요|아요|을 거)/, /고생/, /안타깝/];
const PLAYFUL = [/ㅋㅋ|ㅎㅎ/, /농담/, /장난/, /웃기/, /하하/];
const SURPRISE = [/정말요\?|진짜요\?/, /^(와|우와|헉|어머)/, /세상에/, /놀랍|놀라/, /대박/];
const UNCERTAIN = [/글쎄/, /아마/, /것 같(아|은데|습니다)/, /잘 모르/, /음\.\.\.|음…|어\.\.\.|^음,/];

type Picks = Partial<Record<Region, [action: string, p: number]>>;

/**
 * 키 없이 전체 경로를 돌려 보기 위한 규칙 기반 분석기.
 * 낱말과 문장부호만 보고 부위별 동작을 정한다. 판단 품질은 의미가 없다. 실험 결과를 내는 데 쓰지 않는다.
 */
export const mockAnalyzer: Analyzer = {
  name: 'mock',
  version: 'm2',
  async analyze({ speaker, current }: AnalyzerInput): Promise<Judgment> {
    const t = current;
    const exclaim = /!/.test(t);
    const question = /\?/.test(t);
    let picks: Picks = {};
    let intensity = 0.2;

    if (speaker === 'assistant') {
      if (has(t, APOLOGY)) {
        picks = { brows: ['inner_up', 0.9], eyes: ['soft', 0.7], gaze: ['down', 0.8], mouth: ['pressed', 0.8], head: ['lowered', 0.8] };
        intensity = 0.65;
      } else if (has(t, SURPRISE)) {
        picks = { brows: ['raised', 0.9], eyes: ['wide', 0.9], mouth: ['open', 0.7], head: ['raised', 0.5] };
        intensity = 0.8;
      } else if (has(t, EMPATHY) || has(t, NEGATIVE)) {
        picks = { brows: ['inner_up', 0.85], eyes: ['soft', 0.6], mouth: ['frown', 0.6], head: ['tilt', 0.7] };
        intensity = 0.6;
      } else if (has(t, PLAYFUL)) {
        picks = { brows: ['one_raised', 0.7], eyes: ['smiling', 0.8], cheeks: ['raised', 0.7], mouth: ['smirk', 0.8] };
        intensity = 0.65;
      } else if (has(t, POSITIVE)) {
        picks = { brows: ['raised', 0.6], eyes: ['smiling', 0.85], cheeks: ['raised', 0.8], mouth: ['grin', 0.85], head: ['nod', 0.6] };
        intensity = exclaim ? 0.85 : 0.6;
      } else if (has(t, UNCERTAIN)) {
        picks = { brows: ['one_raised', 0.6], eyes: ['narrowed', 0.5], gaze: ['aside', 0.8], mouth: ['skewed', 0.7] };
        intensity = 0.5;
      } else if (question) {
        picks = { brows: ['raised', 0.6], head: ['tilt', 0.7], mouth: ['smile', 0.4] };
        intensity = 0.45;
      } else if (exclaim) {
        picks = { brows: ['raised', 0.6], eyes: ['smiling', 0.5], mouth: ['smile', 0.7], head: ['nod', 0.7] };
        intensity = 0.55;
      }
    } else {
      // 사용자가 말하는 구간: 듣는 쪽의 반응
      if (has(t, PLAYFUL)) {
        picks = { eyes: ['smiling', 0.7], cheeks: ['raised', 0.6], mouth: ['smirk', 0.6] };
        intensity = 0.5;
      } else if (has(t, POSITIVE)) {
        picks = { brows: ['raised', 0.8], eyes: ['wide', 0.6], cheeks: ['raised', 0.6], mouth: ['grin', 0.7], head: ['nod', 0.6] };
        intensity = 0.7;
      } else if (has(t, NEGATIVE)) {
        picks = { brows: ['inner_up', 0.85], eyes: ['soft', 0.6], mouth: ['frown', 0.5], head: ['tilt', 0.6] };
        intensity = 0.6;
      } else if (question) {
        picks = { brows: ['raised', 0.5], gaze: ['up', 0.5], head: ['tilt', 0.5] };
        intensity = 0.4;
      } else {
        picks = { head: ['nod', 0.6] };
        intensity = 0.3;
      }
    }

    const regions = restProbs();
    for (const [region, pick] of Object.entries(picks) as [Region, [string, number]][]) {
      regions[region] = onlyAction(region, pick[0], pick[1]);
    }
    return { intensity, regions };
  },
};
