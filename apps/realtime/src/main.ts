import type { AnalyzerInput, Judgment } from '@faceling/core/judgment';
import { LiveDirector, LiveFace, type DirectorStats, type LiveFrame } from '@faceling/core/live';
import { REGION_KEYS, regionSpec, topAction, type Region } from '@faceling/core/regions';
import { DogRig } from '@faceling/core/rigs/dog';
import { RobotRig } from '@faceling/core/rigs/robot';
import { VARIANTS } from '@faceling/core/weights';
import * as THREE from 'three';
import { RealtimeConnection } from './realtime';
import { DEMO_LINES, Simulation } from './simulate';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const TURN_LABELS = { idle: '대기', listening: '듣는 중', thinking: '생각 중', speaking: '말하는 중' } as const;

// ── 화면 ──────────────────────────────────────────────────
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

type Avatar = 'robot' | 'dog';
const rigs: { robot?: RobotRig; dog?: DogRig } = {};
let avatar: Avatar = new URLSearchParams(location.search).get('avatar') === 'dog' ? 'dog' : 'robot';

function showAvatar(next: Avatar): void {
  avatar = next;
  if (next === 'robot' && !rigs.robot) scene.add((rigs.robot = new RobotRig()).object);
  if (next === 'dog' && !rigs.dog) scene.add((rigs.dog = new DogRig()).object);
  const rig = rigs[next];
  if (!rig) return;
  const c = rig.headCenter;
  camera.position.set(c.x, c.y + (next === 'robot' ? 0.02 : 0), c.z + 1.35);
  camera.lookAt(c.x, c.y - (next === 'robot' ? 0.03 : 0), c.z);
  if (rigs.robot) rigs.robot.object.visible = next === 'robot';
  if (rigs.dog) rigs.dog.object.visible = next === 'dog';
  for (const button of $('avatars').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.avatar === next));
  }
}

// ── 표정 엔진 ─────────────────────────────────────────────
const clock = (): number => performance.now() / 1000;

/** 절 하나의 판단을 서버를 거쳐 Jev 에 묻는다 */
async function judge(input: AnalyzerInput): Promise<Judgment> {
  const res = await fetch('/api/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { judgment?: Judgment; error?: string };
  if (!res.ok || !body.judgment) {
    setError(body.error ?? '판단 요청 실패');
    throw new Error(body.error ?? '판단 요청 실패');
  }
  return body.judgment;
}

const face = new LiveFace();
const director = new LiveDirector(face, { judge, clock, onStats: showStats });

const setStatus = (text: string): void => void ($('status').textContent = text);
const setError = (message: string): void => void ($('error').textContent = message);

const captions = { user: '', assistant: '' };
function onCaption(who: 'user' | 'assistant', text: string): void {
  captions[who] = text;
  $('line-user').textContent = captions.user;
  $('line-assistant').textContent = captions.assistant;
  // 대화가 시작되면 소개 문구를 치운다
  document.body.dataset.talk = captions.user || captions.assistant ? 'on' : 'off';
}

const connection = new RealtimeConnection(director, { onStatus: setStatus, onCaption, onError: setError });
const simulation = new Simulation(director, onCaption);

// ── 표시 ──────────────────────────────────────────────────
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
  // 턴 상태는 글자와 함께 화면 테두리 색으로도 보여 준다
  if (document.body.dataset.turn !== frame.debug.turn) {
    document.body.dataset.turn = frame.debug.turn;
    $('turn').textContent = TURN_LABELS[frame.debug.turn];
  }
}

// ── 매 프레임 ─────────────────────────────────────────────
let lastFrame: LiveFrame | null = null;
function tick(): void {
  requestAnimationFrame(tick);
  const mouth = simulation.running ? simulation.mouth() : connection.mouth();
  const frame = face.update(clock(), mouth);
  lastFrame = frame;
  const rig = rigs[avatar];
  rig?.apply(frame);
  if (avatar === 'robot') rigs.robot?.setLamp(frame.shapes.jawOpen ?? 0);
  renderer.render(scene, camera);
  showDebug(frame);
}

// ── 시험용 마이크 ─────────────────────────────────────────
// 주소에 ?fakeMic=/dev/파일.wav 를 붙이면 마이크 대신 그 소리를 보낸다. 마이크 없이 음성 경로를 시험할 때 쓴다.
const fakeMicUrl = new URLSearchParams(location.search).get('fakeMic');
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

// ── 조작 ──────────────────────────────────────────────────
/** 연결된 동안에만 쓸 수 있는 버튼들 */
function setLiveButtons(on: boolean): void {
  for (const id of ['speak-first', 'interrupt', 'say']) $<HTMLButtonElement>(id).disabled = !on;
  document.body.dataset.live = on ? 'on' : 'off';
  $('connect-label').textContent = on ? '대화 끝내기' : '대화 시작';
}

/** "안쪽 보기": 표정이 어떻게 정해지는지 보여 주는 칸. 넓은 화면에서는 처음부터 열어 둔다. */
function setInspector(on: boolean): void {
  document.body.dataset.inspect = on ? 'on' : 'off';
  $('inspect-toggle').setAttribute('aria-pressed', String(on));
  localStorage.setItem('faceling.inspect', on ? 'on' : 'off');
}

async function init(): Promise<void> {
  buildRegionRows();
  showStats(director.stats);
  showAvatar(avatar);
  tick();

  for (const button of $('avatars').querySelectorAll('button')) {
    button.addEventListener('click', () => showAvatar(button.dataset.avatar as Avatar));
  }

  const connectButton = $<HTMLButtonElement>('connect');
  connectButton.addEventListener('click', () => {
    setError('');
    if (connection.connected) {
      connection.disconnect();
      setLiveButtons(false);
      setStatus('연결을 끊었습니다');
      return;
    }
    simulation.stop();
    connectButton.disabled = true;
    $('connect-label').textContent = '연결하는 중';
    connection
      .connect({
        voice: $<HTMLSelectElement>('voice').value,
        liveReactions: $<HTMLInputElement>('live-reactions').checked,
        micOverride: fakeMicUrl ? () => fakeMic(fakeMicUrl) : undefined,
      })
      .then(() => setLiveButtons(true))
      .catch((err: unknown) => {
        connection.disconnect();
        setLiveButtons(false);
        setStatus('연결하지 못했습니다');
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => (connectButton.disabled = false));
  });

  $('speak-first').addEventListener('click', () => connection.speakFirst());
  $('interrupt').addEventListener('click', () => connection.interrupt());
  $('say-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const box = $<HTMLInputElement>('say-text');
    connection.sendText(box.value);
    box.value = '';
  });

  const savedInspect = localStorage.getItem('faceling.inspect');
  setInspector(savedInspect ? savedInspect === 'on' : window.innerWidth >= 1100);
  $('inspect-toggle').addEventListener('click', () => setInspector(document.body.dataset.inspect !== 'on'));

  const runSim = (lines: typeof DEMO_LINES): void => {
    if (simulation.running || connection.connected) return;
    setError('');
    setStatus('예시 대화를 재생하는 중입니다. 소리는 나지 않습니다.');
    void simulation.run(lines).then(() => setStatus('예시 대화가 끝났습니다.'));
  };
  $('sim-demo').addEventListener('click', () => runSim(DEMO_LINES));
  $('sim-say').addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('sim-text').value.trim();
    if (text) runSim([{ speaker: 'assistant', text }]);
  });
  $('sim-stop').addEventListener('click', () => simulation.stop());

  const config = (await (await fetch('/api/config')).json()) as {
    openai: boolean;
    jev: boolean;
    model: string;
    voice: string;
    voices: string[];
  };
  const saved = localStorage.getItem('faceling.voice');
  const voiceSelect = $<HTMLSelectElement>('voice');
  voiceSelect.innerHTML = config.voices.map((v) => `<option>${v}</option>`).join('');
  voiceSelect.value = saved && config.voices.includes(saved) ? saved : config.voice;
  voiceSelect.addEventListener('change', () => {
    localStorage.setItem('faceling.voice', voiceSelect.value);
    if (connection.connected) setStatus('목소리는 다음에 대화를 시작할 때 바뀝니다.');
  });
  if (!config.jev) setError('TYPESAFE_API_KEY 가 없습니다. 루트의 .env 에 넣고 서버를 다시 시작하세요.');
  connectButton.disabled = !config.openai;
  setStatus(
    config.openai
      ? '"대화 시작"을 누르고 마이크를 허용하세요.'
      : 'OPENAI_API_KEY 가 없어 음성 대화는 할 수 없습니다. "소리 없이 맛보기"로 표정을 볼 수 있습니다.',
  );
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
    get simulating() {
      return simulation.running;
    },
    director,
    connection,
    playFakeMic: () => playFakeMic?.(),
  },
});

init().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
