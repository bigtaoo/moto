// The renderer and one race's 3D objects. Reads the World; never writes to it.

import * as THREE from 'three';
import type { World } from '../sim/world';
import { CAR } from '../sim/config';
import { Track, toWorld, place } from './track';
import { RiderView } from './rider';
import { Ragdoll } from './ragdoll';
import { Traffic, PatrolView, Pickups, Shadows } from './props';
import { Fx } from './fx';

const SKY = 0xbfe2f2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Camera framing per orientation: portrait sees more road ahead from higher up. */
const CAM = {
  portrait: { fov: 66, h: 8.6, back: 10, look: 12, lookY: 0, follow: 0.45 },
  landscape: { fov: 54, h: 3.8, back: 6.6, look: 12, lookY: 0.8, follow: 0.6 },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 600);
  portrait = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 110, 330);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5f8a4a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
    sun.position.set(-30, 60, -20);
    this.scene.add(sun);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 1;
    this.camera.updateProjectionMatrix();
  }
}

export class RaceView {
  readonly group = new THREE.Group();
  readonly riders: RiderView[];
  readonly ragdolls: Ragdoll[];
  readonly fx = new Fx();
  private readonly track: Track;
  private readonly traffic = new Traffic();
  private readonly patrol = new PatrolView();
  private readonly pickups = new Pickups();
  private readonly shadows = new Shadows();
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private focusX = 0;
  private focusZ = 0;
  private fovBoost = 0;
  private shakeAmp = 0;
  private first = true;
  /** Drawn lateral position and speed per rider: a short spring over the sim's x, so contact can't shake. */
  private drawX: number[] = [];
  private drawVx: number[] = [];

  constructor(private readonly stage: Stage, readonly w: World, seed: number) {
    this.track = new Track(w.length, seed);
    this.riders = w.riders.map((r) => new RiderView(r.body, r.ride));
    this.ragdolls = this.riders.map((rv) => {
      const rd = new Ragdoll(rv.body, rv.ride, rv.mat);
      rd.onImpact = (x, z, v) => this.fx.puff(x, z, v, Math.random);
      return rd;
    });
    this.group.add(this.track.group, this.traffic.group, this.patrol.root, this.pickups.group, this.shadows.mesh, this.fx.mesh, this.fx.pows);
    for (const rv of this.riders) this.group.add(rv.root);
    for (const rd of this.ragdolls) this.group.add(rd.group);
    stage.scene.add(this.group);
  }

  dispose(): void {
    this.track.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.group.removeFromParent();
  }

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Screen position (CSS px) of a sim point, or null when behind the camera. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    toWorld(x, y, z, this.v).project(this.stage.camera);
    if (this.v.z > 1) return false;
    out.x = (this.v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  /** Screen position (CSS px) of a point h metres above rider i as drawn this frame (interpolated). */
  projectRider(i: number, h: number, out: { x: number; y: number }): boolean {
    this.v.copy(this.riders[i].root.position);
    this.v.y += h;
    this.v.project(this.stage.camera);
    if (this.v.z > 1) return false;
    out.x = (this.v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  update(dt: number, alpha: number): void {
    const w = this.w;
    this.shadows.begin();
    for (let i = 0; i < w.riders.length; i++) {
      const r = w.riders[i];
      const rv = this.riders[i];
      if (r.state === 'away') {
        // Off the road (a thug waiting to be sent in): hidden, and its drawn x starts fresh when it returns.
        rv.root.visible = false;
        this.drawX[i] = undefined as unknown as number;
        this.ragdolls[i].update(dt);
        continue;
      }
      const x = this.smoothX(i, lerp(r.px, r.x, alpha), dt);
      const z = lerp(r.pz, r.z, alpha);
      place(rv.root, x, 0, z);
      rv.setWeapon(r.weapon);
      rv.update(dt, r.speed, this.drawVx[i], r.rubT > 0 ? r.rubSide : 0);
      // Blink while invulnerable after getting back up.
      rv.root.visible = r.invT <= 0 || Math.floor(r.invT / 3) % 2 === 0;
      if (r.state === 'ride') this.shadows.add(x, z, 0.5, 0.75);
      const rd = this.ragdolls[i];
      rd.update(dt);
      if (rd.active) {
        rd.centre(this.v2);
        this.shadows.add(this.v2.x, this.v2.z, 0.6, 0.6);
      }
    }
    for (const c of w.cars) this.shadows.add(c.x, lerp(c.pz, c.z, alpha), CAR.halfW * 1.25, CAR.halfL * 1.1);
    if (w.patrol.active) this.shadows.add(lerp(w.patrol.px, w.patrol.x, alpha), lerp(w.patrol.pz, w.patrol.z, alpha), 1.2, 1.9);
    this.shadows.end();
    this.traffic.update(w, alpha);
    this.patrol.update(w, alpha, dt);
    this.pickups.update(w, dt);
    this.fx.update(dt, this.stage.camera);
    this.updateCamera(dt, alpha);
    this.stage.renderer.render(this.stage.scene, this.stage.camera);
  }

  /**
   * Critically damped follow of the sim's lateral position (about 50 ms behind). Fast enough to feel
   * direct, but tick-to-tick back-and-forth from riders shoving each other is filtered out of what's drawn.
   */
  private smoothX(i: number, target: number, dt: number): number {
    let x = this.drawX[i];
    let v = this.drawVx[i] ?? 0;
    if (x === undefined || Math.abs(target - x) > 3 || dt <= 0) {
      if (x === undefined || Math.abs(target - x) > 3) { x = target; v = 0; }
    } else {
      const w = 40; // 1/s
      const h = Math.min(dt, 0.05);
      const k = 1 + w * h;
      // implicit Euler of x'' = w^2 (target - x) - 2 w x'
      v = (v + h * w * w * (target - x)) / (k * k);
      x += v * h;
    }
    this.drawX[i] = x;
    this.drawVx[i] = v;
    return x;
  }

  private updateCamera(dt: number, alpha: number): void {
    const p = this.w.player;
    const cfg = this.stage.portrait ? CAM.portrait : CAM.landscape;
    let fx = this.drawX[0] ?? lerp(p.px, p.x, alpha);
    let fz = lerp(p.pz, p.z, alpha);
    const rd = this.ragdolls[0];
    if (p.state === 'down' && rd.active) {
      rd.centre(this.v2);
      fx = this.v2.x;
      fz = Math.max(fz, this.v2.z - 2);
    }
    const k = this.first ? 1 : Math.min(1, dt * 6);
    this.focusX += (fx * cfg.follow - this.focusX) * k;
    this.focusZ = this.first ? fz : this.focusZ + (fz - this.focusZ) * Math.min(1, dt * 14);
    this.first = false;
    const cam = this.stage.camera;
    toWorld(this.focusX, cfg.h, this.focusZ - cfg.back, this.camPos);
    toWorld(this.focusX * 0.8, cfg.lookY, this.focusZ + cfg.look, this.camLook);
    if (this.shakeAmp > 0.001) {
      const s = this.shakeAmp;
      this.camPos.x += (Math.random() - 0.5) * s;
      this.camPos.y += (Math.random() - 0.5) * s;
      this.shakeAmp *= Math.exp(-dt * 10);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    const boost = Math.min(10, Math.max(0, p.speed - 12) * 0.55);
    this.fovBoost += (boost - this.fovBoost) * Math.min(1, dt * 3);
    const fov = cfg.fov + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
