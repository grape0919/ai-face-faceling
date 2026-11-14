import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LEVELS, VARIANTS, type Level } from '../face/cues';
import { FaceEngine, type FaceFrame } from '../face/engine';
import { ARKIT_52 } from '../face/mapping';
import { REGION_KEYS, regionSpec, topAction } from '../shared/regions';
import { SESSION_FORMAT, type Session } from '../shared/types';
import { SessionPlayer } from './player';
import { DogRig } from './rig-dog';
import { FacelingRig } from './rig-faceling';
import { RobotRig } from './rig-robot';
import { VrmRig } from './rig-vrm';

/** 직접 넣은 모델이 없을 때 쓰는 three-vrm 예제 모델. 시험용으로 실행 중에만 불러온다. */
const FALLBACK_VRM = 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';
const LOCAL_VRM = '/models/avatar.vrm';

/** 재생하는 동안 한 번이라도 움직인 blendshape */
const moved = new Set<string>();
const TURN_LABELS = { idle: '대기', listening: '듣는 중', thinking: '생각 중', speaking: '말하는 중' } as const;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const sessionName = params.get('session') ?? 'sample-ko';
const analyzerName = params.get('analyzer') ?? 'mock';
const sessionBase = `/sessions/${sessionName}`;

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
const lookTarget = new THREE.Object3D();
scene.add(lookTarget);

const player = new SessionPlayer();
let session: Session | null = null;
let engine: FaceEngine | null = null;
const AVATARS = ['faceling', 'robot', 'dog', 'vrm'] as const;
type Avatar = (typeof AVATARS)[number];
let avatar: Avatar = AVATARS.find((a) => a === params.get('avatar')) ?? 'faceling';
/** 코드로 그린 얼굴들. 처음 고를 때 만든다. */
const drawn: { faceling?: FacelingRig; robot?: RobotRig; dog?: DogRig } = {};
let vrmRig: VrmRig | null = null;
let rig: FacelingRig | RobotRig | DogRig | VrmRig | null = null;
let vrm: VRM | null = null;
let level: Level = (LEVELS.find((l) => l === params.get('level')) ?? 'L1') as Level;
let lastFrame: FaceFrame | null = null;
let recorder: MediaRecorder | null = null;

const setStatus = (text: string): void => void ($('status').textContent = text);
const setError = (err: unknown): void => {
  $('error').textContent = err instanceof Error ? err.message : String(err);
};

async function loadVrm(source: string): Promise<void> {
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

  // 머리를 화면 가운데에 두고 어깨까지 보이게 잡는다
  const head = new THREE.Vector3();
  vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(head);
  camera.position.set(head.x, head.y + 0.04, head.z + 1.15);
  camera.lookAt(head.x, head.y + 0.03, head.z);
  vrmRig = new VrmRig(vrm, lookTarget, { x: camera.position.x, y: camera.position.y, z: camera.position.z });
  avatar = 'vrm';
  showAvatar();
}

/** 고른 얼굴만 장면에 보이게 하고 카메라를 맞춘다. */
function showAvatar(): void {
  if (avatar === 'faceling') {
    if (!drawn.faceling) scene.add((drawn.faceling = new FacelingRig()).object);
    const c = drawn.faceling.headCenter;
    camera.position.set(c.x, c.y, c.z + 1.35);
    camera.lookAt(c);
    rig = drawn.faceling;
  } else if (avatar === 'robot') {
    if (!drawn.robot) scene.add((drawn.robot = new RobotRig()).object);
    const c = drawn.robot.headCenter;
    camera.position.set(c.x, c.y + 0.02, c.z + 1.35);
    camera.lookAt(c.x, c.y - 0.03, c.z);
    rig = drawn.robot;
  } else if (avatar === 'dog') {
    if (!drawn.dog) scene.add((drawn.dog = new DogRig()).object);
    const c = drawn.dog.headCenter;
    camera.position.set(c.x, c.y, c.z + 1.35);
    camera.lookAt(c);
    rig = drawn.dog;
  } else if (vrm && vrmRig) {
    const head = new THREE.Vector3();
    vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(head);
    camera.position.set(head.x, head.y + 0.04, head.z + 1.15);
    camera.lookAt(head.x, head.y + 0.03, head.z);
    rig = vrmRig;
  }
  if (drawn.faceling) drawn.faceling.object.visible = avatar === 'faceling';
  if (drawn.robot) drawn.robot.object.visible = avatar === 'robot';
  if (drawn.dog) drawn.dog.object.visible = avatar === 'dog';
  if (vrm) vrm.scene.visible = avatar === 'vrm';
  for (const button of $('avatars').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.avatar === avatar));
  }
  moved.clear();
  refreshStatus();
}

async function setAvatar(next: Avatar): Promise<void> {
  avatar = next;
  if (next === 'vrm' && !vrm) await loadVrm(await pickDefaultVrm());
  else showAvatar();
}

async function pickDefaultVrm(): Promise<string> {
  try {
    const res = await fetch(LOCAL_VRM, { method: 'HEAD' });
    if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return LOCAL_VRM;
  } catch {
    // 로컬 모델이 없으면 예제 모델을 쓴다
  }
  return FALLBACK_VRM;
}

function refreshStatus(): void {
  if (!session) return;
  const segments = session.turns.reduce((n, t) => n + t.segments.length, 0);
  const notes = { faceling: '코드로 그린 Faceling 얼굴', robot: '코드로 그린 로봇 얼굴', dog: '코드로 그린 강아지 얼굴', arkit: 'ARKit 표정 모델', preset: 'VRM 표준 표정 모델(표현력 제한)' };
  const rigNote = rig ? notes[rig.mode] : '모델 불러오는 중';
  setStatus(`분석 ${session.analyzer}, 정렬 ${session.aligner}, 구간 ${segments}개. ${rigNote}`);
}

function setLevel(next: Level): void {
  level = next;
  if (session) engine = new FaceEngine(session, level);
  for (const button of $('levels').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.level === level));
  }
}

function buildDimRows(): void {
  $('dims').innerHTML = REGION_KEYS.map(
    (r) => `<span>${regionSpec(r).label}</span><div class="bar"><i data-dim="${r}"></i></div><span data-val="${r}">-</span>`,
  ).join('');
}

const actionLabel = (region: (typeof REGION_KEYS)[number], action: string): string =>
  regionSpec(region).actions[action]?.label ?? action;

function showDebug(frame: FaceFrame): void {
  // 부위마다 지금 얼굴에 가장 세게 걸린 동작
  for (const region of REGION_KEYS) {
    let best = { action: '', side: '', w: 0 };
    for (const v of VARIANTS) {
      const w = frame.debug.weights[v.key] ?? 0;
      if (v.region === region && w > best.w) best = { action: v.action, side: v.side ? (v.side === 'L' ? ' 왼' : ' 오') : '', w };
    }
    const bar = document.querySelector<HTMLElement>(`[data-dim="${region}"]`);
    const val = document.querySelector<HTMLElement>(`[data-val="${region}"]`);
    if (bar) bar.style.width = `${Math.min(1, best.w) * 100}%`;
    if (val) val.textContent = best.w > 0.03 ? `${actionLabel(region, best.action)}${best.side} ${best.w.toFixed(2)}` : '-';
  }

  // 지금 구간에 대해 분석기가 고른 것
  const seg = frame.debug.segment;
  $('judged').textContent = seg
    ? `${frame.debug.cue?.kind === 'react' ? '듣는 반응' : '말하는 표정'} · 세기 ${seg.judgment.intensity.toFixed(2)} · ` +
      REGION_KEYS.map((r) => {
        const top = topAction(seg.judgment.regions[r]);
        return `${regionSpec(r).label} ${actionLabel(r, top.action)} ${Math.round(top.p * 100)}%`;
      }).join(', ')
    : '';

  for (const [name, value] of Object.entries(frame.shapes)) if (value > 0.03) moved.add(name);
  const model = rig ? `, 모델이 가진 것 ${rig.supported.length}개` : '';
  $('usage').textContent = `지금까지 움직인 blendshape ${moved.size} / ${ARKIT_52.length}개${model}`;
}

function showCaption(t: number, frame: FaceFrame): void {
  const turn = session?.turns.find((x) => t >= x.start && t < x.end);
  const seg = turn?.segments.find((s) => t >= s.start && t < s.end);
  const who = turn ? (turn.speaker === 'assistant' ? 'AI' : '사용자') : TURN_LABELS[frame.debug.turn];
  $('caption').innerHTML = `<b>${who}</b>${seg ? escapeHtml(seg.text) : ''}`;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

function stopRecording(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  $<HTMLButtonElement>('record').textContent = '처음부터 녹화';
}

async function startRecording(): Promise<void> {
  if (!session) return;
  const stream = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...player.recordOut.stream.getAudioTracks(),
  ]);
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { videoBitsPerSecond: 4_000_000 });
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
    a.download = `${sessionName}-${analyzerName}-${avatar}-${level}.webm`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  recorder = rec;
  setLevel(level);
  rec.start();
  await player.play(0);
  $<HTMLButtonElement>('record').textContent = '녹화 중지';
  $<HTMLButtonElement>('play').textContent = '정지';
}

const clock = new THREE.Clock();
function tick(): void {
  requestAnimationFrame(tick);
  const dt = clock.getDelta();
  if (!session || !engine) return;

  let t = player.time;
  if (player.playing && t >= session.duration) {
    player.seek(0);
    stopRecording();
    $<HTMLButtonElement>('play').textContent = '재생';
    t = 0;
  }
  const frame = engine.update(Math.max(0, t), player.playing ? player.mouth() : null);
  lastFrame = frame;
  rig?.apply(frame);
  if (avatar === 'robot') drawn.robot?.setLamp(frame.shapes.jawOpen ?? 0);
  else if (avatar === 'vrm') vrm?.update(dt);
  renderer.render(scene, camera);

  showDebug(frame);
  showCaption(t, frame);
  $('clock').textContent = `${Math.max(0, t).toFixed(1)} / ${session.duration.toFixed(1)}초`;
  const seek = $<HTMLInputElement>('seek');
  if (document.activeElement !== seek) seek.value = String(Math.max(0, t));
}

async function init(): Promise<void> {
  buildDimRows();
  setLevel(level);

  for (const button of $('levels').querySelectorAll('button')) {
    button.addEventListener('click', () => setLevel(button.dataset.level as Level));
  }
  for (const button of $('avatars').querySelectorAll('button')) {
    button.addEventListener('click', () => setAvatar(button.dataset.avatar as Avatar).catch(setError));
  }
  $('play').addEventListener('click', () => {
    if (player.playing) {
      player.stop();
      stopRecording();
      $('play').textContent = '재생';
    } else {
      void player.play(player.time >= (session?.duration ?? 0) ? 0 : player.time);
      $('play').textContent = '정지';
    }
  });
  $('record').addEventListener('click', () => {
    if (recorder) {
      player.stop();
      stopRecording();
      $('play').textContent = '재생';
    } else {
      startRecording().catch(setError);
    }
  });
  $<HTMLInputElement>('seek').addEventListener('input', (e) => {
    const t = Number((e.target as HTMLInputElement).value);
    const wasPlaying = player.playing;
    player.seek(t);
    if (wasPlaying) void player.play(t);
  });
  $<HTMLInputElement>('vrm').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) loadVrm(URL.createObjectURL(file)).catch(setError);
  });

  const res = await fetch(`${sessionBase}/session.${analyzerName}.json`);
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error(
      `세션 파일이 없습니다: ${sessionBase}/session.${analyzerName}.json\n` +
        `먼저 실행하세요: npm run lab:session -- ${sessionName} --analyzer ${analyzerName}`,
    );
  }
  session = (await res.json()) as Session;
  if (session.format !== SESSION_FORMAT) {
    session = null;
    throw new Error(
      `세션 파일이 예전 형식입니다. 다시 만드세요: npm run lab:session -- ${sessionName} --analyzer ${analyzerName}`,
    );
  }
  $('title').textContent = session.title;
  $<HTMLInputElement>('seek').max = String(session.duration);
  setLevel(level);
  refreshStatus();
  await player.load(session, sessionBase);
  tick();
  await setAvatar(avatar);
}

// 브라우저 콘솔과 자동 검증에서 현재 상태를 들여다보기 위한 창구
Object.assign(window, {
  __lab: {
    get frame() {
      return lastFrame;
    },
    get time() {
      return player.time;
    },
    get rigMode() {
      return rig?.mode ?? null;
    },
    get supported() {
      return rig?.supported ?? [];
    },
    get moved() {
      return [...moved];
    },
    seek: (t: number) => player.seek(t),
    setAvatar,
    /** 점검용: 엔진 대신 지정한 값으로 얼굴을 한 번 그린다 */
    pose: (shapes: Record<string, number>) => rig?.apply({ shapes, head: { pitch: 0, yaw: 0, roll: 0 }, gaze: { x: 0, y: 0 } }),
    setLevel,
  },
});

init().catch(setError);
