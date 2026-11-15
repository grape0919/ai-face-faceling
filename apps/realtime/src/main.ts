import type { AnalyzerInput, Judgment } from '@faceling/core/judgment';
import type { TurnState } from '@faceling/core/compositor';
import { LiveDirector, LiveFace, type DirectorStats, type LiveFrame } from '@faceling/core/live';
import { REGION_KEYS, regionSpec, topAction, type Region } from '@faceling/core/regions';
import type { BodySpec } from '@faceling/core/body';
import { ArmRig, DogRig, FACE_BODY, FacelingRig, RobotRig, VrmRig, type Rig } from '@faceling/rigs';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VARIANTS } from '@faceling/core/weights';
import * as THREE from 'three';
import { RealtimeConnection } from '@faceling/openai-realtime';
import { initialLang, lang, setLang, t, type Lang } from './i18n';
import { findRecorded, type Recordings } from './recorded';
import { Simulation, demoLines, type SimLine } from './simulate';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

/** 브라우저 저장소. 사생활 모드 등에서 막혀 있어도 화면은 돌아가야 한다. */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`faceling.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`faceling.${key}`, value);
    } catch {
      // 저장하지 못해도 이번 방문에서는 그대로 쓴다
    }
  },
};

// 화면 언어. 다른 글을 만들기 전에 먼저 정한다.
setLang(initialLang(params.get('lang'), store.get('lang')));

/**
 * 정적 페이지 방식: 서버와 키 없이, 녹화해 둔 판단으로 예시 대화만 재생한다.
 * GitHub Pages 용 빌드(vite build --mode pages)이거나 주소에 ?static 이 붙었을 때다.
 */
const STATIC_PAGE = import.meta.env.MODE === 'pages' || params.has('static');

// ── 얼굴 종류 ─────────────────────────────────────────────
const AVATARS = ['faceling', 'robot', 'dog', 'arm', 'vrm'] as const;
type Avatar = (typeof AVATARS)[number];
const avatarName = (avatar: Avatar): string => t(`avatar.${avatar}`);
const avatarDesc = (avatar: Avatar): string => t(`avatar.${avatar}.desc`);
const isAvatar = (value: string | null): value is Avatar => AVATARS.includes(value as Avatar);
/** 그 캐릭터의 몸 명세. 리그가 선언한 것을 그대로 쓴다(3D 모델은 불러오기 전에도 얼굴 몸이다). */
const bodyOf = (avatar: Avatar): BodySpec => rigOf(avatar)?.body ?? FACE_BODY;

/** 목소리 칩에 먼저 보여 줄 것. 나머지는 개발자 패널에서 고른다. */
const FEATURED_VOICES = ['marin', 'cedar', 'coral', 'ash'];
const voiceLabel = (voice: string): string => voice.charAt(0).toUpperCase() + voice.slice(1);

/** 받침에 따라 "으로"/"로"를 고른다. ㄹ 받침 뒤에는 "로"다. */
function ro(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '로';
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

// ── 화면 상태 ─────────────────────────────────────────────
interface AppConfig {
  openai: boolean;
  jev: boolean;
  model: string;
  voice: string;
  voices: string[];
}

const state = {
  screen: 'onboarding' as 'onboarding' | 'chat',
  step: 1,
  /** 대화 중에 "캐릭터 변경"으로 2단계에 들어온 것인지. 그때의 원래 값. */
  changing: null as { avatar: Avatar; voice: string } | null,
  avatar: (isAvatar(params.get('avatar')) ? params.get('avatar') : isAvatar(store.get('avatar')) ? store.get('avatar') : 'faceling') as Avatar,
  voice: store.get('voice') ?? '',
  conn: 'off' as 'off' | 'connecting' | 'on',
  connectedAt: 0,
  withoutMic: false,
  /** 연결 실패나 끊김. 상태 칩을 오류로 바꾸고 "다시 시도"를 띄운다. */
  failed: false,
  ended: false,
  loadingVrm: false,
  config: { openai: false, jev: true, model: '', voice: 'marin', voices: [] } as AppConfig,
};

// ── three.js ──────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(720, 720, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
scene.add(new THREE.AmbientLight(0xffffff, 1.3));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.6, 1.2, 1.5);
scene.add(key);

/**
 * 코드로 그린 캐릭터들. 처음 고를 때 만든다.
 * 여기서 만들고 나면 화면은 리그의 종류를 가리지 않는다: 몸 명세, 카메라 위치, 프레임 입히기를 모두 공통 형태(Rig)로 다룬다.
 */
type DrawnAvatar = Exclude<Avatar, 'vrm'>;
const MAKE: Record<DrawnAvatar, () => Rig> = {
  faceling: () => new FacelingRig(),
  robot: () => new RobotRig(),
  dog: () => new DogRig(),
  arm: () => new ArmRig(),
};
const DRAWN = Object.keys(MAKE) as DrawnAvatar[];
const rigs: Partial<Record<DrawnAvatar, Rig>> = {};

/**
 * 3D 얼굴(VRM). 직접 고른 파일이 없으면 three-vrm 의 예제 모델을 실행 중에 불러온다.
 * 이 모델은 저장소에 넣지 않는다.
 */
const SAMPLE_VRM = 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';
const lookTarget = new THREE.Object3D();
scene.add(lookTarget);
let vrm: VRM | null = null;
let vrmRig: VrmRig | null = null;
let vrmLoading: Promise<void> | null = null;
let vrmLabel = '';

async function loadVrm(source: string, label: string): Promise<void> {
  setStatus(t('vrm.loading', { label }));
  state.loadingVrm = true;
  refresh();
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(source);
    const next = gltf.userData.vrm as VRM | undefined;
    if (!next) throw new Error(t('vrm.notVrm'));
    VRMUtils.rotateVRM0(next);
    if (vrm) {
      scene.remove(vrm.scene);
      VRMUtils.deepDispose(vrm.scene);
    }
    vrm = next;
    scene.add(vrm.scene);
    vrm.scene.updateMatrixWorld(true);
    const head = new THREE.Vector3();
    vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(head);
    vrmRig = new VrmRig(vrm, lookTarget, { x: head.x, y: head.y + 0.04, z: head.z + 1.15 });
    vrmLabel = label;
    showModelInfo(label);
    setStatus(t('vrm.loaded', { label }));
  } finally {
    state.loadingVrm = false;
    refresh();
  }
}

/** 모델 정보와, 얼굴이 표정을 얼마나 낼 수 있는지 보여 준다 */
function showModelInfo(label: string): void {
  if (!vrm || !vrmRig) return;
  const meta = vrm.meta as { name?: string; title?: string; authors?: string[]; author?: string };
  const name = meta.name ?? meta.title ?? label;
  const author = meta.authors?.join(', ') ?? meta.author ?? '';
  const ability =
    vrmRig.mode === 'arkit'
      ? t('vrm.arkit', { n: vrmRig.supported.length })
      : t('vrm.preset');
  $('model-info').textContent = `${name}${author ? ` (${author})` : ''}. ${ability}`;
}

function ensureRig(which: DrawnAvatar): Rig {
  let rig = rigs[which];
  if (!rig) {
    rig = rigs[which] = MAKE[which]();
    scene.add(rig.object);
  }
  return rig;
}

/** 그 캐릭터의 리그. 3D 모델은 다 불러오기 전이면 없다. */
const rigOf = (avatar: Avatar): Rig | null => (avatar === 'vrm' ? vrmRig : ensureRig(avatar));

/** 그 캐릭터만 보이게 하고 카메라를 맞춘다 */
function frameAvatar(which: Avatar): void {
  const rig = rigOf(which);
  if (rig) {
    camera.position.copy(rig.view.position);
    camera.lookAt(rig.view.target);
  }
  for (const drawn of DRAWN) {
    const other = rigs[drawn];
    if (other) other.object.visible = which === drawn;
  }
  if (vrmRig) vrmRig.object.visible = which === 'vrm';
}

function showAvatar(next: Avatar): void {
  state.avatar = next;
  // 판단에 이 몸이 할 수 있는 움직임을 함께 묻는다. 무엇을 할 수 있는지는 리그가 선언한다.
  director.body = bodyOf(next);
  if (next === 'vrm' && !vrm && !vrmLoading) {
    vrmLoading = loadVrm(SAMPLE_VRM, t('vrm.sample'))
      .then(() => {
        if (state.avatar === 'vrm') frameAvatar('vrm');
      })
      .catch((err: unknown) => setNotice(t('vrm.failed', { message: err instanceof Error ? err.message : String(err) })))
      .finally(() => (vrmLoading = null));
  }
  frameAvatar(next);
  document.body.dataset.avatar = next;
  renderAvatarChoice();
}

/** 카드와 머리말에 쓸 얼굴 정지 이미지. 같은 렌더러로 한 번 찍어 둔다. */
const thumbs: Partial<Record<Avatar, string>> = {};
function takeThumbnails(): void {
  const frame = face.update(clock(), null);
  const small = document.createElement('canvas');
  small.width = small.height = 192;
  const ctx = small.getContext('2d');
  for (const which of DRAWN) {
    ensureRig(which).apply(frame);
    frameAvatar(which);
    renderer.render(scene, camera);
    if (!ctx) continue;
    ctx.clearRect(0, 0, 192, 192);
    ctx.drawImage(canvas, 0, 0, 192, 192);
    thumbs[which] = small.toDataURL('image/png');
  }
  frameAvatar(state.avatar);
}

/** 얼굴 틀 안에 정지 이미지(또는 3D 표시)를 채운다 */
function fillThumb(box: HTMLElement, which: Avatar): void {
  const surface = box.querySelector<HTMLElement>('.surface') ?? box;
  const src = thumbs[which];
  surface.innerHTML = src ? `<img src="${src}" alt="" />` : '<span class="glyph">3D</span>';
}

// ── 표정 엔진 ─────────────────────────────────────────────
const clock = (): number => performance.now() / 1000;

/** 정적 페이지가 재생할 녹화된 판단. 처음 쓸 때 한 번 받는다. */
let recordings: Promise<Recordings> | null = null;
/** 녹화 당시 Jev 가 답하는 데 걸린 시간과 비슷하게 기다린다. 실제보다 빨라 보이지 않게 한다. */
const RECORDED_DELAY_MS = 250;

/** 절 하나의 판단을 서버를 거쳐 Jev 에 묻는다. 정적 페이지에서는 녹화에서 찾는다. */
async function judge(input: AnalyzerInput): Promise<Judgment> {
  if (STATIC_PAGE) {
    recordings ??= fetch('./recordings.json').then((res) => res.json() as Promise<Recordings>);
    const [all] = await Promise.all([recordings, new Promise((r) => setTimeout(r, RECORDED_DELAY_MS))]);
    return findRecorded(all, input);
  }
  const res = await fetch('/api/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 몸 명세는 이름만 보낸다. 설명은 서버가 가진 명세에서 나온다.
    body: JSON.stringify({ ...input, body: input.body?.name }),
  });
  const body = (await res.json()) as { judgment?: Judgment; error?: string };
  if (!res.ok || !body.judgment) {
    setNotice(body.error ?? t('notice.judgeFailed'));
    throw new Error(body.error ?? '판단 요청 실패');
  }
  return body.judgment;
}

const face = new LiveFace();
const director = new LiveDirector(face, { judge, clock, onStats: showStats });
// 판단 방식: 부위마다 선택지에서 고르기(기본) 또는 부위별 수치로 직접 판단하기(실험). 주소에 ?mode=channels 로도 켠다.
director.mode = (params.get('mode') ?? store.get('mode')) === 'channels' ? 'channels' : 'choices';

/** 개발자 패널의 진행 상황 줄 */
const setStatus = (text: string): void => void ($('status').textContent = text);
/** 사용자에게 보이는 오류·안내. 자막 아래에 붙는다. */
const setNotice = (message: string): void => void ($('notice').textContent = message);

// ── 자막과 대화 기록 ──────────────────────────────────────
interface Message {
  who: 'user' | 'assistant';
  text: string;
  final: boolean;
  el: HTMLElement;
  body: HTMLElement;
  meta?: HTMLElement;
  /** 이 대사를 말하는 동안 가장 자주 나온 얼굴 동작을 세어 둔다 */
  actions: Map<string, number>;
}
const messages: Message[] = [];
const caption = { who: '' as '' | 'user' | 'assistant', text: '' };

function addMessage(who: Message['who']): Message {
  const list = $('messages');
  list.querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${who === 'user' ? 'user' : 'ai'}`;
  const message: Message = { who, text: '', final: false, el, body: el, actions: new Map() };
  if (who === 'assistant') {
    message.meta = document.createElement('span');
    message.meta.className = 'meta';
    message.body = document.createElement('p');
    el.append(message.meta, message.body);
    renderMeta(message);
  }
  list.append(el);
  messages.push(message);
  return message;
}

function renderMeta(message: Message): void {
  if (!message.meta) return;
  let top = '';
  let most = 0;
  for (const [label, n] of message.actions) if (n > most) [top, most] = [label, n];
  message.meta.textContent = `${avatarName(state.avatar)}${top ? ` · ${top}` : ''}`;
}

/**
 * 연결이 보내는 자막. 같은 말이 자라면서 여러 번 오므로(부분 → 최종) 말풍선 하나를 고쳐 쓴다.
 * - 사용자: 아직 최종이 아닌 마지막 사용자 말풍선을 고친다.
 * - AI: 마지막 AI 말풍선의 글이 앞부분으로 들어 있으면 같은 대사다. 새 응답은 짧은 조각부터 오므로 새 말풍선이 된다.
 */
function onCaption(who: 'user' | 'assistant', text: string, final: boolean): void {
  if (!text) return;
  let target: Message | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.who !== who) continue;
    if (who === 'user' ? !m.final : text.startsWith(m.text) && m.text.length > 0) target = m;
    break;
  }
  target ??= addMessage(who);
  target.text = text;
  target.final ||= final;
  target.body.textContent = text;
  const list = $('messages');
  list.scrollTop = list.scrollHeight;
  caption.who = who;
  caption.text = text;
  refresh();
}

function clearConversation(): void {
  messages.length = 0;
  $('messages').innerHTML = `<p class="empty">${t('log.empty')}</p>`;
  caption.who = '';
  caption.text = '';
}

// ── 연결 ──────────────────────────────────────────────────
/** 연결 옵션. 언어가 바뀌면 임시 키를 받는 주소와 인사 지시를 바꾼다(다음 연결부터 적용된다). */
const connectionOptions: NonNullable<ConstructorParameters<typeof RealtimeConnection>[2]> = {};
const connectionCallbacks: ConstructorParameters<typeof RealtimeConnection>[1] = {
  onStatus: setStatus,
  onCaption,
  onError: setNotice,
  onDropped: () => {
    state.conn = 'off';
    state.failed = true;
    setNotice(t('notice.dropped'));
    refresh();
  },
};
const connection = new RealtimeConnection(director, connectionCallbacks, connectionOptions);
const simulation = new Simulation(director, onCaption);
let demo: Promise<void> = Promise.resolve();

// 주소에 ?fakeMic=/dev/파일.wav 를 붙이면 마이크 대신 그 소리를 보낸다. 마이크 없이 음성 경로를 시험할 때 쓴다.
const fakeMicUrl = params.get('fakeMic');
let playFakeMic: (() => void) | null = null;
async function fakeMic(url: string): Promise<MediaStream> {
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const out = ctx.createMediaStreamDestination();
  playFakeMic = () => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    source.start();
  };
  return out.stream;
}

async function startConversation(withoutMic: boolean): Promise<void> {
  if (!state.config.openai) {
    runDemo();
    return;
  }
  if (state.conn !== 'off') return;
  state.conn = 'connecting';
  state.failed = false;
  state.ended = false;
  state.withoutMic = withoutMic;
  setNotice('');
  refresh();
  // 예시 대화가 돌고 있으면 완전히 멈춘 뒤에 시작한다. 남은 자막이 새 대화에 섞이지 않게.
  simulation.stop();
  await demo;
  clearConversation();
  try {
    await connection.connect({
      voice: state.voice,
      character: bodyOf(state.avatar).name,
      withoutMic,
      greet: $<HTMLInputElement>('greet').checked,
      liveReactions: $<HTMLInputElement>('live-reactions').checked,
      micOverride: fakeMicUrl ? () => fakeMic(fakeMicUrl) : undefined,
    });
    state.conn = 'on';
    state.connectedAt = Date.now();
    if (!withoutMic && connection.listenOnly) {
      setNotice(t('notice.noMic'));
      void checkMicPermission();
    }
    // 글로 대화할 때는 입력창이 보여야 한다
    if (connection.listenOnly) setLog(true);
  } catch (err) {
    connection.disconnect();
    state.conn = 'off';
    state.failed = true;
    setNotice(err instanceof Error ? err.message : String(err));
  }
  refresh();
}

function endConversation(): void {
  connection.disconnect();
  state.conn = 'off';
  state.ended = true;
  state.failed = false;
  setStatus(t('status.ended'));
  refresh();
}

/** 예시 대화를 재생한다. 대사를 주지 않으면 지금 언어와 몸에 맞는 예시 대화다. */
function runDemo(lines: SimLine[] = demoLines(lang(), bodyOf(state.avatar).name)): void {
  if (simulation.running || state.conn !== 'off') return;
  setNotice('');
  clearConversation();
  state.ended = false;
  setStatus(t('status.demoRunning'));
  demo = simulation.run(lines).then(() => {
    setStatus(t('status.demoDone'));
    refresh();
  });
  refresh();
}

function sendText(text: string): void {
  const line = text.trim();
  if (!line || state.conn !== 'on') return;
  connection.sendText(line);
}

// ── 화면 그리기 ───────────────────────────────────────────
type Mode = 'off' | 'connecting' | 'waiting' | 'muted' | 'text' | 'demo' | 'error' | Exclude<TurnState, 'idle'>;

function currentMode(): Mode {
  const turn = face.turn;
  if (state.conn === 'connecting') return 'connecting';
  if (state.conn === 'off') {
    if (simulation.running) return turn === 'idle' ? 'demo' : turn;
    return state.failed ? 'error' : 'off';
  }
  if (turn !== 'idle') return turn;
  if (connection.listenOnly) return 'text';
  return connection.micEnabled ? 'waiting' : 'muted';
}

function captionHint(mode: Mode): string {
  if (state.loadingVrm && state.avatar === 'vrm') return t('hint.vrm');
  switch (mode) {
    case 'waiting':
      return t('hint.waiting');
    case 'muted':
      return t('hint.muted');
    case 'text':
      return t('hint.text');
    case 'connecting':
      return t('hint.connecting');
    case 'error':
      return t('hint.error');
    case 'off':
      if (STATIC_PAGE) return t('hint.static');
      if (!state.config.openai) return t('hint.noOpenai');
      return state.ended ? t('hint.ended') : t('hint.off');
    default:
      return '';
  }
}

let lastRender = '';
/** 상태에서 파생되는 것을 모두 다시 그린다. 바뀐 것이 없으면 아무것도 하지 않는다. */
function refresh(): void {
  const mode = currentMode();
  const live = state.conn === 'on';
  const hint = captionHint(mode);
  const showCaption = caption.text !== '' && (live || simulation.running);
  // 화면이 멈춘 것처럼 보이는 구간: 연결하는 중, 고른 3D 모델을 불러오는 중
  const busy = state.conn === 'connecting' || (state.loadingVrm && state.avatar === 'vrm');
  const signature = [mode, state.conn, state.screen, state.step, state.avatar, state.voice, showCaption ? caption.text : hint, connection.micEnabled, connection.listenOnly, simulation.running, Boolean(state.changing), busy, lang()].join('|');
  if (signature === lastRender) return;
  lastRender = signature;

  const body = document.body;
  body.dataset.screen = state.screen;
  body.dataset.step = String(state.step);
  body.dataset.conn = state.conn;
  body.dataset.mode = mode;
  body.dataset.change = state.changing ? 'on' : 'off';
  body.dataset.busy = busy ? 'on' : 'off';

  // 상태 칩, 자막
  $('status-text').textContent = t(`mode.${mode}`);
  const cap = $('caption');
  cap.textContent = showCaption ? caption.text : hint;
  cap.classList.toggle('hint', !showCaption);
  cap.dataset.who = showCaption ? caption.who : '';

  // 연결 전 버튼
  const start = $<HTMLButtonElement>('start');
  start.disabled = state.conn === 'connecting';
  $('start-label').textContent =
    state.conn === 'connecting'
      ? t('start.connecting')
      : !state.config.openai
        ? simulation.running
          ? t('start.demoStop')
          : t('start.demo')
        : state.failed
          ? t('start.retry')
          : t('start.go');
  $('start-text-2').hidden = !state.config.openai || state.conn === 'connecting';

  // 마이크
  const mic = $<HTMLButtonElement>('mic');
  mic.disabled = connection.listenOnly;
  mic.setAttribute('aria-pressed', String(!connection.listenOnly && connection.micEnabled));
  const micLabel = connection.listenOnly ? t('mic.none') : connection.micEnabled ? t('mic.off') : t('mic.on');
  mic.setAttribute('aria-label', micLabel);
  mic.title = micLabel;

  // 글 입력
  const input = $<HTMLInputElement>('say-text');
  input.disabled = !live;
  input.placeholder = live ? t('say.placeholder') : t('say.disabled');
  $<HTMLButtonElement>('say').disabled = !live;
  for (const b of $('suggestions').querySelectorAll('button')) b.disabled = !live;

  // 머리말
  $('avatar-name').textContent = avatarName(state.avatar);
  fillThumb($('header-face'), state.avatar);
  updateTimer();

  renderOnboarding();
}

function updateTimer(): void {
  let text = t('timer.off');
  if (state.conn === 'connecting') text = t('timer.connecting');
  if (simulation.running) text = t('timer.demo');
  if (state.conn === 'on') {
    const s = Math.floor((Date.now() - state.connectedAt) / 1000);
    text = `● LIVE · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  $('live').textContent = text;
}

// ── 온보딩 ────────────────────────────────────────────────
function renderOnboarding(): void {
  for (const n of [1, 2, 3]) $(`step-${n}`).classList.toggle('active', state.step === n);
  const bars = document.querySelectorAll<HTMLElement>('.progress i');
  bars.forEach((bar, i) => {
    bar.classList.toggle('now', i + 1 === state.step);
    bar.classList.toggle('done', i + 1 < state.step);
  });
  $('step-label').textContent = `${state.step} / 3`;

  const name = avatarName(state.avatar);
  $('step-2-next').textContent = t(state.changing ? 'onb.switch' : 'onb.pick', { name, ro: ro(name) });
  $('step-2-back').textContent = state.changing ? t('onb.cancel') : t('onb.back');

  const { openai, jev } = state.config;
  $('step-3-title').textContent = STATIC_PAGE ? t('onb.staticTitle') : openai ? t('onb.voiceTitle') : t('onb.noKeyTitle');
  $('step-3-desc').textContent = STATIC_PAGE ? t('onb.staticDesc') : openai ? t('onb.voiceDesc') : t('onb.noKeyDesc');
  $('perm-mic').hidden = !openai;
  $('perm-jev').hidden = jev;
  $('start-voice').textContent = openai ? t('onb.startVoice') : t('start.demo');
  $('start-text').hidden = !openai;
}

function renderAvatarChoice(): void {
  for (const card of document.querySelectorAll<HTMLElement>('#avatar-cards [data-avatar]')) {
    const on = card.dataset.avatar === state.avatar;
    card.setAttribute('aria-checked', String(on));
    card.tabIndex = on ? 0 : -1;
  }
  refresh();
}

function buildAvatarCards(): void {
  $('avatar-cards').innerHTML = AVATARS.map(
    (a) => `<button class="card-pick" role="radio" data-avatar="${a}">
      <div class="face"><div class="surface"></div></div>
      <div><b>${avatarName(a)}</b><span>${avatarDesc(a)}</span></div>
    </button>`,
  ).join('');
  for (const card of document.querySelectorAll<HTMLElement>('#avatar-cards [data-avatar]')) {
    const which = card.dataset.avatar as Avatar;
    fillThumb(card.querySelector('.face')!, which);
    card.addEventListener('click', () => showAvatar(which));
  }
  renderAvatarChoice();
}

function buildVoiceChips(): void {
  const { voices } = state.config;
  const shown = [...new Set([...FEATURED_VOICES.filter((v) => voices.includes(v)), state.voice])];
  $('voice-chips').innerHTML = shown
    .map((v) => `<button class="chip-voice" role="radio" data-voice="${v}" aria-checked="${v === state.voice}">${voiceLabel(v)}</button>`)
    .join('');
  for (const chip of document.querySelectorAll<HTMLElement>('#voice-chips [data-voice]')) {
    chip.addEventListener('click', () => setVoice(chip.dataset.voice!));
  }
  $<HTMLSelectElement>('voice').value = state.voice;
}

function setVoice(voice: string): void {
  state.voice = voice;
  store.set('voice', voice);
  buildVoiceChips();
  refresh();
}

function goStep(step: number): void {
  state.step = step;
  if (step === 3) void checkMicPermission();
  refresh();
  // 단계가 바뀌면 그 단계의 첫 버튼으로 초점을 옮긴다
  $(`step-${step}`).querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
}

async function checkMicPermission(): Promise<void> {
  const show = (permission: PermissionState): void => {
    const dot = $('mic-dot');
    dot.classList.toggle('on', permission === 'granted');
    dot.classList.toggle('bad', permission === 'denied');
    $('mic-state').textContent = t(`perm.${permission}`);
    $('mic-desc').textContent =
      permission === 'denied' ? t('perm.blocked') : t('perm.needed');
  };
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    show(status.state);
    status.onchange = () => show(status.state);
  } catch {
    // 권한 조회를 지원하지 않는 브라우저는 "대기"로 둔다
  }
}

function finishOnboarding(): void {
  store.set('onboarded', '1');
  store.set('avatar', state.avatar);
  state.screen = 'chat';
  refresh();
}

/** "캐릭터 변경": 연결은 그대로 두고 얼굴을 고른다. 목소리가 바뀌었을 때만 다시 연결한다. */
function openChange(): void {
  state.changing = { avatar: state.avatar, voice: state.voice };
  state.screen = 'onboarding';
  goStep(2);
}

function closeChange(apply: boolean): void {
  const before = state.changing;
  state.changing = null;
  state.screen = 'chat';
  if (!before) return refresh();
  if (!apply) {
    showAvatar(before.avatar);
    setVoice(before.voice);
    return;
  }
  store.set('avatar', state.avatar);
  // 예시 대화는 몸마다 대사가 다르다. 재생 중에 몸이 바뀌었으면 새 몸의 대화로 다시 튼다.
  if (simulation.running && bodyOf(state.avatar).name !== bodyOf(before.avatar).name) restartDemo();
  // 목소리와 AI 가 아는 자기 몸은 연결한 뒤에는 바꿀 수 없어서 다시 연결한다
  if (state.conn === 'on' && (state.voice !== before.voice || bodyOf(state.avatar).name !== bodyOf(before.avatar).name)) {
    const withoutMic = state.withoutMic;
    connection.disconnect();
    state.conn = 'off';
    void startConversation(withoutMic);
  }
  refresh();
}

// ── 대화 기록 패널, 개발자 패널 ───────────────────────────
function setLog(on: boolean): void {
  document.body.dataset.log = on ? 'on' : 'off';
  $('log-toggle').setAttribute('aria-pressed', String(on));
  store.set('log', on ? 'on' : 'off');
}

function setDev(on: boolean): void {
  document.body.dataset.dev = on ? 'on' : 'off';
  store.set('dev', on ? 'on' : 'off');
}

const ms = (seconds: number | null): string => (seconds === null ? '-' : `${Math.round(seconds * 1000)}ms`);

function showStats(stats: DirectorStats): void {
  const lead = stats.meanLead;
  const leadText = lead === null ? '-' : lead >= 0 ? t('stats.early', { ms: ms(lead) }) : t('stats.late', { ms: ms(-lead) });
  $('stats').innerHTML =
    `<span>${t('stats.judged')}</span><b>${t('stats.count', { n: stats.judged })}</b>` +
    `<span>${t('stats.missed')}</span><b>${t('stats.count', { n: stats.missed })}</b>` +
    `<span>${t('stats.latency')}</span><b>${ms(stats.meanLatency)}</b>` +
    `<span>${t('stats.lead')}</span><b>${leadText}</b>` +
    `<span>${t('stats.firstDelay')}</span><b>${ms(stats.meanFirstDelay)}</b>` +
    `<span>${t('stats.rate')}</span><b>${t('stats.perChar', { ms: ms(stats.secondsPerChar) })}</b>`;
}

function buildRegionRows(): void {
  $('dims').innerHTML = REGION_KEYS.map(
    (r) => `<span>${regionLabel(r)}</span><div class="bar"><i data-dim="${r}"></i></div><span data-val="${r}">-</span>`,
  ).join('');
}

/** 부위와 동작의 이름. 한국어는 엔진이 가진 이름을, 영어는 엔진 안에서 쓰는 영어 이름을 그대로 보여 준다. */
const regionLabel = (region: Region): string => (lang() === 'en' ? region : regionSpec(region).label);
const actionLabel = (region: Region, action: string): string =>
  lang() === 'en' ? action.replace(/_/g, ' ') : (regionSpec(region).actions[action]?.label ?? action);

function showDebug(frame: LiveFrame): void {
  if (document.body.dataset.dev !== 'on') return;
  for (const region of REGION_KEYS) {
    let best = { action: '', w: 0 };
    for (const v of VARIANTS) {
      const w = frame.debug.weights[v.key] ?? 0;
      if (v.region === region && w > best.w) best = { action: v.action, w };
    }
    const bar = document.querySelector<HTMLElement>(`[data-dim="${region}"]`);
    const val = document.querySelector<HTMLElement>(`[data-val="${region}"]`);
    if (bar) bar.style.width = `${Math.min(1, best.w) * 100}%`;
    if (val) val.textContent = best.w > 0.03 ? `${actionLabel(region, best.action)} ${best.w.toFixed(2)}` : '-';
  }
  const cue = frame.debug.cue;
  // 부위별 수치 판단이면 세기가 큰 채널과 유지 시간을 보여 준다
  const judgedChannels = cue?.judgment.channels;
  if (cue && judgedChannels) {
    const top = Object.entries(judgedChannels)
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 10)
      .map(([name, v]) => `${name} ${v.amount.toFixed(2)} ${t(`dur.${v.duration}`)}`);
    $('judged').textContent =
      `${cue.kind === 'react' ? t('debug.react') : t('debug.speak')} · "${cue.text}" · ${t('debug.channels')} · ` +
      (top.join(', ') || t('debug.still')) +
      (cue.judgment.reset ? ` · ${t('debug.reset')}` : '');
    return;
  }
  $('judged').textContent = cue
    ? `${cue.kind === 'react' ? t('debug.react') : t('debug.speak')} · "${cue.text}" · ` +
      REGION_KEYS.map((r) => {
        const top = topAction(cue.judgment.regions[r]);
        return `${regionLabel(r)} ${actionLabel(r, top.action)} ${Math.round(top.p * 100)}%`;
      }).join(', ')
    : '';
}

/**
 * 상태 칩 옆에 붙이는 "지금 얼굴이 하는 동작". 판단 모델이 고른 동작 중 가장 강하게 걸린 것이다.
 * 편안·정면처럼 아무것도 안 하는 동작은 빼고, "올림"처럼 부위 없이는 뜻이 모호한 것은 부위 이름을 붙인다.
 */
const RESTING = new Set(['편안', '정면', '그대로']);
const NEEDS_REGION = new Set(['눈썹', '눈', '시선']);
function strongestAction(frame: LiveFrame): string {
  let best = { label: '', w: 0.2 };
  for (const v of VARIANTS) {
    const w = frame.debug.weights[v.key] ?? 0;
    if (w <= best.w) continue;
    const spec = regionSpec(v.region);
    // 쉬는 동작인지, 부위 이름이 필요한지는 엔진이 가진 한국어 이름으로 가린다
    if (RESTING.has(spec.actions[v.action]?.label ?? v.action)) continue;
    const label = actionLabel(v.region, v.action);
    const region = regionLabel(v.region);
    best = { label: NEEDS_REGION.has(spec.label) && !label.includes(region) ? `${region} ${label}` : label, w };
  }
  return best.label;
}

let shownAction = '';
let actionShownAt = 0;
function showAction(frame: LiveFrame, now: number): void {
  const label = strongestAction(frame);
  // 금방 바뀌는 동작에 글자가 깜빡이지 않게 최소 0.6초는 둔다
  if (label === shownAction || now - actionShownAt < 0.6) return;
  shownAction = label;
  actionShownAt = now;
  $('action').textContent = label ? `· ${label}` : '';
}

/** AI 가 말하는 동안 나온 동작을 그 대사의 말풍선에 센다 */
let metaCountdown = 0;
function countAction(frame: LiveFrame): void {
  if (frame.debug.turn !== 'speaking') return;
  let last: Message | undefined;
  for (let i = messages.length - 1; i >= 0 && !last; i--) if (messages[i]!.who === 'assistant') last = messages[i];
  const label = strongestAction(frame);
  if (!last || !label) return;
  last.actions.set(label, (last.actions.get(label) ?? 0) + 1);
  if (--metaCountdown <= 0) {
    metaCountdown = 30;
    renderMeta(last);
  }
}

// ── 매 프레임 ─────────────────────────────────────────────
let lastFrame: LiveFrame | null = null;
const frameClock = new THREE.Clock();
function tick(): void {
  requestAnimationFrame(tick);
  const now = clock();
  const mouth = simulation.running ? simulation.mouth() : connection.mouth();
  const frame = face.update(now, mouth);
  lastFrame = frame;
  const dt = frameClock.getDelta();
  const rig = rigOf(state.avatar);
  rig?.apply(frame);
  rig?.update?.(dt);
  renderer.render(scene, camera);
  showDebug(frame);
  showAction(frame, now);
  countAction(frame);
  refresh();
}

// ── 조작 연결 ─────────────────────────────────────────────
function bindControls(): void {
  // 판단 방식 전환. 다음 판단부터 바뀐다.
  const channelMode = $<HTMLInputElement>('channel-mode');
  channelMode.checked = director.mode === 'channels';
  channelMode.addEventListener('change', () => {
    director.mode = channelMode.checked ? 'channels' : 'choices';
    store.set('mode', director.mode);
  });

  // 정적 페이지는 녹화가 있는 방식(선택지에서 고르기)만 재생한다
  if (STATIC_PAGE) {
    director.mode = 'choices';
    channelMode.checked = false;
    channelMode.disabled = true;
  }

  // 화면 언어
  for (const b of document.querySelectorAll<HTMLElement>('.lang-toggle')) {
    b.addEventListener('click', () => applyLang(lang() === 'ko' ? 'en' : 'ko'));
  }

  // 온보딩
  for (const b of document.querySelectorAll<HTMLElement>('[data-go]')) b.addEventListener('click', () => goStep(Number(b.dataset.go)));
  $('step-2-back').addEventListener('click', () => (state.changing ? closeChange(false) : goStep(1)));
  $('step-2-next').addEventListener('click', () => (state.changing ? closeChange(true) : goStep(3)));
  $('step-3-back').addEventListener('click', () => goStep(2));
  $('start-voice').addEventListener('click', () => {
    finishOnboarding();
    void startConversation(false);
  });
  $('start-text').addEventListener('click', () => {
    finishOnboarding();
    void startConversation(true);
  });
  // 카드 묶음은 화살표 키로도 고른다
  $('avatar-cards').addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = AVATARS[(AVATARS.indexOf(state.avatar) + step + AVATARS.length) % AVATARS.length]!;
    showAvatar(next);
    document.querySelector<HTMLElement>(`#avatar-cards [data-avatar="${next}"]`)?.focus();
  });

  // 대화 화면
  $('start').addEventListener('click', () => {
    if (simulation.running) simulation.stop();
    else void startConversation(false);
  });
  $('start-text-2').addEventListener('click', () => void startConversation(true));
  $('end').addEventListener('click', endConversation);
  $('mic').addEventListener('click', () => {
    connection.setMicEnabled(!connection.micEnabled);
    refresh();
  });
  $('change').addEventListener('click', openChange);
  $('log-toggle').addEventListener('click', () => setLog(document.body.dataset.log !== 'on'));
  for (const b of $('suggestions').querySelectorAll('button')) b.addEventListener('click', () => sendText(b.textContent ?? ''));
  $('say-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const box = $<HTMLInputElement>('say-text');
    sendText(box.value);
    box.value = '';
  });

  // 개발자 패널
  $('dev-close').addEventListener('click', () => setDev(false));
  document.addEventListener('keydown', (event) => {
    if (event.key !== '`' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
    setDev(document.body.dataset.dev !== 'on');
  });
  $('speak-first').addEventListener('click', () => connection.speakFirst());
  $('interrupt').addEventListener('click', () => connection.interrupt());
  $<HTMLSelectElement>('voice').addEventListener('change', (event) => {
    setVoice((event.target as HTMLSelectElement).value);
    if (state.conn === 'on') setStatus(t('status.voiceNext'));
  });
  $<HTMLInputElement>('vrm-file').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setNotice('');
    loadVrm(URL.createObjectURL(file), file.name)
      .then(() => showAvatar('vrm'))
      .catch((err: unknown) => setNotice(t('vrm.failed', { message: err instanceof Error ? err.message : String(err) })));
  });
  $('sim-demo').addEventListener('click', () => runDemo());
  $('sim-say').addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('sim-text').value.trim();
    if (text) runDemo([{ speaker: 'assistant', text }]);
  });
  $('sim-stop').addEventListener('click', () => simulation.stop());
}

/** 화면 언어를 바꾸고, 코드가 만든 글을 모두 다시 그린다. AI 가 쓰는 말은 다음 연결부터 바뀐다. */
function applyLang(next: Lang): void {
  setLang(next);
  store.set('lang', next);
  connectionOptions.sessionUrl = `/api/session?lang=${next}`;
  connectionOptions.transcriptionSessionUrl = `/api/transcription-session?lang=${next}`;
  connectionOptions.greeting =
    next === 'en' ? '(The conversation is starting. Greet the user warmly first and ask how their day has been.)' : undefined;
  for (const b of document.querySelectorAll<HTMLElement>('.lang-toggle')) {
    b.textContent = t('lang.switch');
    b.setAttribute('aria-label', t('lang.label'));
  }
  buildRegionRows();
  showStats(director.stats);
  buildAvatarCards();
  if (vrm) showModelInfo(vrmLabel);
  else $('model-info').textContent = t('vrm.info');
  if (messages.length === 0) clearConversation();
  if (state.step === 3) void checkMicPermission();
  // 재생 중이던 예시 대화는 새 언어로 처음부터 다시 튼다
  if (simulation.running) restartDemo();
  lastRender = '';
  refresh();
}

/** 재생 중인 예시 대화를 멈추고 지금 언어와 몸으로 다시 튼다 */
function restartDemo(): void {
  simulation.stop();
  void demo.then(() => runDemo());
}

async function init(): Promise<void> {
  document.body.dataset.static = STATIC_PAGE ? 'on' : 'off';
  takeThumbnails();
  applyLang(lang());
  showAvatar(state.avatar);
  bindControls();

  const savedLog = store.get('log');
  setLog(savedLog ? savedLog === 'on' : window.innerWidth >= 820);
  setDev(params.has('dev') || store.get('dev') === 'on');
  // 처음 왔으면 온보딩, 다시 왔으면 바로 대화 화면(연결은 사용자가 누를 때 한다)
  if (store.get('onboarded') === '1' && !params.has('onboarding')) state.screen = 'chat';
  tick();
  setInterval(updateTimer, 1000);

  if (STATIC_PAGE) {
    // 서버가 없다. 음성 대화는 끄고, 표정은 녹화된 판단으로 재생한다.
    setStatus(t('status.static'));
    lastRender = '';
    refresh();
    return;
  }
  const config = (await (await fetch('/api/config')).json()) as AppConfig;
  state.config = config;
  if (!config.voices.includes(state.voice)) state.voice = config.voice;
  $('voice').innerHTML = config.voices.map((v) => `<option value="${v}">${voiceLabel(v)}</option>`).join('');
  buildVoiceChips();
  if (!config.jev) setNotice(t('notice.noJev'));
  setStatus(config.openai ? t('status.ready', { model: config.model }) : t('status.noOpenai'));
  lastRender = '';
  refresh();
}

// 브라우저 콘솔과 자동 검증에서 현재 상태를 들여다보기 위한 창구
Object.assign(window, {
  __live: {
    get frame() {
      return lastFrame;
    },
    get stats() {
      return director.stats;
    },
    /** 표정을 직접 예약해 볼 때 쓴다 */
    face,
    get simulating() {
      return simulation.running;
    },
    get ui() {
      return { ...state, mode: currentMode(), messages: messages.map(({ who, text, final }) => ({ who, text, final })) };
    },
    director,
    connection,
    get vrmMode() {
      return vrmRig?.mode ?? null;
    },
    get vrmMeta() {
      return vrm?.meta ?? null;
    },
    playFakeMic: () => playFakeMic?.(),
  },
});

init().catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)));
