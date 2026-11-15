import * as THREE from 'three';
import { ARKIT_52, type FacePose } from '@faceling/core/mapping';
import { DOG_BODY } from './bodies.js';
import type { Rig } from './rig.js';

/**
 * 코드로 그린 강아지 얼굴. 전체를 2D 그림으로 그리고, 머리 회전은 이목구비를 밀어 주는 방식으로 흉내 낸다.
 * ARKit 52개 값을 모두 직접 받아 눈, 눈썹, 볼, 코, 입, 혀의 모양을 매 프레임 다시 그린다.
 * 귀는 ARKit 에 없는 부위라서 눈썹과 눈 값에 따라 쫑긋 서거나 처진다.
 * Left 는 캐릭터 기준 왼쪽이므로 화면에서는 오른쪽에 그려진다.
 */

const SIZE = 1024;
const CX = SIZE / 2;
/** 머리가 기울 때의 축(목)과 머리 중심의 높이 */
const NECK_Y = 780;
const HEAD_UP = 310;

const COLOR = {
  fur: '#e6ad5c',
  lid: '#dba04f',
  ear: '#9a6030',
  earInner: '#b97a44',
  cream: '#fff2dc',
  line: '#4a2f1b',
  nose: '#2b2320',
  white: '#ffffff',
  pupil: '#2a1c12',
  blush: '#ff8fa3',
  inside: '#5a1a26',
  tongue: '#ff7a90',
  tongueLine: '#d9516b',
  collar: '#d6453d',
  tag: '#f2c94c',
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type Side = 'Left' | 'Right';
const SIDES: Side[] = ['Left', 'Right'];
/** 화면 x 방향. 캐릭터의 왼쪽은 화면 오른쪽(+x). */
const dir = (side: Side): number => (side === 'Left' ? 1 : -1);

export class DogRig implements Rig {
  readonly mode = 'dog' as const;
  /** 이 몸이 할 수 있는 움직임. LiveDirector.body 에 넣는다. */
  readonly body = DOG_BODY;
  readonly supported: string[] = [...ARKIT_52];
  readonly object = new THREE.Group();
  /** 카메라가 바라볼 중심 */
  readonly headCenter = new THREE.Vector3(0, 1.45, 0);

  /** 얼굴이 화면에 꽉 차는 카메라 위치 */
  get view(): { position: THREE.Vector3; target: THREE.Vector3 } {
    const c = this.headCenter;
    return { position: new THREE.Vector3(c.x, c.y, c.z + 1.35), target: c.clone() };
  }

  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private shapes: Record<string, number> = {};
  /** 이목구비가 머리 위에서 밀리는 양(px). 머리를 돌리는 느낌을 낸다. */
  private fx = 0;
  private fy = 0;

  constructor() {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    // 카메라 시야를 꽉 채우는 평면 한 장
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    plane.position.copy(this.headCenter);
    this.object.add(plane);
    this.apply({ shapes: {}, head: { pitch: 0, yaw: 0, roll: 0 }, gaze: { x: 0, y: 0 } });
  }

  apply(pose: FacePose): void {
    this.shapes = pose.shapes;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, SIZE, SIZE);
    c.lineJoin = 'round';
    c.lineCap = 'round';

    this.drawBody();

    // 머리: 목을 축으로 기울고, 돌리거나 숙이면 조금 따라 움직인다
    this.fx = pose.head.yaw * 300;
    this.fy = pose.head.pitch * 300;
    c.translate(CX, NECK_Y);
    c.rotate(-pose.head.roll * 1.5);
    c.translate(this.fx * 0.35, -HEAD_UP + this.fy * 0.45);

    for (const side of SIDES) this.drawEar(side);
    this.drawHead();
    this.drawCheeks();
    for (const side of SIDES) {
      this.drawEye(side);
      this.drawBrow(side);
    }
    this.drawMouth();
    this.drawNose();

    c.setTransform(1, 0, 0, 1, 0, 0);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private v(name: string): number {
    return clamp01(this.shapes[name] ?? 0);
  }
  private both(base: string): number {
    return (this.v(`${base}Left`) + this.v(`${base}Right`)) / 2;
  }

  private outline(width = 7): void {
    this.ctx.strokeStyle = COLOR.line;
    this.ctx.lineWidth = width;
    this.ctx.stroke();
  }

  private drawBody(): void {
    const c = this.ctx;
    c.fillStyle = COLOR.fur;
    c.beginPath();
    c.ellipse(CX, 1040, 330, 250, 0, 0, Math.PI * 2);
    c.fill();
    this.outline();
    c.fillStyle = COLOR.cream;
    c.beginPath();
    c.ellipse(CX, 1060, 170, 200, 0, 0, Math.PI * 2);
    c.fill();

    // 목줄과 이름표
    c.strokeStyle = COLOR.collar;
    c.lineWidth = 34;
    c.beginPath();
    c.moveTo(CX - 190, 842);
    c.quadraticCurveTo(CX, 900, CX + 190, 842);
    c.stroke();
    c.fillStyle = COLOR.tag;
    c.beginPath();
    c.arc(CX, 900, 26, 0, Math.PI * 2);
    c.fill();
    this.outline(5);
  }

  private drawEar(side: Side): void {
    const c = this.ctx;
    const d = dir(side);
    // 놀라거나 관심이 생기면 쫑긋 서고, 걱정하거나 미안하면 처진다
    // 부위별 수치 판단에서는 귀 채널(earsUp, earsDown)이 직접 온다: 기분에 따라서도, "귀 움직여 봐"에도.
    const lift = clamp01(this.v(`browOuterUp${side}`) * 0.7 + this.v(`eyeWide${side}`) * 0.6 + this.v('earsUp'));
    const droop = clamp01(this.v('browInnerUp') * 0.7 + this.v(`browDown${side}`) * 0.4 - lift + this.v('earsDown') * 1.6);
    const angle = -d * (0.32 + lift * 0.95 - droop * 0.25);

    c.save();
    c.translate(d * 228 - this.fx * 0.25, -150 - this.fy * 0.2 + droop * 18);
    c.rotate(angle);
    c.fillStyle = COLOR.ear;
    c.beginPath();
    c.ellipse(0, 150, 92, 180, 0, 0, Math.PI * 2);
    c.fill();
    this.outline();
    c.fillStyle = COLOR.earInner;
    c.beginPath();
    c.ellipse(-d * 12, 165, 46, 120, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private drawHead(): void {
    const c = this.ctx;
    const puff = this.v('cheekPuff');
    c.fillStyle = COLOR.fur;
    c.beginPath();
    c.ellipse(0, 0, 300 + puff * 14, 268, 0, 0, Math.PI * 2);
    c.fill();
    this.outline();

    // 이마에서 주둥이로 이어지는 밝은 무늬
    c.save();
    c.beginPath();
    c.ellipse(0, 0, 296 + puff * 14, 264, 0, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = COLOR.cream;
    c.beginPath();
    c.ellipse(this.fx * 0.8, -150 + this.fy * 0.6, 46, 150, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(this.fx, 150 + this.fy, 190 + puff * 40, 150 + puff * 12, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private drawCheeks(): void {
    const c = this.ctx;
    const puff = this.v('cheekPuff');
    for (const side of SIDES) {
      const d = dir(side);
      const squint = this.v(`cheekSquint${side}`);
      const smile = this.v(`mouthSmile${side}`);
      c.globalAlpha = clamp01(0.12 + 0.5 * squint + 0.2 * smile + 0.45 * puff);
      c.fillStyle = COLOR.blush;
      c.beginPath();
      c.ellipse(d * (212 + puff * 16) + this.fx, 62 + this.fy - squint * 24, 50 * (1 + 0.5 * puff), 32 * (1 + 0.5 * puff), 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  private drawEye(side: Side): void {
    const c = this.ctx;
    const d = dir(side);
    const blink = this.v(`eyeBlink${side}`);
    const wide = this.v(`eyeWide${side}`);
    const squint = this.v(`eyeSquint${side}`);
    const cheek = this.v(`cheekSquint${side}`);
    const browDown = this.v(`browDown${side}`);
    const innerUp = this.v('browInnerUp');
    // 캐릭터 왼쪽을 볼 때 +
    const lookX = side === 'Left' ? this.v('eyeLookOutLeft') - this.v('eyeLookInLeft') : this.v('eyeLookInRight') - this.v('eyeLookOutRight');
    const lookY = this.v(`eyeLookUp${side}`) - this.v(`eyeLookDown${side}`);

    const rx = 56;
    const ry = 66 * (1 + 0.2 * wide);
    const x = d * 128 + this.fx + lookX * 6;
    const y = -52 + this.fy - lookY * 5;

    // 눈꺼풀. 위는 직선(안쪽과 바깥쪽 높이가 다를 수 있다), 아래는 가운데가 솟는 곡선.
    const closedY = ry * 0.2;
    let top = lerp(-ry - 6, closedY - 4, blink) + squint * ry * 0.28;
    let bottom = lerp(ry + 6, closedY + 4, blink) - squint * ry * 0.42;
    if (bottom - top < 8) {
      const mid = (top + bottom) / 2;
      top = mid - 4;
      bottom = mid + 4;
    }
    const room = bottom - top;
    const topInner = top + Math.min(room * 0.7, browDown * ry * 0.75);
    const topOuter = top + Math.min(room * 0.6, innerUp * ry * 0.4);
    const arch = Math.min(room * 0.9, cheek * ry * 0.95) * (1 - blink);
    const xInner = x - d * (rx + 8);
    const xOuter = x + d * (rx + 8);
    const opening = (): void => {
      c.beginPath();
      c.moveTo(xInner, y + topInner);
      c.lineTo(xOuter, y + topOuter);
      c.lineTo(xOuter, y + bottom);
      c.quadraticCurveTo(x, y + bottom - arch * 2, xInner, y + bottom);
      c.closePath();
    };

    c.save();
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.clip();
    // 눈꺼풀 색으로 덮은 뒤 뜬 부분만 흰자를 그린다
    c.fillStyle = COLOR.lid;
    c.fillRect(x - rx - 12, y - ry - 12, rx * 2 + 24, ry * 2 + 24);
    c.save();
    opening();
    c.fillStyle = COLOR.white;
    c.fill();
    c.clip();

    // 눈동자. 눈웃음으로 눈이 초승달이 되어도 보이는 띠 안에 남는다.
    const bandTop = (topInner + topOuter) / 2;
    const bandBottom = bottom - arch;
    const band = bandBottom - bandTop;
    const pr = band > 14 ? Math.min(38 * (1 - 0.15 * wide), band * 0.44) : 0;
    if (pr > 0) {
      const px = x + lookX * 18;
      const py = y + Math.max(bandTop + pr * 0.6, Math.min(4 - lookY * 22, bandBottom - pr * 0.85));
      c.fillStyle = COLOR.pupil;
      c.beginPath();
      c.arc(px, py, pr, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = COLOR.white;
      c.beginPath();
      c.arc(px + pr * 0.36, py - pr * 0.4, pr * 0.3, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(px - pr * 0.4, py + pr * 0.36, pr * 0.14, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    opening();
    this.outline(6);
    c.restore();

    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    this.outline(6);
  }

  private drawBrow(side: Side): void {
    const c = this.ctx;
    const d = dir(side);
    const down = this.v(`browDown${side}`);
    const outerUp = this.v(`browOuterUp${side}`);
    const innerUp = this.v('browInnerUp');
    const wide = this.v(`eyeWide${side}`);

    const x = d * 128 + this.fx * 0.95;
    const base = -150 + this.fy * 0.9 - wide * 8;
    const yInner = base - innerUp * 34 + down * 40;
    const yOuter = base - outerUp * 34 + down * 8 + innerUp * 12;

    c.strokeStyle = COLOR.line;
    c.lineWidth = 18;
    c.beginPath();
    c.moveTo(x - d * 48, yInner);
    c.quadraticCurveTo(x, (yInner + yOuter) / 2 - 10 + down * 8, x + d * 54, yOuter);
    c.stroke();
  }

  private drawNose(): void {
    const c = this.ctx;
    const sneer = this.both('noseSneer');
    const x = this.fx * 1.25;
    const y = 78 + this.fy * 1.2 - sneer * 12;

    c.fillStyle = COLOR.nose;
    c.beginPath();
    c.moveTo(x - 46, y - 14);
    c.quadraticCurveTo(x, y - 34, x + 46, y - 14);
    c.quadraticCurveTo(x + 40, y + 26, x, y + 34);
    c.quadraticCurveTo(x - 40, y + 26, x - 46, y - 14);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath();
    c.ellipse(x - 14, y - 12, 13, 6, -0.3, 0, Math.PI * 2);
    c.fill();

    // 코를 찡그리면 콧등 양쪽에 주름이 잡힌다
    c.strokeStyle = COLOR.line;
    c.lineWidth = 6;
    for (const side of SIDES) {
      const a = this.v(`noseSneer${side}`);
      if (a < 0.05) continue;
      const d = dir(side);
      c.globalAlpha = a;
      for (const k of [0, 1]) {
        c.beginPath();
        c.moveTo(x + d * (34 + k * 16), y - 62 - k * 8);
        c.quadraticCurveTo(x + d * (52 + k * 16), y - 50, x + d * (56 + k * 16), y - 30);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }

  private drawMouth(): void {
    const c = this.ctx;
    const smile = this.both('mouthSmile');
    const stretch = this.both('mouthStretch');
    const press = this.both('mouthPress');
    const upperUp = this.both('mouthUpperUp');
    const lowerDown = this.both('mouthLowerDown');
    const sneer = this.both('noseSneer');
    const pucker = this.v('mouthPucker');
    const funnel = this.v('mouthFunnel');
    const jaw = this.v('jawOpen');
    const close = this.v('mouthClose');
    const rollU = this.v('mouthRollUpper');
    const rollL = this.v('mouthRollLower');
    const shrugU = this.v('mouthShrugUpper');
    const shrugL = this.v('mouthShrugLower');
    const forward = this.v('jawForward');
    const tongue = this.v('tongueOut');

    const half = 108 * Math.max(0.25, 1 + 0.22 * smile + 0.25 * stretch - 0.5 * pucker - 0.28 * funnel - 0.1 * press);
    const mx = this.fx * 1.25 + (this.v('mouthLeft') - this.v('mouthRight')) * 34 + (this.v('jawLeft') - this.v('jawRight')) * 20;
    // 코 아래에서 내려온 선이 갈라지는 점
    const my = 150 + this.fy * 1.2 - upperUp * 8 - shrugU * 8;

    const corner = (side: Side): { x: number; y: number; cx: number; cy: number } => {
      const s = this.v(`mouthSmile${side}`);
      const f = this.v(`mouthFrown${side}`);
      const st = this.v(`mouthStretch${side}`);
      const d = dir(side);
      return {
        x: mx + d * half * (1 + 0.12 * s + 0.1 * st),
        y: my + 8 - s * 44 + f * 40 + st * 6,
        // 윗입술 곡선이 아래로 불룩한 정도. 다물거나 찡그리면 펴진다.
        cx: mx + d * half * 0.55,
        cy: my + 40 + s * 12 - f * 26 - press * 16 - (rollU + rollL) * 6,
      };
    };
    const l = corner('Left');
    const r = corner('Right');

    const open = Math.max(
      0,
      jaw * 120 * (1 - 0.85 * close) + lowerDown * 22 + funnel * 40 + pucker * 16 - press * 10 - (rollU + rollL) * 6,
    );
    const lowerMid = my + 34 + open + forward * 6 - shrugL * 8;
    const lowerCtrl = 2 * lowerMid - (l.y + r.y) / 2;

    // 코에서 내려오는 선
    c.strokeStyle = COLOR.line;
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(this.fx * 1.25, 100 + this.fy * 1.2);
    c.lineTo(mx, my);
    c.stroke();

    const upperLip = (): void => {
      c.moveTo(r.x, r.y);
      c.quadraticCurveTo(r.cx, r.cy, mx, my);
      c.quadraticCurveTo(l.cx, l.cy, l.x, l.y);
    };

    if (open > 3) {
      c.save();
      c.beginPath();
      upperLip();
      c.quadraticCurveTo(mx, lowerCtrl, r.x, r.y);
      c.closePath();
      c.fillStyle = COLOR.inside;
      c.fill();
      c.clip();
      if (tongue < 0.05) {
        c.fillStyle = COLOR.tongue;
        c.beginPath();
        c.ellipse(mx, lowerMid + 4, half * 0.6, Math.max(10, open * 0.55), 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      c.beginPath();
      c.moveTo(l.x, l.y);
      c.quadraticCurveTo(mx, lowerCtrl, r.x, r.y);
      this.outline();
    }

    // 윗입술을 들거나 코를 찡그리면 송곳니가 보인다
    const fang = clamp01(upperUp * 1.4 + sneer * 0.8);
    if (fang > 0.1) {
      c.fillStyle = COLOR.white;
      for (const d of [-1, 1]) {
        const fxp = mx + d * half * 0.42;
        c.beginPath();
        c.moveTo(fxp - 11, my + 30);
        c.lineTo(fxp + 11, my + 30);
        c.lineTo(fxp, my + 30 + 24 * fang);
        c.closePath();
        c.fill();
        this.outline(4);
      }
    }

    c.beginPath();
    upperLip();
    this.outline(Math.max(5, 8 - 2 * press - (rollU + rollL)));

    // 혀를 내밀면 입 아래로 늘어진다
    if (tongue > 0.05) {
      const ty = Math.max(my + 36, lowerMid - 6);
      const len = 30 + tongue * 70;
      c.fillStyle = COLOR.tongue;
      c.beginPath();
      c.moveTo(mx - 36, ty);
      c.lineTo(mx + 36, ty);
      c.quadraticCurveTo(mx + 40, ty + len, mx, ty + len + 8);
      c.quadraticCurveTo(mx - 40, ty + len, mx - 36, ty);
      c.fill();
      this.outline(5);
      c.strokeStyle = COLOR.tongueLine;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(mx, ty + 8);
      c.lineTo(mx, ty + len * 0.7);
      c.stroke();
    }

    // 보조개: 입꼬리 바깥의 짧은 곡선
    for (const side of SIDES) {
      const a = this.v(`mouthDimple${side}`);
      if (a < 0.05) continue;
      const p = side === 'Left' ? l : r;
      const d = dir(side);
      c.globalAlpha = a;
      c.beginPath();
      c.arc(p.x + d * 6, p.y, 22, d > 0 ? -0.9 : Math.PI - 0.9, d > 0 ? 0.9 : Math.PI + 0.9);
      this.outline(6);
      c.globalAlpha = 1;
    }

    // 아랫입술을 밀어 올리거나 턱을 내밀면 턱에 주름이 잡힌다
    const chin = clamp01(shrugL * 0.9 + forward * 0.9);
    if (chin > 0.05) {
      c.globalAlpha = chin;
      c.beginPath();
      c.arc(mx, lowerMid + 62 + forward * 6, 40 + forward * 18, Math.PI * 1.2, Math.PI * 1.8);
      this.outline(6);
      c.globalAlpha = 1;
    }
  }
}
