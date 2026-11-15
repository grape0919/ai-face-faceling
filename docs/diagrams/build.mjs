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

// ── 그림 4: 엔진 하나, 몸은 무엇이든 ─────────────────────────
const bodies = (L) =>
  svg(600, L.title, [
    box({ x: 140, y: 40, w: 400, ramp: 'teal', title: L.spec, sub: L.specSub }),
    arrow('M250 96 L250 120 L190 120 L190 143'),
    arrow('M430 96 L430 120 L490 120 L490 143'),
    box({ x: 60, y: 146, w: 260, ramp: 'teal', title: L.questions, sub: L.questionsSub }),
    box({ x: 360, y: 146, w: 260, ramp: 'teal', title: L.persona, sub: L.personaSub }),
    arrow('M190 202 L190 239'),
    arrow('M490 202 L490 239'),
    box({ x: 60, y: 242, w: 260, ramp: 'purple', title: 'Jev', sub: L.jev }),
    box({ x: 360, y: 242, w: 260, ramp: 'purple', title: L.voice, sub: L.voiceSub }),
    arrow('M360 270 L323 270'),
    text(340, 258, L.reply, { anchor: 'middle' }),
    arrow('M190 298 L190 320 L340 320 L340 341'),
    box({ x: 140, y: 344, w: 400, ramp: 'teal', title: L.frame, sub: L.frameSub }),
    arrow('M340 400 L340 424 L150 424 L150 445'),
    arrow('M340 400 L340 445'),
    arrow('M340 424 L530 424 L530 445'),
    box({ x: 60, y: 448, w: 180, ramp: 'teal', title: L.face, sub: L.faceSub }),
    box({ x: 250, y: 448, w: 180, ramp: 'teal', title: L.dog, sub: L.dogSub }),
    box({ x: 440, y: 448, w: 180, ramp: 'teal', title: L.arm, sub: L.armSub }),
    container(40, 530, 600, 46),
    text(340, 553, L.note, { cls: 'sm tx', anchor: 'middle' }),
  ]);

// ── 그림 5: 부위별 수치 판단 ─────────────────────────────────
const channels = (L) =>
  svg(700, L.title, [
    box({ x: 140, y: 40, w: 400, ramp: 'teal', title: L.list, sub: L.listSub }),
    arrow('M340 96 L340 133'),
    container(60, 136, 560, 122),
    text(80, 160, L.ask, { cls: 'big tx' }),
    box({ x: 80, y: 182, w: 250, ramp: 'purple', title: L.amount, sub: L.amountSub }),
    box({ x: 350, y: 182, w: 250, ramp: 'purple', title: L.duration, sub: L.durationSub }),
    arrow('M340 258 L340 285'),
    box({ x: 140, y: 288, w: 400, ramp: 'teal', title: L.settle, sub: L.settleSub }),
    arrow('M340 344 L340 371'),
    container(60, 374, 560, 220),
    text(80, 398, L.play, { cls: 'big tx' }),
    ...L.slabs.map(([title, sub], i) => slab({ x: 80, y: 420 + i * 34, w: 520, h: 28, ramp: 'teal', title, sub, subX: L.slabSubX })),
    arrow('M340 594 L340 621'),
    box({ x: 140, y: 624, w: 400, ramp: 'teal', title: L.out, sub: L.outSub }),
  ]);

const KO = {
  bodies: {
    title: '엔진 하나, 몸은 무엇이든',
    spec: '몸 명세 (리그가 선언)',
    specSub: '이름 · 설명 · 할 수 있는 움직임 · 부위 목록',
    questions: '판단 질문',
    questionsSub: '명세로 만든다. 엔진은 몸을 모른다',
    persona: 'AI 에게 알려 주는 몸',
    personaSub: '"너는 이런 몸이다" (서버 → 대화 AI)',
    jev: '몸과 상관없는 이름으로 답한다',
    voice: '대화 AI',
    voiceSub: '"네, 오른쪽으로 쭉!"',
    reply: '대사',
    frame: '표현 프레임',
    frameSub: '감정 · move.right · 부위별 수치',
    face: '얼굴 리그',
    faceSub: 'ARKit 52, 고개 돌리기',
    dog: '강아지 리그',
    dogSub: '얼굴 + 귀',
    arm: '로봇팔 리그',
    armSub: '관절 · 집게 · 불빛',
    note: '새 몸 = 명세 하나 + 리그 하나. 엔진과 서버, 화면 코드는 그대로다.',
  },
  channels: {
    title: '부위별 수치 판단',
    list: '몸이 적어 둔 부위',
    listSub: '귀 올림 · 왼쪽 눈 감김 · 고개 오른쪽 · … (한 줄씩)',
    ask: 'Jev 에 부위마다 두 가지를 묻는다',
    amount: '얼마나',
    amountSub: '점수 0~1',
    duration: '얼마 동안',
    durationSub: '다섯 가지 가운데 하나',
    settle: '값 정리',
    settleSub: '반대 부위는 빼기 · 바닥 아래 버림 · 다시 펴기',
    play: '유지 시간대로 재생',
    slabSubX: 200,
    slabs: [
      ['순간', '한 번 하고 끝. 윙크, 끄덕임'],
      ['잠깐', '1~2초'],
      ['말하는 동안', '그 말이 끝나면 사라진다. 감정 표현'],
      ['머무름', '말이 끝난 뒤에도 몇 초 남는 자세'],
      ['시킬 때까지', '반대 자세나 "이제 그만"이 올 때까지'],
    ],
    out: '프레임의 부위별 값',
    outSub: '그 부위를 가진 리그가 읽어 움직인다',
  },
  architecture: {
    title: 'Faceling 전체 구조',
    realtime: '음성 대화 상대',
    transcribeTitle: 'OpenAI 전사',
    transcribe: '말하는 도중의 글자',
    jev: '부위별 판단',
    serverTitle: '로컬 서버',
    server: '키 보관, Jev 중계',
    key: '임시 키',
    browser: '브라우저',
    adapterTitle: '어댑터',
    adapter: '대화 사건 → 엔진',
    engineTitle: '표정 엔진',
    engine: '절 분할, 시각 예약, 프레임',
    faceTitle: '몸 (리그)',
    face: '얼굴 · 강아지 · 로봇팔',
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
    ask: 'Jev 에 묻기 (절마다 요청 하나)',
    askSub: '앞 대화 4줄 · 앞 절 2개 · 지금 절 · 뒷말',
    probs: '부위별 선택지 확률 + 표정 세기',
    probsSub: '눈썹 · 눈 · 시선 · 볼코 · 입 · 머리 · 움직임',
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
    out: '표현 프레임',
    outSub: '얼굴: ARKit 52 · 로봇팔: 관절 각도',
  },
};

const EN = {
  bodies: {
    title: 'One engine, any body',
    spec: 'Body spec (declared by the rig)',
    specSub: 'Name · description · moves · list of parts',
    questions: 'Judgment questions',
    questionsSub: 'Built from the spec, not the body',
    persona: 'What the AI is told',
    personaSub: '"This is your body" (server → voice AI)',
    jev: 'Answers in body-neutral names',
    voice: 'Voice AI',
    voiceSub: '"Okay, all the way right!"',
    reply: 'line',
    frame: 'Expression frame',
    frameSub: 'Feelings · move.right · per-part values',
    face: 'Face rigs',
    faceSub: 'ARKit 52, head turn',
    dog: 'Dog rig',
    dogSub: 'Face + ears',
    arm: 'Robot arm rig',
    armSub: 'Joints, claw, light',
    note: 'A new body = one spec + one rig. Engine, server and app code stay as they are.',
  },
  channels: {
    title: 'Per-part values',
    list: 'Parts the body lists',
    listSub: 'Ears up · left eye closes · head right · … (one line each)',
    ask: 'Jev is asked two things per part',
    amount: 'How much',
    amountSub: 'A score, 0–1',
    duration: 'How long',
    durationSub: 'One of five',
    settle: 'Clean up',
    settleSub: 'Net opposites · drop under the floor · stretch',
    play: 'Played by its duration',
    slabSubX: 190,
    slabs: [
      ['Instant', 'Once and over. A wink, a nod'],
      ['Brief', 'A second or two'],
      ['Line', 'Fades when the line ends. A feeling'],
      ['Stay', 'A pose kept a few seconds after the line'],
      ['Until told', 'Until the opposite pose or "stop"'],
    ],
    out: 'Per-part values in the frame',
    outSub: 'The rig that owns a part reads it',
  },
  architecture: {
    title: 'Faceling architecture',
    realtime: 'Voice conversation',
    transcribeTitle: 'OpenAI transcription',
    transcribe: 'Words mid-speech',
    jev: 'Judges each part',
    serverTitle: 'Local server',
    server: 'Holds keys, relays Jev',
    key: 'Ephemeral key',
    browser: 'Browser',
    adapterTitle: 'Adapter',
    adapter: 'Call events → engine',
    engineTitle: 'Expression engine',
    engine: 'Clauses, timing, frame',
    faceTitle: 'Body (rig)',
    face: 'Face, dog, robot arm',
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
    ask: 'Ask Jev (one request per clause)',
    askSub: 'Last 4 lines · 2 prior clauses · clause · what follows',
    probs: 'Option probabilities per part + intensity',
    probsSub: 'Brows · eyes · gaze · cheeks · mouth · head · move',
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
    out: 'Expression frame',
    outSub: 'Face: ARKit 52 · arm: joint angles',
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
  await writeFile(path.join(OUT, `bodies.${lang}.svg`), bodies(L.bodies));
  await writeFile(path.join(OUT, `channels.${lang}.svg`), channels(L.channels));
}
console.log(`다이어그램 10개를 만들었습니다: ${path.relative(process.cwd(), OUT)}`);
