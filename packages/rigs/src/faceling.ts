import * as THREE from 'three';
import { ARKIT_52, type FacePose } from '@redbridge/faceling-core/mapping';
import { FACE_BODY } from './bodies.js';
import type { Rig } from './rig.js';

/**
 * Faceling 로고와 같은 조형의 얼굴. 둥근 사각 머리에 크림색 테두리, 타원 눈 두 개, 앰버색 입.
 * 가만히 있을 때는 로고 심볼과 같은 모습이고, 표정이 필요할 때만 눈썹과 볼 홍조가 떠오른다.
 *
 * 강아지 얼굴과 같은 방식이다: 전체를 2D 캔버스에 그리고, 머리 회전은 이목구비를 밀어 흉내 낸다.
 * ARKit 52개 값을 모두 직접 받는다. 눈동자가 없으므로 시선은 눈 전체를 옮겨 보여 준다.
 * Left 는 캐릭터 기준 왼쪽이므로 화면에서는 오른쪽에 그려진다.
 */

const SIZE = 1024;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** 머리 크기. 로고 심볼(540×543)의 비율을 600 에 맞춘 값들이다. */
const HEAD = 600;
/** 그림 전체 배율. 머리가 화면의 3분의 2쯤을 차지하게 한다. */
const SCALE = 1.12;
const HEAD_RADIUS = HEAD * 0.3;
const RIM = 26;
const EYE_X = 128;
const EYE_Y = -44;
const EYE_RX = 48;
const EYE_RY = 68;
const MOUTH_Y = 84;
const MOUTH_HALF = 80;
const MOUTH_WIDTH = 30;

const COLOR = {
  cream: '#fbf8f2',
  amber: '#f2b24e',
  headHi: '#2f2c28',
  headLo: '#1d1b19',
  inside: '#3a2410',
  tongue: '#f08a6c',
  blush: '#ff9a82',
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type Side = 'Left' | 'Right';
const SIDES: Side[] = ['Left', 'Right'];
/** 화면 x 방향. 캐릭터의 왼쪽은 화면 오른쪽(+x). */
const dir = (side: Side): number => (side === 'Left' ? 1 : -1);

export class FacelingRig implements Rig {
  readonly mode = 'faceling' as const;
  /** 이 몸이 할 수 있는 움직임. LiveDirector.body 에 넣는다. */
  readonly body = FACE_BODY;
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
  /** 이목구비가 머리 위에서 밀리는 양(px). 머리를 돌리거나 숙이는 느낌을 낸다. */
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

    // 머리 전체는 조금만 움직이고, 이목구비는 더 많이 밀려서 돌린 느낌을 낸다
    this.fx = Math.max(-1, Math.min(1, pose.head.yaw * 2.2)) * 120;
    this.fy = Math.max(-1, Math.min(1, pose.head.pitch * 2.2)) * 90;
    c.translate(CX + this.fx * 0.3, CY + this.fy * 0.35);
    c.rotate(-pose.head.roll * 1.2);
    c.scale(SCALE, SCALE);

    this.drawHead(Math.abs(this.fx) / 120);
    this.drawCheeks();
    for (const side of SIDES) {
      this.drawEye(side);
      this.drawBrow(side);
    }
    this.drawSneer();
    this.drawMouth();

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

  private roundedSquare(w: number, h: number, r: number): void {
    const c = this.ctx;
    c.beginPath();
    c.roundRect(-w / 2, -h / 2, w, h, r);
  }

  /** 머리. 옆으로 돌리면 폭이 조금 줄고, 볼을 부풀리면 조금 넓어진다. */
  private drawHead(turn: number): void {
    const c = this.ctx;
    const puff = this.v('cheekPuff');
    const w = HEAD * (1 - 0.06 * turn) + puff * 18;
    const h = HEAD;
    const fill = c.createRadialGradient(this.fx * 0.4, -h * 0.22 + this.fy * 0.3, 20, 0, 0, h * 0.75);
    fill.addColorStop(0, COLOR.headHi);
    fill.addColorStop(1, COLOR.headLo);
    this.roundedSquare(w, h, HEAD_RADIUS);
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = COLOR.cream;
    c.lineWidth = RIM;
    c.stroke();
  }

  /** 볼 홍조. 웃거나 볼을 올리거나 부풀릴 때만 보인다. */
  private drawCheeks(): void {
    const c = this.ctx;
    const puff = this.v('cheekPuff');
    for (const side of SIDES) {
      const d = dir(side);
      const squint = this.v(`cheekSquint${side}`);
      const smile = this.v(`mouthSmile${side}`);
      const alpha = clamp01(0.42 * squint + 0.18 * smile + 0.35 * puff);
      if (alpha < 0.02) continue;
      // 어두운 머리 위에서 옅게 칠하면 갈색으로 탁해지므로, 조금이라도 보일 때는 진하게 칠하고 처음에만 서서히 나타나게 한다
      c.globalAlpha = Math.min(1, alpha * 6) * Math.min(0.85, 0.35 + alpha * 0.6);
      c.fillStyle = COLOR.blush;
      c.beginPath();
      c.ellipse(d * (EYE_X + 54 + puff * 10) + this.fx, 44 + this.fy - squint * 10, 46 * (1 + 0.35 * puff), 24 * (1 + 0.35 * puff), 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  /**
   * 눈. 눈꺼풀 색을 따로 칠하지 않고, 뜬 부분만 크림색으로 남긴다.
   * 위쪽은 직선(안쪽·바깥쪽 높이가 달라 화난 눈, 처진 눈이 된다), 아래쪽은 볼이 올라오면 솟는 곡선(웃는 눈).
   */
  private drawEye(side: Side): void {
    const c = this.ctx;
    const d = dir(side);
    const blink = this.v(`eyeBlink${side}`);
    const wide = this.v(`eyeWide${side}`);
    const squint = clamp01(this.v(`eyeSquint${side}`) + this.v(`noseSneer${side}`) * 0.3);
    const cheek = this.v(`cheekSquint${side}`);
    const browDown = this.v(`browDown${side}`);
    const innerUp = this.v('browInnerUp');
    // 캐릭터 왼쪽을 볼 때 +
    const lookX = side === 'Left' ? this.v('eyeLookOutLeft') - this.v('eyeLookInLeft') : this.v('eyeLookInRight') - this.v('eyeLookOutRight');
    const lookY = this.v(`eyeLookUp${side}`) - this.v(`eyeLookDown${side}`);

    const rx = EYE_RX * (1 + 0.06 * wide);
    const ry = EYE_RY * (1 + 0.14 * wide);
    const x = d * EYE_X + this.fx + lookX * 16;
    const y = EYE_Y + this.fy - lookY * 12;

    let top = lerp(-ry - 4, ry * 0.15, blink) + squint * ry * 0.3;
    let bottom = lerp(ry + 4, ry * 0.15, blink) - squint * ry * 0.4;
    if (bottom - top < 6) {
      const mid = (top + bottom) / 2;
      top = mid - 3;
      bottom = mid + 3;
    }
    const room = bottom - top;

    // 거의 감았으면 가로선 하나로 그린다
    if (room < 16) {
      c.strokeStyle = COLOR.cream;
      c.lineWidth = 14;
      c.beginPath();
      c.moveTo(x - rx * 0.85, y + (top + bottom) / 2);
      c.lineTo(x + rx * 0.85, y + (top + bottom) / 2);
      c.stroke();
      return;
    }

    const topInner = top + Math.min(room * 0.7, browDown * ry * 0.8);
    const topOuter = top + Math.min(room * 0.6, innerUp * ry * 0.5);
    const arch = Math.min(room * 0.92, cheek * ry * 1.05) * (1 - blink);
    const xInner = x - d * (rx + 6);
    const xOuter = x + d * (rx + 6);

    c.save();
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.clip();
    c.beginPath();
    c.moveTo(xInner, y + topInner);
    c.lineTo(xOuter, y + topOuter);
    c.lineTo(xOuter, y + bottom);
    c.quadraticCurveTo(x, y + bottom - arch * 2, xInner, y + bottom);
    c.closePath();
    c.fillStyle = COLOR.cream;
    c.fill();
    c.restore();
  }

  /** 눈썹. 로고에는 없으므로 눈썹이 움직일 때만 떠오른다. */
  private drawBrow(side: Side): void {
    const c = this.ctx;
    const d = dir(side);
    const down = this.v(`browDown${side}`);
    const outerUp = this.v(`browOuterUp${side}`);
    const innerUp = this.v('browInnerUp');
    const activity = Math.max(down, outerUp, innerUp);
    const alpha = clamp01((activity - 0.08) * 2.4);
    if (alpha < 0.02) return;

    const wide = this.v(`eyeWide${side}`);
    const x = d * EYE_X + this.fx * 0.95;
    const base = EYE_Y - EYE_RY - 44 + this.fy * 0.9 - wide * 8;
    const yInner = base - innerUp * 30 + down * 34;
    const yOuter = base - outerUp * 30 + down * 6 + innerUp * 10;

    c.globalAlpha = alpha;
    c.strokeStyle = COLOR.cream;
    c.lineWidth = 16;
    c.beginPath();
    c.moveTo(x - d * 44, yInner);
    c.quadraticCurveTo(x, (yInner + yOuter) / 2 - 10 + down * 8, x + d * 46, yOuter);
    c.stroke();
    c.globalAlpha = 1;
  }

  /** 코를 찡그리면 두 눈 사이에 짧은 주름이 잡힌다. 코는 그리지 않는다. */
  private drawSneer(): void {
    const c = this.ctx;
    c.strokeStyle = COLOR.cream;
    c.lineWidth = 8;
    for (const side of SIDES) {
      const a = this.v(`noseSneer${side}`);
      if (a < 0.05) continue;
      const d = dir(side);
      c.globalAlpha = a * 0.8;
      c.beginPath();
      c.moveTo(this.fx + d * 22, EYE_Y + 10 + this.fy);
      c.lineTo(this.fx + d * 40, EYE_Y + 30 + this.fy);
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  /**
   * 입. 로고처럼 굵은 앰버색 곡선이다. 가만히 있을 때는 살짝 웃는 모양이고,
   * 입꼬리를 내리면 뒤집힌 곡선, 벌리면 앰버 테두리 안에 어두운 입속이 보인다.
   */
  private drawMouth(): void {
    const c = this.ctx;
    const smile = this.both('mouthSmile');
    const frown = this.both('mouthFrown');
    const stretch = this.both('mouthStretch');
    const press = this.both('mouthPress');
    const upperUp = this.both('mouthUpperUp');
    const lowerDown = this.both('mouthLowerDown');
    const sneer = this.both('noseSneer');
    const pucker = this.v('mouthPucker');
    const funnel = this.v('mouthFunnel');
    const jaw = this.v('jawOpen');
    const close = this.v('mouthClose');
    const roll = (this.v('mouthRollUpper') + this.v('mouthRollLower')) / 2;
    const shrugL = this.v('mouthShrugLower');
    const tongue = this.v('tongueOut');

    const half = MOUTH_HALF * Math.max(0.28, 1 + 0.25 * smile + 0.3 * stretch - 0.6 * pucker - 0.35 * funnel - 0.12 * press - 0.15 * roll);
    const mx = this.fx * 1.15 + (this.v('mouthLeft') - this.v('mouthRight')) * 30 + (this.v('jawLeft') - this.v('jawRight')) * 16;
    const my = MOUTH_Y + this.fy * 1.15;

    // 입꼬리 높이(한쪽만 웃거나 찡그릴 수 있다)
    const cornerY = (side: Side): number => my - this.v(`mouthSmile${side}`) * 18 + this.v(`mouthFrown${side}`) * 16 - this.v(`mouthDimple${side}`) * 4;
    const l = { x: mx + half, y: cornerY('Left') };
    const r = { x: mx - half, y: cornerY('Right') };
    const cornersY = (l.y + r.y) / 2;

    // 곡선이 아래로 처지는 정도. 0 보다 크면 웃는 입, 작으면 뒤집힌 입.
    // 입을 오므리면 곡선이 펴지고 작은 동그라미가 된다
    const curve = (20 + smile * 26 - frown * 48 - press * 10 - roll * 8) * (1 - 0.9 * Math.max(pucker, funnel));
    const open = Math.max(0, jaw * 104 * (1 - 0.85 * close) + lowerDown * 20 + funnel * 34 + pucker * 22 - press * 8 - shrugL * 10);
    const width = MOUTH_WIDTH * (1 - 0.35 * press - 0.2 * roll);

    c.strokeStyle = COLOR.amber;
    c.lineWidth = width;

    if (open < 8) {
      c.beginPath();
      c.moveTo(r.x, r.y);
      c.quadraticCurveTo(mx, cornersY + curve * 2, l.x, l.y);
      c.stroke();
      return;
    }

    // 벌린 입: 윗선은 덜 휘고(윗입술을 들면 더 올라간다), 아랫선은 벌린 만큼 내려간다
    const upperCtrl = cornersY + curve * 1.1 - upperUp * 16 - sneer * 10 - open * 0.15;
    const lowerCtrl = cornersY + curve * 2 + open * 2;
    const outline = (): void => {
      c.beginPath();
      c.moveTo(r.x, r.y);
      c.quadraticCurveTo(mx, upperCtrl, l.x, l.y);
      c.quadraticCurveTo(mx, lowerCtrl, r.x, r.y);
      c.closePath();
    };
    outline();
    c.fillStyle = COLOR.inside;
    c.fill();

    if (tongue > 0.05 || open > 40) {
      c.save();
      outline();
      c.clip();
      c.fillStyle = COLOR.tongue;
      c.beginPath();
      const ty = (cornersY + lowerCtrl) / 2 + open * 0.25 + tongue * 30;
      c.ellipse(mx, ty, half * 0.55, Math.max(10, open * 0.35 + tongue * 20), 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    outline();
    c.lineWidth = width * 0.85;
    c.stroke();

    // 혀를 내밀면 입 아래로 늘어진다
    if (tongue > 0.05) {
      const ty = (cornersY + lowerCtrl) / 2 + open * 0.3;
      const len = 24 + tongue * 60;
      c.fillStyle = COLOR.tongue;
      c.beginPath();
      c.moveTo(mx - 28, ty);
      c.lineTo(mx + 28, ty);
      c.quadraticCurveTo(mx + 32, ty + len, mx, ty + len + 6);
      c.quadraticCurveTo(mx - 32, ty + len, mx - 28, ty);
      c.fill();
    }
  }
}
