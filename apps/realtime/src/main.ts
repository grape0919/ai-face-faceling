import type { AnalyzerInput, Judgment } from '@faceling/core/judgment';
import type { TurnState } from '@faceling/core/compositor';
import { LiveDirector, LiveFace, type DirectorStats, type LiveFrame } from '@faceling/core/live';
import { REGION_KEYS, regionSpec, topAction, type Region } from '@faceling/core/regions';
import type { BodySpec } from '@faceling/core/body';
import { ArmRig, DogRig, FACE_BODY, FacelingRig, RobotRig, VrmRig } from '@faceling/rigs';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VARIANTS } from '@faceling/core/weights';
import * as THREE from 'three';
import { RealtimeConnection } from '@faceling/openai-realtime';
import { DEMO_LINES, Simulation } from './simulate';

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

// ── 얼굴 종류 ─────────────────────────────────────────────
const AVATARS = ['faceling', 'robot', 'dog', 'arm', 'vrm'] as const;
type Avatar = (typeof AVATARS)[number];
const AVATAR_INFO: Record<Avatar, { name: string; desc: string }> = {
  faceling: { name: '페이스링', desc: '로고와 같은 얼굴. 눈과 입만으로 표정을 지어요' },
  robot: { name: '로봇', desc: '화면에 눈과 입이 그려지는 작은 로봇' },
  dog: { name: '강아지', desc: '동그란 눈과 큰 귀를 가진 강아지' },
  arm: { name: '로봇팔', desc: '얼굴 없는 작업대 로봇팔. 몸짓으로 감정을 보여 줘요' },
  vrm: { name: '3D 모델', desc: 'VRM 3D 모델. 처음 고르면 예제 모델을 내려받아요' },
};
const isAvatar = (value: string | null): value is Avatar => AVATARS.includes(value as Avatar);
/** 그 캐릭터의 몸 명세. 리그가 선언한 것을 그대로 쓴다(3D 모델은 불러오기 전에도 얼굴 몸이다). */
const bodyOf = (avatar: Avatar): BodySpec => (avatar === 'vrm' ? (vrmRig?.body ?? FACE_BODY) : ensureRig(avatar).body);

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

/** 코드로 그린 얼굴들. 처음 고를 때 만든다. */
type DrawnAvatar = Exclude<Avatar, 'vrm'>;
const DRAWN: DrawnAvatar[] = ['faceling', 'robot', 'dog', 'arm'];
const rigs: { faceling?: FacelingRig; robot?: RobotRig; dog?: DogRig; arm?: ArmRig } = {};

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

async function loadVrm(source: string, label: string): Promise<void> {
  setStatus(`3D 모델을 불러오는 중입니다 (${label})`);
  state.loadingVrm = true;
  refresh();
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(source);
    const next = gltf.userData.vrm as VRM | undefined;
    if (!next) throw new Error('VRM 모델이 아닙니다');
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
    showModelInfo(label);
    setStatus(`3D 모델을 불러왔습니다 (${label})`);
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
      ? `ARKit 표정 ${vrmRig.supported.length}개를 가진 모델입니다. 표정이 모두 반영됩니다.`
      : '표준 표정(기쁨, 슬픔, 놀람 등)만 가진 모델이라 표정이 단순하게 보입니다. ARKit 표정을 가진 VRM 을 넣으면 로봇·강아지처럼 세밀하게 움직입니다.';
  $('model-info').textContent = `${name}${author ? ` (${author})` : ''}. ${ability}`;
}

function ensureRig(which: DrawnAvatar): FacelingRig | RobotRig | DogRig | ArmRig {
  if (which === 'arm') return rigs.arm ?? (scene.add((rigs.arm = new ArmRig()).object), rigs.arm);
  if (which === 'faceling') return rigs.faceling ?? (scene.add((rigs.faceling = new FacelingRig()).object), rigs.faceling);
  if (which === 'robot') return rigs.robot ?? (scene.add((rigs.robot = new RobotRig()).object), rigs.robot);
  return rigs.dog ?? (scene.add((rigs.dog = new DogRig()).object), rigs.dog);
}

/** 그 얼굴만 보이게 하고 카메라를 맞춘다 */
function frameAvatar(which: Avatar): void {
  if (which === 'vrm') {
    if (vrm) {
      const head = new THREE.Vector3();
      vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(head);
      camera.position.set(head.x, head.y + 0.04, head.z + 1.15);
      camera.lookAt(head.x, head.y + 0.02, head.z);
    }
  } else {
    const rig = ensureRig(which);
    const c = rig.headCenter;
    const distance = rig instanceof ArmRig ? rig.viewDistance : 1.35;
    camera.position.set(c.x, c.y + (which === 'robot' ? 0.02 : 0), c.z + distance);
    camera.lookAt(c.x, c.y - (which === 'robot' ? 0.03 : 0), c.z);
  }
  for (const drawn of DRAWN) if (rigs[drawn]) rigs[drawn].object.visible = which === drawn;
  if (vrm) vrm.scene.visible = which === 'vrm';
}

function showAvatar(next: Avatar): void {
  state.avatar = next;
  // 판단에 이 몸이 할 수 있는 움직임을 함께 묻는다. 무엇을 할 수 있는지는 리그가 선언한다.
  director.body = bodyOf(next);
  if (next === 'vrm' && !vrm && !vrmLoading) {
    vrmLoading = loadVrm(SAMPLE_VRM, 'three-vrm 예제 모델')
      .then(() => {
        if (state.avatar === 'vrm') frameAvatar('vrm');
      })
      .catch((err: unknown) => setNotice(`3D 모델을 불러오지 못했어요: ${err instanceof Error ? err.message : String(err)}`))
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

/** 절 하나의 판단을 서버를 거쳐 Jev 에 묻는다 */
async function judge(input: AnalyzerInput): Promise<Judgment> {
  const res = await fetch('/api/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 몸 명세는 이름만 보낸다. 설명은 서버가 가진 명세에서 나온다.
    body: JSON.stringify({ ...input, body: input.body?.name }),
  });
  const body = (await res.json()) as { judgment?: Judgment; error?: string };
  if (!res.ok || !body.judgment) {
    setNotice(body.error ?? '표정 판단 요청이 실패했어요');
    throw new Error(body.error ?? '판단 요청 실패');
  }
  return body.judgment;
}

const face = new LiveFace();
const director = new LiveDirector(face, { judge, clock, onStats: showStats });

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
  message.meta.textContent = `${AVATAR_INFO[state.avatar].name}${top ? ` · ${top}` : ''}`;
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
  $('messages').innerHTML = '<p class="empty">아직 나눈 말이 없어요.</p>';
  caption.who = '';
  caption.text = '';
}

// ── 연결 ──────────────────────────────────────────────────
const connection = new RealtimeConnection(director, {
  onStatus: setStatus,
  onCaption,
  onError: setNotice,
  onDropped: () => {
    state.conn = 'off';
    state.failed = true;
    setNotice('연결이 끊겼어요.');
    refresh();
  },
});
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
    runDemo(DEMO_LINES);
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
      setNotice('마이크를 쓸 수 없어 글로만 대화해요. 브라우저 주소창의 사이트 설정에서 마이크를 허용하면 다음 연결부터 쓸 수 있어요.');
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
  setStatus('연결을 끊었습니다');
  refresh();
}

function runDemo(lines: typeof DEMO_LINES): void {
  if (simulation.running || state.conn !== 'off') return;
  setNotice('');
  clearConversation();
  state.ended = false;
  setStatus('예시 대화를 재생하는 중입니다. 소리는 나지 않습니다.');
  demo = simulation.run(lines).then(() => {
    setStatus('예시 대화가 끝났습니다.');
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
const MODE_TEXT: Record<Mode, string> = {
  off: '연결 전',
  connecting: '연결하는 중…',
  waiting: '듣고 있어요',
  listening: '듣고 있어요',
  thinking: '생각 중…',
  speaking: '말하는 중',
  muted: '마이크가 꺼져 있어요',
  text: '메시지를 기다려요',
  demo: '예시 대화',
  error: '연결하지 못했어요',
};

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
  if (state.loadingVrm && state.avatar === 'vrm') return '3D 모델을 불러오는 중이에요…';
  switch (mode) {
    case 'waiting':
      return '“오늘 하루 어땠어?”처럼 편하게 말해 보세요';
    case 'muted':
      return '마이크를 켜거나 메시지를 입력하세요';
    case 'text':
      return '메시지를 입력해 말을 걸어 보세요';
    case 'connecting':
      return '연결하고 있어요. 마이크 허용 창이 뜨면 허용해 주세요.';
    case 'error':
      return '연결 상태를 확인하고 다시 시도해 주세요';
    case 'off':
      if (!state.config.openai) return 'OPENAI_API_KEY 가 없어 음성 대화는 할 수 없어요. 예시 대화로 표정이 움직이는 모습을 볼 수 있어요.';
      return state.ended ? '대화를 마쳤어요. 언제든 다시 시작할 수 있어요.' : '대화를 시작하면 얼굴이 듣고, 생각하고, 표정으로 반응해요';
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
  const signature = [mode, state.conn, state.screen, state.step, state.avatar, state.voice, showCaption ? caption.text : hint, connection.micEnabled, connection.listenOnly, simulation.running, Boolean(state.changing)].join('|');
  if (signature === lastRender) return;
  lastRender = signature;

  const body = document.body;
  body.dataset.screen = state.screen;
  body.dataset.step = String(state.step);
  body.dataset.conn = state.conn;
  body.dataset.mode = mode;
  body.dataset.change = state.changing ? 'on' : 'off';

  // 상태 칩, 자막
  $('status-text').textContent = MODE_TEXT[mode];
  const cap = $('caption');
  cap.textContent = showCaption ? caption.text : hint;
  cap.classList.toggle('hint', !showCaption);
  cap.dataset.who = showCaption ? caption.who : '';

  // 연결 전 버튼
  const start = $<HTMLButtonElement>('start');
  start.disabled = state.conn === 'connecting';
  $('start-label').textContent =
    state.conn === 'connecting'
      ? '연결하는 중…'
      : !state.config.openai
        ? simulation.running
          ? '예시 대화 멈춤'
          : '예시 대화 보기'
        : state.failed
          ? '다시 시도'
          : '대화 시작';
  $('start-text-2').hidden = !state.config.openai || state.conn === 'connecting';

  // 마이크
  const mic = $<HTMLButtonElement>('mic');
  mic.disabled = connection.listenOnly;
  mic.setAttribute('aria-pressed', String(!connection.listenOnly && connection.micEnabled));
  const micLabel = connection.listenOnly ? '마이크 없이 연결했어요. 종료한 뒤 다시 시작하면 켤 수 있어요.' : connection.micEnabled ? '마이크 끄기' : '마이크 켜기';
  mic.setAttribute('aria-label', micLabel);
  mic.title = micLabel;

  // 글 입력
  const input = $<HTMLInputElement>('say-text');
  input.disabled = !live;
  input.placeholder = live ? '메시지 입력' : '대화를 시작하면 글로도 말할 수 있어요';
  $<HTMLButtonElement>('say').disabled = !live;
  for (const b of $('suggestions').querySelectorAll('button')) b.disabled = !live;

  // 머리말
  $('avatar-name').textContent = AVATAR_INFO[state.avatar].name;
  fillThumb($('header-face'), state.avatar);
  updateTimer();

  renderOnboarding();
}

function updateTimer(): void {
  let text = '연결 전';
  if (state.conn === 'connecting') text = '연결하는 중';
  if (simulation.running) text = '● 예시 대화';
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

  const name = AVATAR_INFO[state.avatar].name;
  $('step-2-next').textContent = `${name}${ro(name)} ${state.changing ? '바꿀게요' : '할게요'}`;
  $('step-2-back').textContent = state.changing ? '취소' : '이전';

  const { openai, jev } = state.config;
  $('step-3-title').textContent = openai ? '목소리로 대화하려면' : '음성 대화 키가 없어요';
  $('step-3-desc').textContent = openai
    ? '마이크만 있으면 돼요. 음성과 대화 내용은 OpenAI(음성 대화)와 Jev(표정 판단)로 전송돼요. 이 예제 서버는 표정 판단 기록을 내 PC 의 logs 폴더에 남겨요.'
    : 'OPENAI_API_KEY 를 루트 .env 에 넣고 서버를 다시 시작하면 목소리로 대화할 수 있어요. 지금은 예시 대화로 표정이 움직이는 모습을 볼 수 있어요. 예시 대화의 글은 표정 판단을 위해 Jev 로 전송돼요.';
  $('perm-mic').hidden = !openai;
  $('perm-jev').hidden = jev;
  $('start-voice').textContent = openai ? '마이크 허용하고 대화 시작' : '예시 대화 보기';
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
      <div><b>${AVATAR_INFO[a].name}</b><span>${AVATAR_INFO[a].desc}</span></div>
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
    $('mic-state').textContent = { granted: '허용됨', denied: '거부됨', prompt: '대기' }[permission];
    $('mic-desc').textContent =
      permission === 'denied' ? '막혀 있어요 · 주소창의 사이트 설정에서 허용해 주세요' : '필수 · 말하면 바로 반응해요';
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
  const leadText = lead === null ? '-' : lead >= 0 ? `${ms(lead)} 먼저` : `${ms(-lead)} 늦게`;
  $('stats').innerHTML =
    `<span>판단한 절</span><b>${stats.judged}개</b>` +
    `<span>놓친 절</span><b>${stats.missed}개</b>` +
    `<span>Jev 응답 시간(평균)</span><b>${ms(stats.meanLatency)}</b>` +
    `<span>판단이 소리보다(평균)</span><b>${leadText}</b>` +
    `<span>응답 첫 절의 표정 지연(평균)</span><b>${ms(stats.meanFirstDelay)}</b>` +
    `<span>말 빠르기 추정</span><b>글자당 ${ms(stats.secondsPerChar)}</b>`;
}

function buildRegionRows(): void {
  $('dims').innerHTML = REGION_KEYS.map(
    (r) => `<span>${regionSpec(r).label}</span><div class="bar"><i data-dim="${r}"></i></div><span data-val="${r}">-</span>`,
  ).join('');
}

const actionLabel = (region: Region, action: string): string => regionSpec(region).actions[action]?.label ?? action;

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
  $('judged').textContent = cue
    ? `${cue.kind === 'react' ? '듣는 반응' : '말하는 표정'} · "${cue.text}" · ` +
      REGION_KEYS.map((r) => {
        const top = topAction(cue.judgment.regions[r]);
        return `${regionSpec(r).label} ${actionLabel(r, top.action)} ${Math.round(top.p * 100)}%`;
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
    const label = actionLabel(v.region, v.action);
    if (RESTING.has(label)) continue;
    best = { label: NEEDS_REGION.has(spec.label) && !label.includes(spec.label) ? `${spec.label} ${label}` : label, w };
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
  if (state.avatar === 'vrm') {
    vrmRig?.apply(frame);
    // 머리카락과 옷의 흔들림(스프링 본)도 여기서 움직인다
    vrm?.update(dt);
  } else {
    rigs[state.avatar]?.apply(frame);
    if (state.avatar === 'robot') rigs.robot?.setLamp(frame.shapes.jawOpen ?? 0);
  }
  renderer.render(scene, camera);
  showDebug(frame);
  showAction(frame, now);
  countAction(frame);
  refresh();
}

// ── 조작 연결 ─────────────────────────────────────────────
function bindControls(): void {
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
    if (state.conn === 'on') setStatus('목소리는 다음에 대화를 시작할 때 바뀝니다.');
  });
  $<HTMLInputElement>('vrm-file').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setNotice('');
    loadVrm(URL.createObjectURL(file), file.name)
      .then(() => showAvatar('vrm'))
      .catch((err: unknown) => setNotice(`3D 모델을 불러오지 못했어요: ${err instanceof Error ? err.message : String(err)}`));
  });
  $('sim-demo').addEventListener('click', () => runDemo(DEMO_LINES));
  $('sim-say').addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('sim-text').value.trim();
    if (text) runDemo([{ speaker: 'assistant', text }]);
  });
  $('sim-stop').addEventListener('click', () => simulation.stop());
}

async function init(): Promise<void> {
  buildRegionRows();
  showStats(director.stats);
  takeThumbnails();
  buildAvatarCards();
  showAvatar(state.avatar);
  bindControls();

  const savedLog = store.get('log');
  setLog(savedLog ? savedLog === 'on' : window.innerWidth >= 820);
  setDev(params.has('dev') || store.get('dev') === 'on');
  // 처음 왔으면 온보딩, 다시 왔으면 바로 대화 화면(연결은 사용자가 누를 때 한다)
  if (store.get('onboarded') === '1' && !params.has('onboarding')) state.screen = 'chat';
  tick();
  setInterval(updateTimer, 1000);

  const config = (await (await fetch('/api/config')).json()) as AppConfig;
  state.config = config;
  if (!config.voices.includes(state.voice)) state.voice = config.voice;
  $('voice').innerHTML = config.voices.map((v) => `<option value="${v}">${voiceLabel(v)}</option>`).join('');
  buildVoiceChips();
  if (!config.jev) setNotice('TYPESAFE_API_KEY 가 없어 표정 판단을 할 수 없어요. 루트의 .env 에 넣고 서버를 다시 시작하세요.');
  setStatus(config.openai ? `준비됨 (${config.model})` : 'OPENAI_API_KEY 가 없어 음성 대화는 할 수 없습니다.');
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
