import { FACE_REGIONS, OPTIONAL_REGIONS, regionSpec, restProbs, type Region } from '../regions.js';
import type { BodySpec } from '../body.js';
import { channelQuestions, readChannelAnswers } from '../channels.js';
import { clamp, type Analyzer, type AnalyzerInput, type Judgment } from '../judgment.js';
import { intensityQuestion, regionCriteria, regionInstructions, toFaceState, type FaceState, type Role } from '../questions.js';

/**
 * 질문 세트로 판단하는 분석기의 공통 부분. 무엇을 묻고 답을 어떻게 판단으로 옮기는지는 여기서 정하고,
 * 누구에게 묻는지(Jev, OpenAI 모델)만 분석기마다 다르다. 그래서 어느 모델이 답하든 질문과 결과의 모양이 같다.
 */

/** 점수 질문: 단계 설명을 낮은 것부터 늘어놓는다. 답은 0 ~ (단계 수 - 1). */
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}
/** 선택 질문: 선택지 이름 → 설명. 답은 선택지별 확률. */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export type Question = ScoreQuestion | ChoiceQuestion;
export type Questions = Record<string, Question>;

/** 질문 하나의 답. Jev 의 응답 모양을 그대로 따른다. */
export interface Answer {
  type?: string;
  score?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
export type Answers = Record<string, Answer | undefined>;

/**
 * 질문 세트 하나를 묻는 함수. setKey 는 질문 세트의 이름이다(역할·몸·방식이 같으면 같다).
 * 같은 setKey 로는 늘 같은 questions 가 오므로, 묻는 쪽이 준비한 것을 이 이름으로 넣어 둘 수 있다.
 */
export type Ask = (state: FaceState, questions: Questions, setKey: string) => Promise<Answers>;

export function createQuestionAnalyzer(name: string, version: string, ask: Ask): Analyzer {
  // 말하는 구간과 듣는 구간은 질문 세트가 따로다. 듣는 구간에서 빠진 선택지는 아래에서 확률 0 으로 채운다.
  // 몸 명세가 있으면 AI 가 말하는 구간에서 그 몸의 움직임을 함께 묻고, 선택지 설명도 그 몸에 맞춘다.
  // 질문 세트는 역할과 몸의 조합마다 한 번 만들어 둔다(같은 이름의 명세는 내용이 같다고 본다).
  const sets = new Map<string, { questions: Questions; asked: Region[] }>();
  const questionsFor = (role: Role, body?: BodySpec): { key: string; questions: Questions; asked: Region[] } => {
    const speaking = role === 'speaking' ? body : undefined;
    const key = `${role}:${speaking?.name ?? ''}`;
    let set = sets.get(key);
    if (!set) {
      const extra = speaking && Object.keys(speaking.moves).length > 0 ? OPTIONAL_REGIONS : [];
      const asked = [...FACE_REGIONS, ...extra];
      const questions: Questions = { intensity: { type: 'score', ...intensityQuestion(role) } };
      for (const region of asked) {
        questions[region] = {
          type: 'choice',
          instructions: regionInstructions(region, role, speaking),
          criteria: regionCriteria(region, role, speaking),
        };
      }
      set = { questions, asked };
      sets.set(key, set);
    }
    return { key, ...set };
  };

  const channelSets = new Map<string, Questions>();

  return {
    name,
    version,
    async analyze(input: AnalyzerInput): Promise<Judgment> {
      const state = toFaceState(input);
      // 부위별 수치 판단: 그 몸의 채널마다 세기와 유지 시간을 묻는다
      if (input.mode === 'channels' && input.body?.channels?.length) {
        const body = input.body;
        const key = `channels:${state.role}:${body.name}`;
        let channelSet = channelSets.get(key);
        if (!channelSet) channelSets.set(key, (channelSet = channelQuestions(body, state.role) as Questions));
        const answers = await ask(state, channelSet, key);
        return { intensity: 0, regions: restProbs(), ...readChannelAnswers(body, state.role, answers as Record<string, Answer>) };
      }
      const { key, questions, asked } = questionsFor(state.role, input.body);
      const answers = await ask(state, questions, key);

      const intensity = answers.intensity;
      if (!intensity || intensity.type !== 'score' || typeof intensity.score !== 'number') {
        throw new Error(`${name} 응답에 intensity 답이 없습니다: ${JSON.stringify(intensity)}`);
      }

      // 묻지 않은 부위는 기본 선택지로 채운다
      const regions = restProbs();
      for (const region of asked) {
        const a = answers[region];
        if (!a || a.type !== 'choice' || !a.probabilities) {
          throw new Error(`${name} 응답에 choice 답이 없습니다: ${region} ${JSON.stringify(a)}`);
        }
        const probs: Record<string, number> = {};
        for (const action of Object.keys(regionSpec(region).actions)) probs[action] = clamp(a.probabilities[action] ?? 0);
        regions[region] = probs;
      }

      // Score 는 0~4 단계의 확률 가중 평균
      return { intensity: clamp(intensity.score / 4), regions };
    },
  };
}

/** Node 등 process 가 있는 곳에서만 환경 변수를 읽는다. 브라우저에서는 undefined. */
export const env = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name] || undefined;
