import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Expression } from '@faceling/core/compositor';
import { bodyFeelings } from '@faceling/core/feelings';
import { ARM_BODY } from './bodies.js';
import type { Rig } from './rig.js';

/**
 * 얼굴이 없는 작업대 로봇팔. 받침, 회전대, 어깨, 팔꿈치, 손목, 집게로 되어 있다.
 *
 * 얼굴 리그와 달리 ARKit 값을 쓰지 않고, 엔진의 공통 출력인 표현(Expression)을 직접 관절 각도로 옮긴다.
 * 같은 판단을 몸짓으로 보여 주는 예다.
 * - 안쓰러움·실망(눈썹 안쪽 올림, 입꼬리 내림, 시선 아래) → 팔 전체가 축 처지고 집게가 바닥을 본다
 * - 기쁨(미소, 눈웃음) → 팔이 들리고 집게가 벌어진다. 신나면 통통 튄다
 * - 놀람(눈 크게 뜸, 입 벌림) → 움찔 물러나며 집게가 활짝 열린다
 * - 단호함·불쾌(눈썹 내림, 입 다묾) → 집게를 꽉 쥐고 조금 물러선다
 * - 갸웃(고개 기울임, 한쪽 눈썹) → 손목을 기울인다
 * - 시선 → 회전대와 손목이 그쪽을 향한다
 * - 듣기 → 다가와 귀 기울이고, 생각 중 → 고개를 돌리고 집게를 까딱인다, 말하기 → 집게와 불빛이 말에 맞춰 움직인다
 * - 끄덕임·가로젓기 → 손목 까딱임과 좌우 흔들기
 *
 * 감정과 별개로, AI 가 일부러 하는 움직임(move 부위의 판단: 오른쪽, 왼쪽, 위, 아래, 앞으로, 흔들기)은
 * 감정 자세 위에 덮어쓴다. 윙크는 눈이 없으니 집게를 찡긋하고 불빛을 깜빡이는 것으로 대신한다.
 * 무엇을 할 수 있는지는 ARM_BODY(bodies.ts)에 선언되어 있고, LiveDirector.body 에 this.body 를 넣으면 그대로 판단을 받는다.
 */

/** 팔 길이(m) */
const BASE_H = 0.07;
const TURRET_H = 0.07;
const UPPER = 0.36;
const FORE = 0.3;
const HAND = 0.075;

/** 가만히 있을 때 자세(라디안). 집게가 보는 사람 쪽을 향한다. */
const REST = { yaw: 0, shoulder: 0.12, elbow: 0.95, wrist: 0.45, roll: 0, claw: 0.18 };

/**
 * 받침을 옆으로 돌려 놓아 팔이 굽는 모습이 옆에서 보이게 하고, 회전대는 다시 보는 사람 쪽으로 조금 돌린다.
 * 그래서 팔은 비스듬히 3/4 방향에서 보인다.
 */
const FACING = 1.05;
const TURN_BACK = -0.6;

/** 관절이 목표를 따라가는 시간 상수(초). 기계다운 무게감을 준다. */
const JOINT_TAU = 0.14;

/** Faceling 의 색: 크림색 몸체, 숯색 관절, 앰버 불빛 */
const COLOR = {
  shell: 0xefe9df,
  dark: 0x2f2c28,
  joint: 0x45403a,
  amber: 0xf2b24e,
};

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

type Joints = typeof REST;

/**
 * 일부러 하는 움직임(move 부위의 판단)을 팔로 옮긴 자세. 쉬는 자세에서 얼마나 움직이는지가 아니라 도착할 자세 자체다.
 * 여기 있는 이름이 ARM_BODY.moves 에 선언한 것과 같아야 한다(home 은 붙잡은 자세를 푸는 것이라 자세가 없다).
 * 방향은 보는 사람 기준이다: right 는 화면 오른쪽. 회전대 각도는 받침이 놓인 방향(FACING, TURN_BACK)을 빼고 잰다.
 */
const reachYaw = (screenAngle: number): number => screenAngle - FACING - TURN_BACK;
const COMMANDS: Record<string, (t: number) => Joints> = {
  right: () => ({ yaw: reachYaw(1.45), shoulder: 0.42, elbow: 0.55, wrist: 0.3, roll: 0, claw: 0.3 }),
  left: () => ({ yaw: reachYaw(-1.0), shoulder: 0.42, elbow: 0.55, wrist: 0.3, roll: 0, claw: 0.3 }),
  up: () => ({ yaw: reachYaw(0.35), shoulder: -0.08, elbow: 0.22, wrist: 0.0, roll: 0, claw: 0.6 }),
  down: () => ({ yaw: reachYaw(0.45), shoulder: 0.55, elbow: 1.5, wrist: 0.9, roll: 0, claw: 0.2 }),
  forward: () => ({ yaw: reachYaw(0.05), shoulder: 0.5, elbow: 0.75, wrist: 0.35, roll: 0, claw: 0.7 }),
  wave: (t) => ({
    yaw: reachYaw(0.25) + 0.22 * Math.sin(t * 4.5),
    shoulder: 0.0,
    elbow: 0.45,
    wrist: 0.2 + 0.15 * Math.sin(t * 9),
    roll: 0.65 * Math.sin(t * 9),
    claw: 0.8,
  }),
};

/** 지금 가장 강한 팔 동작과 그 자세 */
function commandPose(e: Expression, t: number): { weight: number; pose: Joints } {
  let best = '';
  let weight = 0;
  for (const name of Object.keys(COMMANDS)) {
    const v = e.weights[`move.${name}`] ?? 0;
    if (v > weight) [best, weight] = [name, v];
  }
  return { weight, pose: best ? COMMANDS[best]!(t) : { ...REST } };
}

export class ArmRig implements Rig {
  readonly mode = 'arm' as const;
  /** 이 몸이 할 수 있는 움직임. LiveDirector.body 에 넣으면 판단에 팔 동작 질문이 함께 간다. */
  readonly body = ARM_BODY;
  readonly object = new THREE.Group();
  /** 카메라가 바라볼 중심 */
  readonly headCenter = new THREE.Vector3(0.04, 1.46, 0.08);
  /** 팔을 가장 높이 든 자세까지 들어오는 카메라 거리 */
  readonly viewDistance = 2.45;

  get view(): { position: THREE.Vector3; target: THREE.Vector3 } {
    const c = this.headCenter;
    return { position: new THREE.Vector3(c.x, c.y, c.z + this.viewDistance), target: c.clone() };
  }

  private readonly turret = new THREE.Group();
  private readonly shoulder = new THREE.Group();
  private readonly elbow = new THREE.Group();
  private readonly wrist = new THREE.Group();
  private readonly roll = new THREE.Group();
  private readonly fingers: THREE.Group[] = [];
  private readonly led: THREE.MeshStandardMaterial;
  private readonly joints: Joints = { ...REST };
  private lastT: number | null = null;

  constructor() {
    const shell = new THREE.MeshStandardMaterial({ color: COLOR.shell, roughness: 0.5, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: COLOR.dark, roughness: 0.6, metalness: 0.1 });
    const joint = new THREE.MeshStandardMaterial({ color: COLOR.joint, roughness: 0.45 });
    this.led = new THREE.MeshStandardMaterial({ color: COLOR.amber, emissive: COLOR.amber, emissiveIntensity: 0.4, roughness: 0.3 });

    // 받침과 회전대
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, BASE_H, 48), dark);
    base.position.y = 1 + BASE_H / 2;
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.008, 10, 64), joint);
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 1 + BASE_H;
    this.object.add(base, baseRing);

    this.turret.position.y = 1 + BASE_H;
    const turretBody = new THREE.Mesh(new RoundedBoxGeometry(0.17, TURRET_H, 0.17, 4, 0.035), shell);
    turretBody.position.y = TURRET_H / 2;
    this.turret.add(turretBody);
    this.object.add(this.turret);

    // 어깨 → 위팔
    this.shoulder.position.y = TURRET_H + 0.035;
    this.shoulder.add(this.hub(0.055, 0.15, joint));
    const upper = new THREE.Mesh(new RoundedBoxGeometry(0.085, UPPER, 0.085, 4, 0.03), shell);
    upper.position.y = UPPER / 2;
    const upperStripe = new THREE.Mesh(new RoundedBoxGeometry(0.087, UPPER * 0.55, 0.02, 2, 0.008), joint);
    upperStripe.position.set(0, UPPER / 2, 0.036);
    this.shoulder.add(upper, upperStripe);
    this.turret.add(this.shoulder);

    // 팔꿈치 → 아래팔
    this.elbow.position.y = UPPER;
    this.elbow.add(this.hub(0.048, 0.12, joint));
    const fore = new THREE.Mesh(new RoundedBoxGeometry(0.07, FORE, 0.07, 4, 0.025), shell);
    fore.position.y = FORE / 2;
    this.elbow.add(fore);
    this.shoulder.add(this.elbow);

    // 손목 → 손(돌림) → 집게
    this.wrist.position.y = FORE;
    this.wrist.add(this.hub(0.038, 0.1, joint));
    this.wrist.add(this.roll);
    const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, HAND, 32), dark);
    hand.position.y = HAND / 2 + 0.02;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.016, 32), this.led);
    band.position.y = 0.035;
    this.roll.add(hand, band);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.026, HAND + 0.02, 0);
      const base = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.07, 0.034, 2, 0.008), joint);
      base.position.y = 0.035;
      const tip = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.05, 0.03, 2, 0.008), joint);
      tip.position.set(-s * 0.01, 0.085, 0);
      tip.rotation.z = s * 0.45;
      pivot.add(base, tip);
      pivot.userData.side = s;
      this.fingers.push(pivot);
      this.roll.add(pivot);
    }
    this.elbow.add(this.wrist);

    // 보는 사람 쪽으로 비스듬히 놓아 팔의 굽힘이 잘 보이게 한다
    this.object.rotation.y = FACING;
    this.pose(this.joints);
  }

  /** 관절의 둥근 축. 팔이 굽는 방향(x 축)으로 눕힌다. */
  private hub(radius: number, length: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 32), material);
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }

  apply(frame: { expression: Expression }): void {
    const e = frame.expression;
    const dt = this.lastT === null ? 10 : clamp(e.t - this.lastT, 0, 0.25);
    this.lastT = e.t;
    const f = bodyFeelings(e);
    const { listening, thinking, speaking } = e.turn;
    const t = e.t;

    const target: Joints = { ...REST };
    // 감정 자세
    target.shoulder += 0.42 * f.sad - 0.12 * f.happy - 0.3 * f.surprised - 0.1 * f.tense + 0.18 * listening;
    target.elbow += 0.85 * f.sad - 0.42 * f.happy - 0.3 * f.surprised + 0.1 * listening;
    target.wrist += 0.55 * f.sad - 0.3 * f.happy - 0.15 * f.surprised + 0.15 * f.tense - 0.22 * listening;
    target.wrist += 0.45 * f.lookDown - 0.45 * f.lookUp;
    // 갸웃: 손목을 돌리고, 팔도 그쪽으로 살짝 기운다
    target.roll += 0.9 * f.tilt + 0.25 * thinking;
    target.yaw += 0.12 * f.tilt;
    target.yaw += 0.45 * f.lookAside + 0.3 * thinking;
    target.claw += 0.5 * f.happy + 0.7 * f.surprised - 0.2 * f.tense - 0.12 * f.sad;
    // 신나면 통통 튀고, 장난스러우면 손목을 흔든다
    target.elbow += Math.sin(t * 9) * 0.07 * f.excited;
    target.roll += Math.sin(t * 6) * 0.3 * f.playful;
    // 생각 중에는 집게를 천천히 까딱인다
    target.claw += (0.5 + 0.5 * Math.sin(t * 3)) * 0.18 * thinking;
    // 말할 때는 집게가 소리에 맞춰 열린다
    target.claw += 0.9 * e.mouth.jaw;
    // 숨 쉬듯 미세하게 흔들린다
    target.shoulder += 0.015 * Math.sin(t * 0.9) * (1 + 0.8 * speaking);
    target.yaw += 0.04 * Math.sin(t * 0.5) + 0.02 * Math.sin(t * 1.3 + 1);

    // 의도한 동작("오른쪽으로 쭉!", "안녕히 가세요!"). 감정 자세 위에 덮어쓰고, 집게와 불빛의 감정은 남긴다.
    const command = commandPose(e, t);
    if (command.weight > 0.01) {
      const k = Math.min(1, command.weight);
      for (const name of ['yaw', 'shoulder', 'elbow', 'wrist', 'roll'] as const) {
        target[name] += (command.pose[name] - target[name]) * k;
      }
      target.claw += command.pose.claw * k;
    }

    // 관절이 목표를 부드럽게 따라간다
    const k = 1 - Math.exp(-dt / JOINT_TAU);
    for (const name of Object.keys(target) as (keyof Joints)[]) {
      this.joints[name] += (target[name] - this.joints[name]) * k;
    }

    // 순간 동작은 따라가기 없이 바로 얹는다. 머리보다 팔이 커서 크게 움직인다.
    const now = { ...this.joints };
    now.wrist += e.gesture.nod * 3.2;
    now.elbow += e.gesture.nod * 1.2;
    now.yaw += e.gesture.shake * 2.5;
    now.roll += e.gesture.shake * 1.5;
    now.claw += e.gesture.flash * 2.5;
    // 눈이 없으니 윙크는 집게를 찡긋 오므리고 불빛을 깜빡이는 것으로 대신한다
    const wink = Math.max(e.gesture.winkL, e.gesture.winkR);
    now.claw -= 0.5 * wink;
    now.roll += 0.25 * wink;
    this.pose(now);

    // 불빛: 말할 때 소리에 맞춰 밝아지고, 처지면 어두워진다. 윙크하면 꺼졌다 켜진다.
    const glow = (0.35 + 1.6 * e.mouth.jaw + 0.4 * f.happy + 0.3 * f.surprised - 0.25 * f.sad) * (1 - 0.95 * wink);
    this.led.emissiveIntensity = clamp(glow, 0.02, 2.2);
  }

  private pose(j: Joints): void {
    this.turret.rotation.y = TURN_BACK + j.yaw;
    this.shoulder.rotation.x = j.shoulder;
    this.elbow.rotation.x = j.elbow;
    this.wrist.rotation.x = j.wrist;
    this.roll.rotation.y = j.roll;
    const open = clamp(j.claw, 0, 1.2) * 0.55;
    for (const finger of this.fingers) finger.rotation.z = -(finger.userData.side as number) * open;
  }

  dispose(): void {
    this.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
