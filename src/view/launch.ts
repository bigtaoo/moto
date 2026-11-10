// The launch mode in 3D: its own short road (the race's is put back after), the big ramp, the field of
// crates, barrels and parked cars, the player's dummy riding up and then flying as a ragdoll held to the
// path the sim (src/sim/launch.ts) flies, and a chase camera. Reads the Launch; never writes to it.

import * as THREE from 'three';
import { LAUNCH, PROPS, Launch, type LaunchEvent, type PropKind } from '../sim/launch';
import type { Road } from '../sim/road';
import type { Paint, Hat } from '../shop';
import { Track, place, toWorld, roadPhase, setRoadPhase } from './track';
import type { Env } from './env';
import type { Stage } from './scene';
import { RiderView, rbox, TARGET } from './rider';
import { Ragdoll } from './ragdoll';
import { makeHat } from './hats';
import { carGeo, CAR_SHAPES, Shadows } from './props';
import { Fx } from './fx';
import { Kit, cached, kitMaterial, paintedMaterial, isShared } from './toon';
import { sfx } from './audio';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const NO_ROAD = { works: [], cuts: [], ramps: [] } as unknown as Road;
/** The ramp's slope, for tilting the rider up it. */
const SLOPE = Math.atan(LAUNCH.rampH / LAUNCH.rampL);
const CAR_COLS = [0xe8463c, 0x3c7be8, 0xf2c230, 0x4cb85c, 0xf0f0ea, 0x8a5ad8];

/** The ramp: a plywood wedge up to the lip, a yellow-and-black lip edge and a target on each side. */
function rampGeo(): THREE.BufferGeometry {
  return cached('launch-ramp', () => {
    const { rampL: L, rampH: H } = LAUNCH;
    const W = 5;
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L, H)]);
    const wedge = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2).rotateY(-Math.PI / 2);
    const k = new Kit(0.04).add(wedge, 0xd9b27a);
    for (let i = 0; i < 6; i++) {
      k.add(rbox(W / 6, 0.12, 0.3, 0.02), i % 2 ? 0x1b1b22 : 0xf2c230, { at: [-W / 2 + W / 12 + (i * W) / 6, H + 0.02, L - 0.15], ink: false });
    }
    for (const s of [-1, 1]) k.decal(0.55, TARGET, { at: [s * (W / 2 + 0.01), H * 0.45, L * 0.75], rot: [0, (s * Math.PI) / 2, 0] });
    return k.build();
  });
}

const crateGeo = () => cached('launch-crate', () => {
  const k = new Kit(0.03).add(rbox(1.25, 1.25, 1.25, 0.06), 0xc0904e, { at: [0, 0.63, 0] });
  for (const s of [-1, 1]) {
    k.add(rbox(1.3, 0.16, 0.1, 0.02), 0x8e6634, { at: [0, 0.63 + s * 0.4, 0.63], ink: false })
      .add(rbox(1.3, 0.16, 0.1, 0.02), 0x8e6634, { at: [0, 0.63 + s * 0.4, -0.63], ink: false });
  }
  return k.build();
});

const barrelGeo = () => cached('launch-barrel', () => {
  const k = new Kit(0.03).add(new THREE.CylinderGeometry(0.58, 0.58, 1.4, 14), 0xd8322a, { at: [0, 0.7, 0] });
  for (const y of [0.25, 1.15]) k.add(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 14), 0x8c1c18, { at: [0, y, 0], ink: false });
  return k.add(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 14), 0xf2c230, { at: [0, 0.7, 0], ink: false }).build();
});

/** A distance board's pole and flag, every 25 m past the lip. */
const flagGeo = () => cached('launch-flag', () => new Kit(0.025)
  .add(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), 0xf0f0ea, { at: [0, 1.2, 0] })
  .add(rbox(0.05, 0.5, 0.8, 0.02), 0xe8408a, { at: [0, 2.1, 0.4] })
  .build());

interface PropView {
  obj: THREE.Object3D;
  kind: PropKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; rz: number; sx: number; sz: number;
  yaw: number;
  flying: boolean;
}

export class LaunchView {
  readonly group = new THREE.Group();
  readonly fx = new Fx();
  private readonly track: Track;
  private readonly rider: RiderView;
  private readonly rag: Ragdoll;
  private readonly shadows = new Shadows(16);
  private readonly props: PropView[] = [];
  private readonly phase0 = roadPhase();
  /** The riderless scooter after the let-go: z, speed, height and its fall. */
  private bike = { x: 0, z: 0, v: 0, y: 0, vy: 0, air: false };
  private released = false;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private first = true;
  private shakeAmp = 0;

  constructor(private readonly stage: Stage, private readonly l: Launch, seed: number, env: Env, paint: Paint, hat: Hat, vehicle: number) {
    stage.setEnv(env);
    this.track = new Track(LAUNCH.field.to + 30, seed, env, NO_ROAD);
    this.rider = new RiderView(paint.body, paint.ride, vehicle, paint.mark);
    this.rag = new Ragdoll(paint.body, paint.ride, this.rider.mat, paint.mark);
    this.rag.onImpact = (x, z, v) => this.fx.puff(x, z, v, Math.random);
    this.rider.dress(makeHat(hat));
    this.rag.dress(makeHat(hat));
    const ramp = new THREE.Mesh(rampGeo(), kitMaterial());
    place(ramp, 0, 0, LAUNCH.lip - LAUNCH.rampL);
    this.group.add(ramp);
    for (let d = 25; LAUNCH.lip + d < LAUNCH.field.to + 20; d += 25) {
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(flagGeo(), kitMaterial());
        place(f, s * (LAUNCH.halfX + 1.2), 0, LAUNCH.lip + d, s > 0 ? Math.PI : 0);
        this.group.add(f);
      }
    }
    for (const p of l.props) {
      const obj = this.propMesh(p.kind, p.id);
      const yaw = p.kind === 'car' ? Math.PI / 2 : (p.id * 0.7) % 1.2;
      this.props.push({ obj, kind: p.kind, x: p.x, y: 0, z: p.z, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, sx: 0, sz: 0, yaw, flying: false });
      place(obj, p.x, 0, p.z, yaw);
      this.group.add(obj);
    }
    this.group.add(this.track.group, this.rider.root, this.rag.group, this.shadows.mesh, this.fx.mesh, this.fx.pows);
    stage.scene.add(this.group);
    stage.renderer.compile(stage.scene, stage.camera);
  }

  private propMesh(kind: PropKind, id: number): THREE.Object3D {
    if (kind === 'crate') return new THREE.Mesh(crateGeo(), kitMaterial());
    if (kind === 'barrel') return new THREE.Mesh(barrelGeo(), kitMaterial());
    // a car of its own: one instance, so the painted material's tint works, moved as an object
    const m = new THREE.InstancedMesh(carGeo(id % CAR_SHAPES), paintedMaterial(), 1);
    m.setMatrixAt(0, new THREE.Matrix4());
    m.setColorAt(0, new THREE.Color(CAR_COLS[id % CAR_COLS.length]));
    return m;
  }

  /** What an event looks like: the let-go, a smash, a slam into the ground. */
  show(e: LaunchEvent): void {
    const l = this.l;
    if (e.type === 'release') {
      this.released = true;
      this.rider.setDown(true, 1);
      this.bike = { x: l.x, z: l.z, v: l.speed, y: l.y, vy: 0, air: false };
      this.rag.fling(l.x, l.y, l.z, l.vx, l.vy, l.vz, Math.random);
      sfx.whoosh();
    } else if (e.type === 'smash') {
      const p = this.props[e.prop];
      const big = p.kind === 'car';
      p.flying = true;
      p.vx = (p.x - l.x >= 0 ? 1 : -1) * (1.5 + Math.random() * 2.5);
      p.vy = PROPS[p.kind].kick + (big ? 2 : 4) + Math.random() * 3;
      p.vz = Math.max(4, l.vz * (big ? 0.5 : 0.9)) + Math.random() * 3;
      p.sx = (Math.random() - 0.5) * (big ? 4 : 14);
      p.sz = (Math.random() - 0.5) * (big ? 6 : 14);
      this.fx.pow(p.x, 1.3, p.z, true);
      this.fx.sparks(p.x, 1, p.z, p.vx > 0 ? 1 : -1, true, Math.random);
      this.fx.dust(p.x, p.z, l.vz, Math.random);
      this.shake(big ? 0.6 : 0.35);
      if (big) sfx.crash();
      else sfx.thunk(true);
    } else if (e.type === 'land') {
      this.shake(Math.min(0.5, e.speed * 0.03));
      sfx.thunk(e.speed > 10);
    }
  }

  shake(a: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, a);
  }

  /** Where the dummy is on screen (pixels), for the score pops. */
  screenOf(out: { x: number; y: number }): boolean {
    this.rag.active ? this.rag.centre(this.c) : this.c.set(this.l.x, this.l.y + 1.2, this.l.z);
    toWorld(this.c.x, this.c.y + 1, this.c.z, this.c).project(this.stage.camera);
    out.x = (this.c.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this.c.y * 0.5 + 0.5) * window.innerHeight;
    return this.c.z < 1;
  }

  update(dt: number, alpha: number): void {
    const l = this.l;
    const x = lerp(l.px, l.x, alpha);
    const y = lerp(l.py, l.y, alpha);
    const z = lerp(l.pz, l.z, alpha);
    this.shadows.begin();
    if (!this.released) {
      place(this.rider.root, x, y, z);
      if (y > 0) this.rider.root.rotateX(-SLOPE);
      this.rider.update(dt, l.speed, 0);
    } else {
      this.rideOff(dt);
      // the tumbling body on the sim's path: held to it in the air, left to roll once down
      this.rag.pull(x, y > 0.4 ? y + 0.9 : null, z, Math.min(1, dt * 7));
      this.rag.update(dt);
      this.rag.centre(this.c);
      this.shadows.add(this.c.x, this.c.z, 0.6, 0.6);
    }
    this.shadows.add(this.released ? this.bike.x : x, this.released ? this.bike.z : z, 0.5, 0.75);
    for (const p of this.props) if (p.flying) this.fly(p, dt);
    this.shadows.end();
    this.fx.scale = this.stage.fxScale;
    this.fx.update(dt, this.stage.camera);
    this.camera(dt, x, y, z);
    this.stage.render();
  }

  /** The scooter carries on up the ramp without its rider, off the lip and down on its side. */
  private rideOff(dt: number): void {
    const b = this.bike;
    b.v = Math.max(0, b.v - (b.air ? 0 : b.y > 0 ? 6 : 14) * dt);
    b.z += b.v * dt;
    if (!b.air && b.z < LAUNCH.lip) b.y = Launch.ramp(b.z);
    else {
      if (!b.air && b.y > 0) { b.air = true; b.vy = b.v * 0.3; }
      b.vy -= LAUNCH.gravity * dt;
      b.y = Math.max(0, b.y + b.vy * dt);
      if (b.y === 0 && b.air) { b.air = false; b.v *= 0.4; this.fx.dust(b.x, b.z, b.v, Math.random); }
    }
    place(this.rider.root, b.x, b.y, b.z);
    if (b.y > 0 && b.z < LAUNCH.lip) this.rider.root.rotateX(-SLOPE);
    this.rider.update(dt, b.v, 0);
  }

  private fly(p: PropView, dt: number): void {
    p.vy -= LAUNCH.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.rx += p.sx * dt;
    p.rz += p.sz * dt;
    if (p.y < 0) {
      p.y = 0;
      if (p.vy < -3) this.fx.puff(p.x, p.z, -p.vy, Math.random);
      p.vy = -p.vy * 0.3;
      p.vx *= 0.6;
      p.vz *= 0.6;
      p.sx *= 0.6;
      p.sz *= 0.6;
      if (Math.abs(p.vy) < 1 && Math.abs(p.vz) < 0.5) p.flying = false;
    }
    place(p.obj, p.x, p.y + (p.kind === 'car' ? 0 : 0.2), p.z, p.yaw);
    p.obj.rotateX(p.rx);
    p.obj.rotateZ(p.rz);
    this.shadows.add(p.x, p.z, PROPS[p.kind].r, PROPS[p.kind].r);
  }

  /** Behind and above: lower on the run-up, pulled back in the air so the field ahead shows. */
  private camera(dt: number, x: number, y: number, z: number): void {
    const port = this.stage.portrait;
    if (this.released) {
      this.c.set(lerp(x, this.c.x, 0.5), Math.max(y, this.c.y - 0.9), lerp(z, this.c.z, 0.5));
    } else this.c.set(x, y, z);
    const k = this.first ? 1 : Math.min(1, dt * 5);
    this.focus.x += (this.c.x * 0.6 - this.focus.x) * k;
    this.focus.y += (this.c.y - this.focus.y) * Math.min(1, dt * 3);
    this.focus.z = this.first ? this.c.z : this.focus.z + (this.c.z - this.focus.z) * Math.min(1, dt * 10);
    this.first = false;
    const air = this.released ? 1 : 0;
    const h = (port ? 6.5 : 3.6) + air * 1.8 + this.focus.y * 0.6;
    const back = (port ? 10 : 7) + air * 3;
    toWorld(this.focus.x, h, this.focus.z - back, this.camPos);
    toWorld(this.focus.x * 0.7, this.focus.y * 0.5 + (port ? 0 : 0.8), this.focus.z + 12, this.camLook);
    if (this.shakeAmp > 0.001) {
      this.camPos.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camPos.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 10);
    }
    const cam = this.stage.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    const fov = (port ? 66 : 56) + Math.min(10, this.l.speed * 0.25) * (1 - air * 0.5);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Frees this road's own GPU objects (after the next frame) and puts the race's road bends back. */
  dispose(): void {
    const bin = new Set<{ dispose(): void }>();
    this.track.collect(bin);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!isShared(m.geometry)) bin.add(m.geometry);
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!isShared(mt)) bin.add(mt);
      if ((o as THREE.InstancedMesh).isInstancedMesh) bin.add(o as THREE.InstancedMesh);
    });
    this.group.removeFromParent();
    this.stage.retire(bin);
    setRoadPhase(this.phase0);
  }
}
