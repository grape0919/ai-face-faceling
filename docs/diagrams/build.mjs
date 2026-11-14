// README 용 다이어그램을 한국어·영어 SVG 로 만든다.
// 실행: node docs/diagrams/build.mjs  →  docs/images/<이름>.<ko|en>.svg
// 그림을 고칠 때는 이 파일만 고치고 다시 실행한다. 두 언어가 같은 배치를 쓴다.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'images');

/** 색: 밝은 화면 / 어두운 화면 */
const RAMPS = {
  purple: { fill: ['#EEEDFE', '#3C3489'], stroke: ['#534AB7', '#AFA9EC'], title: ['#3C3489', '#CECBF6'], sub: ['#534AB7', '#AFA9EC'] },
  teal: { fill: ['#E1F5EE', '#085041'], stroke: ['#0F6E56', '#5DCAA5'], title: ['#085041', '#9FE1CB'], sub: ['#0F6E56', '#5DCAA5'] },
  gray: { fill: ['#F1EFE8', '#444441'], stroke: ['#5F5E5A', '#B4B2A9'], title: ['#444441', '#D3D1C7'], sub: ['#5F5E5A', '#B4B2A9'] },
};

const style = () => {
  const rule = (i) =>
    Object.entries(RAMPS)
      .map(
        ([name, r]) =>
          `.${name} rect{fill:${r.fill[i]};stroke:${r.stroke[i]}}.${name} .ti{fill:${r.title[i]}}.${name} .su{fill:${r.sub[i]}}`,
      )
      .join('') +
    `.ln{stroke:${['#73726c', '#9c9a92'][i]}}.tx{fill:${['#2C2C2A', '#D3D1C7'][i]}}.mu{fill:${['#5F5E5A', '#B4B2A9'][i]}}.ct{stroke:${['#B4B2A9', '#5F5E5A'][i]}}`;
  return (
    `<style>` +
    `text{font-family:-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif}` +
    `.ti{font-size:14px;font-weight:600}.su,.sm{font-size:12px}.big{font-size:14px;font-weight:600}` +
    `rect{stroke-width:0.6}.ln{fill:none;stroke-width:1.3}.dash{stroke-dasharray:4 3;stroke-width:0.9}` +
    rule(0) +
    `@media (prefers-color-scheme:dark){${rule(1)}}` +
    `</style>`
  );
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 제목과 부제가 있는 상자. 부제가 없으면 한 줄짜리. */
function box({ x, y, w, h = 56, ramp, title, sub }) {
  const cx = x + w / 2;
  const t = sub
    ? `<text class="ti" x="${cx}" y="${y + h / 2 - 9}" text-anchor="middle" dominant-baseline="central">${esc(title)}</text>` +
      `<text class="su" x="${cx}" y="${y + h / 2 + 10}" text-anchor="middle" dominant-baseline="central">${esc(sub)}</text>`
    : `<text class="ti" x="${cx}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central">${esc(title)}</text>`;
  return `<g class="${ramp}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>${t}</g>`;
}

/** 왼쪽 정렬 제목과 설명이 한 줄에 있는 얇은 띠 */
function slab({ x, y, w, h = 34, ramp, title, sub, subX }) {
  const cy = y + h / 2;
  return (
    `<g class="${ramp}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>` +
    `<text class="ti" x="${x + 20}" y="${cy}" dominant-baseline="central">${esc(title)}</text>` +
    `<text class="su" x="${subX}" y="${cy}" dominant-baseline="central">${esc(sub)}</text></g>`
  );
}

const arrow = (d, { both = false, dashed = false } = {}) =>
  `<path class="ln${dashed ? ' dash' : ''}" d="${d}" marker-end="url(#a)"${both ? ' marker-start="url(#a)"' : ''}/>`;
const text = (x, y, s, { cls = 'sm mu', anchor = 'start' } = {}) =>
  `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central">${esc(s)}</text>`;
const container = (x, y, w, h) =>
  `<rect class="ct" x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="none" stroke-dasharray="6 4"/>`;

function svg(height, title, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 ${height}" width="680" height="${height}" role="img">` +
    `<title>${esc(title)}</title>${style()}` +
    `<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>` +
    body.join('') +
    `</svg>\n`
  );
}

// ── 그림 1: 전체 구조 ───────────────────────────────────────
const architecture = (L) =>
  svg(520, L.title, [
    box({ x: 40, y: 40, w: 180, ramp: 'purple', title: 'OpenAI Realtime', sub: L.realtime }),
    box({ x: 250, y: 40, w: 180, ramp: 'purple', title: L.transcribeTitle, sub: L.transcribe }),
    box({ x: 460, y: 40, w: 180, ramp: 'purple', title: 'Jev', sub: L.jev }),
    box({ x: 460, y: 140, w: 180, ramp: 'teal', title: L.serverTitle, sub: L.server }),
    arrow('M550 140 L550 99', { both: true }),
    arrow('M460 168 L340 168 L340 99', { dashed: true }),
    arrow('M340 168 L180 168 L180 99', { dashed: true }),
    text(400, 156, L.key, { anchor: 'middle' }),
    container(40, 230, 600, 230),
    text(620, 256, L.browser, { cls: 'big tx', anchor: 'end' }),
    box({ x: 60, y: 290, w: 170, ramp: 'teal', title: L.adapterTitle, sub: L.adapter }),
    box({ x: 255, y: 290, w: 170, ramp: 'teal', title: L.engineTitle, sub: L.engine }),
    box({ x: 450, y: 290, w: 170, ramp: 'teal', title: L.faceTitle, sub: L.face }),
    arrow('M230 318 L252 318'),
    arrow('M425 318 L447 318'),
    arrow('M110 290 L110 99', { both: true }),
    text(118, 204, 'WebRTC'),
    arrow('M200 290 L200 212 L300 212 L300 99'),
    arrow('M380 290 L380 216 L550 216 L550 199', { both: true }),
    box({ x: 60, y: 380, w: 170, ramp: 'gray', title: L.micTitle, sub: L.mic }),
    box({ x: 255, y: 380, w: 170, ramp: 'gray', title: L.speakerTitle, sub: L.speaker }),
    arrow('M145 380 L145 349'),
    arrow('M205 346 L205 362 L300 362 L300 377'),
    arrow('M425 408 L535 408 L535 349'),
    `<g class="purple"><rect x="60" y="484" width="14" height="14" rx="3"/></g>`,
    text(82, 491, L.legendExternal),
    `<g class="teal"><rect x="${L.legendCodeX}" y="484" width="14" height="14" rx="3"/></g>`,
    text(L.legendCodeX + 22, 491, L.legendCode),
    `<path class="ln dash" d="M${L.legendKeyX} 491 L${L.legendKeyX + 40} 491"/>`,
    text(L.legendKeyX + 48, 491, L.legendKey),
  ]);

// ── 그림 2: 표정 판단 ───────────────────────────────────────
const judgment = (L) =>
  svg(630, L.title, [
    box({ x: 60, y: 40, w: 240, ramp: 'gray', title: L.aiIn, sub: L.aiInSub }),
    box({ x: 380, y: 40, w: 240, ramp: 'gray', title: L.userIn, sub: L.userInSub }),
    box({ x: 60, y: 136, w: 240, ramp: 'teal', title: L.split, sub: L.splitSub }),
    box({ x: 380, y: 136, w: 240, ramp: 'teal', title: L.partial, sub: L.partialSub }),
    box({ x: 60, y: 232, w: 240, ramp: 'teal', title: L.wait, sub: L.waitSub }),
    arrow('M180 96 L180 133'),
    arrow('M500 96 L500 133'),
    arrow('M180 192 L180 229'),
    arrow('M180 288 L180 337'),
    arrow('M500 192 L500 337'),
    box({ x: 140, y: 340, w: 400, ramp: 'purple', title: L.ask, sub: L.askSub }),
    arrow('M340 396 L340 433'),
    box({ x: 140, y: 436, w: 400, ramp: 'purple', title: L.probs, sub: L.probsSub }),
    arrow('M340 492 L340 529'),
    box({ x: 140, y: 532, w: 400, ramp: 'teal', title: L.weights, sub: L.weightsSub }),
  ]);

// ── 그림 3: 시각 맞추기와 합성 ───────────────────────────────
const timing = (L) =>
  svg(630, L.title, [
    box({ x: 140, y: 40, w: 400, ramp: 'teal', title: L.estimate, sub: L.estimateSub }),
    arrow('M340 96 L340 120 L150 120 L150 147'),
    arrow('M340 96 L340 147'),
    arrow('M340 120 L530 120 L530 147'),
    box({ x: 60, y: 150, w: 180, ramp: 'teal', title: L.early, sub: L.earlySub }),
    box({ x: 250, y: 150, w: 180, ramp: 'teal', title: L.mid, sub: L.midSub }),
    box({ x: 440, y: 150, w: 180, ramp: 'gray', title: L.late, sub: L.lateSub }),
    arrow('M150 206 L150 228 L340 228 L340 247'),
    arrow('M340 206 L340 247'),
    container(60, 250, 560, 262),
    text(80, 274, L.layers, { cls: 'big tx' }),
    ...L.slabs.map(([title, sub], i) =>
      slab({ x: 80, y: 296 + i * 42, w: 520, ramp: 'teal', title, sub, subX: L.slabSubX }),
    ),
    arrow('M340 512 L340 549'),
    box({ x: 190, y: 552, w: 300, ramp: 'purple', title: L.out, sub: L.outSub }),
  ]);

const KO = {
  architecture: {
    title: 'Faceling 전체 구조',
    realtime: '음성 대화 상대',
    transcribeTitle: 'OpenAI 전사',
    transcribe: '말하는 도중의 글자',
    jev: '부위별 동작 판단',
    serverTitle: '로컬 서버',
    server: '키 보관, Jev 중계',
    key: '임시 키',
    browser: '브라우저',
    adapterTitle: '어댑터',
    adapter: '대화 사건 → 엔진',
    engineTitle: '표정 엔진',
    engine: '절 분할, 시각 예약',
    faceTitle: '얼굴',
    face: 'ARKit 52 → 로봇·강아지',
    micTitle: '마이크',
    mic: '사용자 음성',
    speakerTitle: '스피커',
    speaker: 'AI 음성, 입 모양 분석',
    legendExternal: '외부 서비스',
    legendCode: '이 저장소의 코드',
    legendCodeX: 180,
    legendKey: '임시 키 발급(실제 키는 서버에만)',
    legendKeyX: 330,
  },
  judgment: {
    title: '표정 판단 흐름',
    aiIn: 'AI 응답의 글 조각',
    aiInSub: '말하는 표정을 만든다',
    userIn: '사용자 말의 글자',
    userInSub: '듣는 반응을 만든다',
    split: '절로 끊기',
    splitSub: '문장 끝, 쉼표, 40자',
    partial: '들리는 대로 다시 판단',
    partialSub: '10글자 늘 때마다, 한 번에 하나',
    wait: '짧은 절은 뒷말 대기',
    waitSub: '4자 이하면 뒷말 12자까지',
    ask: 'Jev 에 묻기 (요청 하나에 질문 7개)',
    askSub: '앞 대화 4줄 · 앞 절 2개 · 지금 절 · 뒷말',
    probs: '부위 6곳의 선택지 확률 + 표정 세기',
    probsSub: '눈썹 · 눈 · 시선 · 볼코 · 입 · 머리',
    weights: '동작 세기로 바꾸기',
    weightsSub: '20% 이하 버림 · 70% 이상 온전히 · 세기를 곱함',
  },
  timing: {
    title: '표정 시각 맞추기와 레이어 합성',
    estimate: '그 절이 소리로 나올 시각 추정',
    estimateSub: '재생 시작 + 앞 글자 수 × 글자당 시간 + 쉼',
    early: '판단이 먼저 옴',
    earlySub: '소리 시각에 건다',
    mid: '소리 도중에 옴',
    midSub: '도착 즉시 건다',
    late: '이미 지나감',
    lateSub: '버린다',
    layers: '매 프레임 레이어 합성',
    slabSubX: 240,
    slabs: [
      ['부위별 동작', 'Jev 의 선택. 눈썹은 빠르게, 입꼬리는 천천히'],
      ['턴 상태', '듣는 중 · 생각 중 · 말하는 중의 기본 자세'],
      ['순간 동작', '끄덕임, 가로젓기, 말 시작할 때 눈썹 들썩'],
      ['립싱크', '말하는 동안 입은 소리가 우선'],
      ['깜빡임', '2.5~5.5초 간격, 미세한 머리 흔들림'],
    ],
    out: 'ARKit 52 값',
    outSub: '로봇 · 강아지 · VRM 이 그린다',
  },
};

const EN = {
  architecture: {
    title: 'Faceling architecture',
    realtime: 'Voice conversation',
    transcribeTitle: 'OpenAI transcription',
    transcribe: 'Words mid-speech',
    jev: 'Picks per-part actions',
    serverTitle: 'Local server',
    server: 'Holds keys, relays Jev',
    key: 'Ephemeral key',
    browser: 'Browser',
    adapterTitle: 'Adapter',
    adapter: 'Call events → engine',
    engineTitle: 'Expression engine',
    engine: 'Clauses and timing',
    faceTitle: 'Face',
    face: 'ARKit 52 → robot, dog',
    micTitle: 'Microphone',
    mic: "User's voice",
    speakerTitle: 'Speaker',
    speaker: 'AI voice, mouth shape',
    legendExternal: 'External service',
    legendCode: 'Code in this repo',
    legendCodeX: 200,
    legendKey: 'Ephemeral key (real keys stay on server)',
    legendKeyX: 350,
  },
  judgment: {
    title: 'How an expression is judged',
    aiIn: 'AI reply text chunks',
    aiInSub: 'Drives the speaking face',
    userIn: 'User speech text',
    userInSub: 'Drives the listening face',
    split: 'Split into clauses',
    splitSub: 'Sentence end, comma, 40 chars',
    partial: 'Re-judge as words arrive',
    partialSub: 'Every 10 new chars, one at a time',
    wait: 'Short clauses wait',
    waitSub: '4 chars or less: wait for 12 more',
    ask: 'Ask Jev (7 questions per request)',
    askSub: 'Last 4 lines · 2 prior clauses · clause · what follows',
    probs: 'Probabilities for 6 face parts + intensity',
    probsSub: 'Brows · eyes · gaze · cheeks · mouth · head',
    weights: 'Turn into action weights',
    weightsSub: 'Drop at 20% or less · full at 70% or more · × intensity',
  },
  timing: {
    title: 'Timing and layer compositing',
    estimate: 'Estimate when the clause is heard',
    estimateSub: 'Playback start + chars before × time per char + pauses',
    early: 'Judgment is early',
    earlySub: 'Apply at the sound',
    mid: 'Arrives mid-clause',
    midSub: 'Apply right away',
    late: 'Already passed',
    lateSub: 'Drop it',
    layers: 'Layer compositing, every frame',
    slabSubX: 230,
    slabs: [
      ['Part actions', "Jev's picks. Brows fast, mouth corners slow"],
      ['Turn state', 'Base pose: listening, thinking, speaking'],
      ['Gestures', 'Nods, head shakes, brow flash when speaking'],
      ['Lip sync', 'While speaking, the mouth follows the sound'],
      ['Blinks', 'Every 2.5–5.5 s, plus subtle head sway'],
    ],
    out: 'ARKit 52 values',
    outSub: 'Drawn by the robot, dog or a VRM',
  },
};

await mkdir(OUT, { recursive: true });
for (const [lang, L] of [
  ['ko', KO],
  ['en', EN],
]) {
  await writeFile(path.join(OUT, `architecture.${lang}.svg`), architecture(L.architecture));
  await writeFile(path.join(OUT, `judgment.${lang}.svg`), judgment(L.judgment));
  await writeFile(path.join(OUT, `timing.${lang}.svg`), timing(L.timing));
}
console.log(`다이어그램 6개를 만들었습니다: ${path.relative(process.cwd(), OUT)}`);
