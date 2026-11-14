import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { FACE_REGIONS, regionSpec, restProbs, type Region } from '../../shared/regions';
import { clamp, type Analyzer, type AnalyzerInput, type Judgment } from '../../shared/types';
import { QUESTIONS_VERSION, SCENES, intensityQuestion, regionCriteria, toFaceState, type Role } from './questions';

const probsSchema = (names: string[]) =>
  z.object(Object.fromEntries(names.map((n) => [n, z.number().describe('probability 0-1')])));

const schemaFor = (role: Role) =>
  z.object({
    intensity: z.number().describe('0-4 scale position, decimals allowed'),
    ...Object.fromEntries(FACE_REGIONS.map((r) => [r, probsSchema(Object.keys(regionCriteria(r, role)))])),
  });

const regionBlock = (region: Region, role: Role): string =>
  `${region}: what should ${regionSpec(region).subject} do?\n` +
  Object.entries(regionCriteria(region, role))
    .map(([name, desc]) => `  - ${name}: ${desc}`)
    .join('\n');

function systemFor(role: Role): string {
  const intensity = intensityQuestion(role);
  return `${SCENES[role]}

The input is JSON with \`role\`, \`context\` and \`current\`. Decide what each part of the assistant's face should do during \`current\` and return only the structured result.

intensity (0-4): ${intensity.instructions}
${intensity.criteria.map((c, i) => `  ${i} = ${c}`).join('\n')}

For each face part below, give a probability (0-1) for every option. The probabilities of one part sum to 1. Put most of the weight on the neutral option when the line carries no clear feeling.

${FACE_REGIONS.map((r) => regionBlock(r, role)).join('\n\n')}`;
}

/**
 * 소형 LLM 대조군. Jev 와 같은 부위별 질문을 구조화 출력으로 받아 품질·지연을 나란히 비교한다.
 * 말하는 구간과 듣는 구간은 Jev 와 마찬가지로 문구와 선택지가 따로다.
 * 기본 모델은 Claude Haiku 5.5 이며 LLM_MODEL 로 바꿀 수 있다.
 */
export function createLlmAnalyzer(): Analyzer {
  const model = process.env.LLM_MODEL || 'claude-haiku-5-5';
  const client = new Anthropic();
  const prompts = {
    speaking: { system: systemFor('speaking'), format: zodOutputFormat(schemaFor('speaking')) },
    listening: { system: systemFor('listening'), format: zodOutputFormat(schemaFor('listening')) },
  };

  return {
    name: 'llm',
    version: `${model}:${QUESTIONS_VERSION}`,
    async analyze(input: AnalyzerInput): Promise<Judgment> {
      const state = toFaceState(input);
      const prompt = prompts[state.role];
      const res = await client.messages.parse({
        model,
        max_tokens: 3000,
        system: prompt.system,
        messages: [{ role: 'user', content: JSON.stringify(state) }],
        output_config: { effort: 'low', format: prompt.format },
      });
      if (res.stop_reason === 'refusal') throw new Error('LLM 이 이 구간의 판단을 거절했습니다');
      const out = res.parsed_output as (Record<string, Record<string, number>> & { intensity: number }) | null;
      if (!out) throw new Error(`LLM 응답을 해석하지 못했습니다 (stop_reason=${res.stop_reason})`);

      // 듣는 구간에서 빠진 선택지는 0 으로, 묻지 않은 부위(팔 등)는 기본 선택지로 채운다
      const regions = restProbs();
      for (const region of FACE_REGIONS) {
        const raw = out[region] ?? {};
        const names = Object.keys(regionSpec(region).actions);
        const sum = names.reduce((n, name) => n + clamp(raw[name] ?? 0), 0) || 1;
        regions[region] = Object.fromEntries(names.map((name) => [name, clamp(raw[name] ?? 0) / sum]));
      }
      return { intensity: clamp(out.intensity / 4), regions };
    },
  };
}
