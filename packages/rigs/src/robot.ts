import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ARKIT_52, type FacePose } from '@faceling/core/mapping';
import { FACE_BODY } from './bodies.js';

/**
 * 코드로 그린 로봇 얼굴. 머리는 3D 도형이고, 얼굴은 머리 앞면의 화면에 2D 로 그린다.
 * ARKit 52개 값을 모두 직접 받아 눈, 눈썹, 볼, 코, 입의 모양을 매 프레임 다시 그린다.
 * Left 는 캐릭터 기준 왼쪽이므로 화면에서는 오른쪽에 그려진다.
 */

const W = 1024;
const H = 768;
const CX = W / 2;
const EYE_Y = 300;
const EYE_DX = 190;
const BROW_Y = 172;
const CHEEK_Y = 452;
const CHEEK_DX = 318;
const NOSE_Y = 432;
const MOUTH_Y = 566;

const COLOR = {
  screen: '#0b1622',
  glow: '#74f2e4',
  dim: '#2f8f88',
  pupil: '#0b1622',
  blush: '#ff7fa0',
  inside: '#3a1220',
  tongue: '#ff6b81',
  teeth: '#f4fbff',
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type Side = 'Left' | 'Right';
/** 화면 x 방향. 캐릭터의 왼쪽은 화면 오른쪽(+x). */
const dir = (side: Side): number => (side === 'Left' ? 1 : -1);

export class RobotRig {
  readonly mode = 'robot' as const;
  /** 이 몸이 할 수 있는 움직임. LiveDirector.body 에 넣는다. */
  readonly body = FACE_BODY;
  readonly supported: string[] = [...ARKIT_52];
  readonly object = new THREE.Group();
  /** 카메라가 바라볼 머리 중심 */
  readonly headCenter = new THREE.Vector3(0, 1.45, 0);

  private readonly head = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly lamp: THREE.MeshBasicMaterial;
  private shapes: Record<string, number> = {};

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const shell = new THREE.MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.55, metalness: 0.05 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x3d8f7c, roughness: 0.5, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.6 });
    this.lamp = new THREE.MeshBasicMaterial({ color: 0x74f2e4 });

    // 몸통과 목은 움직이지 않는다
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.3, 0.26, 6, 0.09), shell);
    body.position.set(0, 1.045, 0);
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.035, 0.02, 4, 0.01), accent);
    stripe.position.set(0, 1.12, 0.125);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 24), dark);
    neck.position.set(0, 1.24, 0);
    this.object.add(body, stripe, neck);

    // 머리는 목 위쪽을 축으로 돈다
    const pivotY = 1.28;
    const up = this.headCenter.y - pivotY;
    this.head.position.set(0, pivotY, 0);
    const skull = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.31, 0.3, 8, 0.085), shell);
    skull.position.set(0, up, 0);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.31, 0.31 * (H / W)),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    screen.position.set(0, up, 0.1515);
    for (const x of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 28), accent);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(x * 0.2, up, 0);
      this.head.add(ear);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12), dark);
    stem.position.set(0, up + 0.19, 0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), this.lamp);
    bulb.position.set(0, up + 0.235, 0);
    this.head.add(skull, screen, stem, bulb);
    this.object.add(this.head);

    this.draw();
  }

  apply(pose: FacePose): void {
    this.shapes = pose.shapes;
    // 도형 얼굴은 미세한 각도가 잘 안 읽혀서 머리 움직임을 조금 키운다
    this.head.rotation.set(pose.head.pitch * 1.4, pose.head.yaw * 1.4, pose.head.roll * 1.4);
    this.draw();
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

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.shadowBlur = 0;

    // 화면 바탕
    c.fillStyle = COLOR.screen;
    c.beginPath();
    c.roundRect(0, 0, W, H, 150);
    c.fill();
    c.save();
    c.clip();

    this.drawCheeks();
    for (const side of ['Left', 'Right'] as const) {
      this.drawEye(side);
      this.drawBrow(side);
    }
    this.drawNose();
    this.drawMouth();
    c.restore();
  }

  private glow(on: boolean): void {
    this.ctx.shadowColor = COLOR.glow;
    this.ctx.shadowBlur = on ? 26 : 0;
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

    const rx = 64;
    const ry = 80 * (1 + 0.22 * wide);
    const x = CX + d * EYE_DX + lookX * 10;
    const y = EYE_Y - lookY * 8;

    // 눈꺼풀. 위는 직선(안쪽과 바깥쪽 높이가 다를 수 있다), 아래는 가운데가 솟는 곡선.
    const closedY = ry * 0.22;
    let top = lerp(-ry - 6, closedY - 5, blink) + squint * ry * 0.28;
    let bottom = lerp(ry + 6, closedY + 5, blink) - squint * ry * 0.42;
    if (bottom - top < 10) {
      const mid = (top + bottom) / 2;
      top = mid - 5;
      bottom = mid + 5;
    }
    const room = bottom - top;
    const topInner = top + Math.min(room * 0.7, browDown * ry * 0.75);
    const topOuter = top + Math.min(room * 0.6, innerUp * ry * 0.4);
    const arch = Math.min(room * 0.9, cheek * ry * 0.95) * (1 - blink);
    const xInner = x - d * (rx + 8);
    const xOuter = x + d * (rx + 8);

    c.save();
    c.beginPath();
    c.moveTo(xInner, y + topInner);
    c.lineTo(xOuter, y + topOuter);
    c.lineTo(xOuter, y + bottom);
    c.quadraticCurveTo(x, y + bottom - arch * 2, xInner, y + bottom);
    c.closePath();
    c.clip();

    this.glow(true);
    c.fillStyle = COLOR.glow;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    this.glow(false);

    // 눈동자. 눈보다 더 많이 움직여서 시선이 읽히게 한다.
    // 눈웃음으로 눈이 초승달이 되어도 눈동자가 남도록, 보이는 띠 안으로 올리고 띠 높이에 맞춰 줄인다.
    // 눈을 거의 감았을 때만 사라진다.
    const bandTop = (topInner + topOuter) / 2;
    const bandBottom = bottom - arch;
    const band = bandBottom - bandTop;
    const pr = band > 16 ? Math.min(30 * (1 - 0.18 * wide), band * 0.4) : 0;
    const px = x + lookX * 26;
    const py = y + Math.max(bandTop + pr * 0.6, Math.min(6 - lookY * 30, bandBottom - pr * 0.85));
    c.fillStyle = COLOR.pupil;
    c.beginPath();
    c.arc(px, py, pr, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = COLOR.teeth;
    c.beginPath();
    c.arc(px + pr * 0.37, py - pr * 0.4, pr * 0.3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private drawBrow(side: Side): void {
    const c = this.ctx;
    const d = dir(side);
    const down = this.v(`browDown${side}`);
    const outerUp = this.v(`browOuterUp${side}`);
    const innerUp = this.v('browInnerUp');
    const wide = this.v(`eyeWide${side}`);

    const x = CX + d * EYE_DX;
    const lift = wide * 8;
    const yInner = BROW_Y - lift - innerUp * 40 + down * 44;
    const yOuter = BROW_Y - lift - outerUp * 40 + down * 8 + innerUp * 12;
    const xInner = x - d * 78;
    const xOuter = x + d * 90;

    this.glow(true);
    c.strokeStyle = COLOR.glow;
    c.lineWidth = 20;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(xInner, yInner);
    c.quadraticCurveTo(x, (yInner + yOuter) / 2 - 14 + down * 10, xOuter, yOuter);
    c.stroke();
    this.glow(false);
  }

  private drawCheeks(): void {
    const c = this.ctx;
    const puff = this.v('cheekPuff');
    for (const side of ['Left', 'Right'] as const) {
      const d = dir(side);
      const squint = this.v(`cheekSquint${side}`);
      const smile = this.v(`mouthSmile${side}`);
      const x = CX + d * (CHEEK_DX + puff * 14);
      const y = CHEEK_Y - squint * 26;
      const r = 46 * (1 + 0.75 * puff + 0.15 * squint);
      c.globalAlpha = clamp01(0.1 + 0.55 * squint + 0.2 * smile + 0.5 * puff);
      c.fillStyle = COLOR.blush;
      c.beginPath();
      c.ellipse(x, y, r * 1.25, r * 0.8, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;

      // 볼을 부풀리면 볼 바깥에 둥근 선이 생긴다
      if (puff > 0.05) {
        c.globalAlpha = puff;
        c.strokeStyle = COLOR.blush;
        c.lineWidth = 9;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(x - d * 8, y, r * 1.5, d > 0 ? -0.75 : Math.PI - 0.75, d > 0 ? 0.75 : Math.PI + 0.75);
        c.stroke();
        c.globalAlpha = 1;
      }
    }
  }

  private drawNose(): void {
    const c = this.ctx;
    const sneer = this.both('noseSneer');
    const y = NOSE_Y - sneer * 14;
    c.fillStyle = COLOR.dim;
    c.beginPath();
    c.ellipse(CX, y, 13, 9, 0, 0, Math.PI * 2);
    c.fill();

    // 코를 찡그리면 콧등 양쪽에 주름이 잡힌다
    c.lineCap = 'round';
    c.strokeStyle = COLOR.glow;
    c.lineWidth = 8;
    for (const side of ['Left', 'Right'] as const) {
      const a = this.v(`noseSneer${side}`);
      if (a < 0.05) continue;
      const d = dir(side);
      c.globalAlpha = a;
      for (const k of [0, 1]) {
        c.beginPath();
        c.moveTo(CX + d * (30 + k * 20), y - 34 - k * 4);
        c.lineTo(CX + d * (52 + k * 20), y - 10 + k * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }

  private drawMouth(): void {
    const c = this.ctx;
    const smile = this.both('mouthSmile');
    const stretch = this.both('mouthStretch');
    const dimple = this.both('mouthDimple');
    const press = this.both('mouthPress');
    const upperUp = this.both('mouthUpperUp');
    const lowerDown = this.both('mouthLowerDown');
    const pucker = this.v('mouthPucker');
    const funnel = this.v('mouthFunnel');
    const jaw = this.v('jawOpen');
    const close = this.v('mouthClose');
    const rollU = this.v('mouthRollUpper');
    const rollL = this.v('mouthRollLower');
    const shrugU = this.v('mouthShrugUpper');
    const shrugL = this.v('mouthShrugLower');
    const forward = this.v('jawForward');
    const puff = this.v('cheekPuff');
    const tongue = this.v('tongueOut');

    const half = 96 * Math.max(0.22, 1 + 0.3 * smile + 0.28 * stretch + 0.08 * dimple - 0.55 * pucker - 0.3 * funnel - 0.12 * press - 0.25 * puff);
    const mx = CX + (this.v('mouthLeft') - this.v('mouthRight')) * 38 + (this.v('jawLeft') - this.v('jawRight')) * 22;
    const my = MOUTH_Y + jaw * 12 + forward * 8 - shrugL * 10;

    const corner = (side: Side): { x: number; y: number } => {
      const s = this.v(`mouthSmile${side}`);
      const f = this.v(`mouthFrown${side}`);
      const st = this.v(`mouthStretch${side}`);
      return { x: mx + dir(side) * half * (1 + 0.14 * s + 0.12 * st), y: my - s * 46 + f * 42 + st * 6 };
    };
    const l = corner('Left');
    const r = corner('Right');

    const open = Math.max(
      0,
      jaw * 120 * (1 - 0.85 * close) + (upperUp + lowerDown) * 22 + funnel * 40 + pucker * 18 - press * 12 - (rollU + rollL) * 8,
    );
    const upperMid = my - open * 0.28 - upperUp * 12 - shrugU * 10 - funnel * 6;
    const lowerMid = my + open * 0.72 + lowerDown * 12;
    const cornerY = (l.y + r.y) / 2;
    // 곡선이 가운데 점을 지나도록 조절점을 잡는다
    const upperCtrl = 2 * upperMid - cornerY;
    const lowerCtrl = 2 * lowerMid - cornerY;

    const outline = (): void => {
      c.beginPath();
      c.moveTo(r.x, r.y);
      c.quadraticCurveTo(mx, upperCtrl, l.x, l.y);
      c.quadraticCurveTo(mx, lowerCtrl, r.x, r.y);
      c.closePath();
    };

    if (open > 3) {
      c.save();
      outline();
      c.fillStyle = COLOR.inside;
      c.fill();
      c.clip();
      // 웃으며 입이 벌어지면 윗니가 보인다
      const teeth = Math.min(open * 0.38, 30) * clamp01(0.25 + smile * 1.2 + upperUp);
      if (teeth > 2) {
        c.fillStyle = COLOR.teeth;
        c.fillRect(mx - half * 1.3, Math.min(upperMid, cornerY) - 30, half * 2.6, 30 + teeth);
      }
      if (tongue < 0.05) {
        c.fillStyle = COLOR.tongue;
        c.beginPath();
        c.ellipse(mx, lowerMid + 10, half * 0.62, Math.max(8, open * 0.42), 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // 입술 선. 입을 다물거나 말아 넣으면 가늘어진다.
    this.glow(true);
    c.strokeStyle = COLOR.glow;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.lineWidth = Math.max(7, 17 - 5 * press - 3 * (rollU + rollL));
    outline();
    c.stroke();
    this.glow(false);

    if (tongue > 0.05) {
      const ty = lowerMid + 6;
      c.fillStyle = COLOR.tongue;
      c.beginPath();
      c.ellipse(mx, ty + tongue * 26, 40, 14 + tongue * 34, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = COLOR.inside;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(mx, ty + 4);
      c.lineTo(mx, ty + tongue * 40);
      c.stroke();
    }

    // 보조개: 입꼬리 바깥의 짧은 곡선
    c.strokeStyle = COLOR.glow;
    c.lineWidth = 8;
    for (const side of ['Left', 'Right'] as const) {
      const a = this.v(`mouthDimple${side}`);
      if (a < 0.05) continue;
      const p = side === 'Left' ? l : r;
      const d = dir(side);
      c.globalAlpha = a;
      c.beginPath();
      c.arc(p.x + d * 8, p.y, 26, d > 0 ? -0.9 : Math.PI - 0.9, d > 0 ? 0.9 : Math.PI + 0.9);
      c.stroke();
      c.globalAlpha = 1;
    }

    // 아랫입술을 밀어 올리거나 턱을 내밀면 턱에 주름이 잡힌다
    const chin = clamp01(shrugL * 0.9 + forward * 0.9);
    if (chin > 0.05) {
      c.globalAlpha = chin;
      c.strokeStyle = COLOR.dim;
      c.lineWidth = 9;
      c.beginPath();
      c.arc(mx, lowerMid + 78 + forward * 6, 46 + forward * 20, Math.PI * 1.2, Math.PI * 1.8);
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  /** 말하는 정도에 따라 안테나 불빛의 밝기를 바꾼다. 0~1. */
  setLamp(level: number): void {
    const k = 0.45 + 0.55 * clamp01(level);
    this.lamp.color.setRGB(0.45 * k, 0.95 * k, 0.9 * k);
  }
}
