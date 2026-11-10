// The renderer and one race's 3D objects. Reads the World; never writes to it.

import * as THREE from 'three';
import type { World } from '../sim/world';
import { CAR, CHARGE, DOWN, TICK_HZ, VEHICLES, rung } from '../sim/config';
import { Track, toWorld, place, rampLift, RAMP_LOOK } from './track';
import { ENVS, type Env } from './env';
import { RiderView } from './rider';
import type { Hat, Paint } from '../shop';
import { makeHat } from './hats';
import { HazardView } from './hazards';
import { Ragdoll } from './ragdoll';
import { standTicks } from '../sim/down';
import { Traffic, PatrolView, Pickups, Shadows } from './props';
import { Fx } from './fx';
import { isShared } from './toon';
import { MOTION } from './motion';
import { Governor, TIERS, TOP, forcedTier, isSoftware, probeDevice, startTier, type QualityMode } from './quality';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The longest boot waits on shader warm-up; anything still compiling finishes in the background. */
const PREWARM_MAX = 4000;

/**
 * What a rival is drawn riding (looks only: the sim gives rivals their pace from the stage). Scooters in
 * the first season; after that a spread of whatever rides the ladder has opened by now.
 */
function rivalRide(w: World, id: number, thug: boolean): number {
  if (thug || w.div.tier === 0) return 0;
  const at = rung(w.divIndex, w.div.tier);
  const open = VEHICLES.filter((v) => v.rung <= at).length;
  return (id * 7 + w.divIndex + w.div.tier) % open; // 7 is coprime with every count of rides, so the field is mixed
}

/** Camera framing per orientation: portrait sees more road ahead from higher up. */
const CAM = {
  portrait: { fov: 66, h: 8.6, back: 10, look: 12, lookY: 0, follow: 0.45 },
  landscape: { fov: 54, h: 3.8, back: 6.6, look: 12, lookY: 0.8, follow: 0.6 },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 600);
  /** The GPU's name ('' when the browser won't say), for telemetry. */
  readonly gpu: string;
  portrait = false;
  /** Canvas size in CSS px, kept on resize (window.innerWidth per name tag forced a style recalc each time). */
  cssW = 1;
  cssH = 1;
  /** Set once RaceView.prewarm has compiled the programs. */
  warmed = false;
  /** Called when the quality tier changes, with the tier before (e.g. for telemetry). */
  onQuality?: (tier: number, prev: number) => void;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  /** Where this device starts (see quality.ts), and the tier `?quality=` pins, if any. */
  private readonly start: number;
  private readonly forced: number | null;
  private readonly gov: Governor;
  private mode: QualityMode = 'auto';
  private applied: number;
  private env: Env = ENVS.meadow;
  private readonly retired: { dispose(): void }[] = [];

  /** Throws when the browser has no WebGL. */
  constructor(canvas: HTMLCanvasElement) {
    const dev = probeDevice();
    this.gpu = dev.gpu;
    // MSAA multiplies the pixels a phone fills and crawls on a CPU renderer; desktops keep it
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !dev.touch && !isSoftware(dev.gpu), powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // reading program logs blocks on each compile (~350 ms of a Mali phone's first frame); dev keeps the checks
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.start = startTier(dev);
    // the dev server shows the best picture (a hidden preview pane would talk the governor down); ?quality=auto there still lets it run
    this.forced = forcedTier(location.search) ?? (import.meta.env.DEV && !/[?&]quality=auto/.test(location.search) ? TOP : null);
    // two tiers are the same here when both caps are above the screen's own ratio (and fx and view match)
    const cap = (t: number) => Math.min(TIERS[t].dpr, window.devicePixelRatio || 1);
    this.gov = new Governor(this.forced ?? this.start, (a, b) => cap(a) === cap(b) && TIERS[a].fx === TIERS[b].fx && TIERS[a].view === TIERS[b].view);
    this.applied = this.gov.tier;
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.Fog(0xffffff, 110, 330);
    this.hemi = new THREE.HemisphereLight();
    this.sun = new THREE.DirectionalLight();
    this.sun.position.set(-30, 60, -20);
    this.scene.add(this.hemi, this.sun);
    this.setEnv(ENVS.meadow);
    this.resize();
  }

  /** The quality tier, 0 (cheapest) to 5. */
  get tier(): number {
    return this.gov.tier;
  }

  get qualityMode(): QualityMode {
    return this.mode;
  }

  /** Share of spark and dust particles thrown at this tier. */
  get fxScale(): number {
    return TIERS[this.gov.tier].fx;
  }

  /** The environment the scene is lit for. */
  get envNow(): Env {
    return this.env;
  }

  setEnv(e: Env): void {
    this.env = e;
    (this.scene.background as THREE.Color).set(e.sky);
    (this.scene.fog as THREE.Fog).color.set(e.sky);
    this.applyView();
    this.hemi.color.set(e.hemiSky);
    this.hemi.groundColor.set(e.hemiGround);
    this.hemi.intensity = e.hemi;
    this.sun.color.set(e.sun);
    this.sun.intensity = e.sunI;
  }

  resize(): void {
    const w = (this.cssW = window.innerWidth);
    const h = (this.cssH = window.innerHeight);
    // the screen's own ratio can change too (the window moved to another monitor, the page was zoomed)
    const r = this.ratio();
    if (this.renderer.getPixelRatio() !== r) this.renderer.setPixelRatio(r);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 1;
    this.camera.updateProjectionMatrix();
  }

  /** One frame of `ms`; `active` false when not racing (a menu, paused). Moves the tier in auto mode. */
  frame(ms: number, active: boolean): void {
    if (this.mode !== 'auto' || this.forced !== null) return;
    if (this.gov.frame(ms, active)) this.applyTier();
  }

  /** A race begins: the governor may step up once again. */
  raceStart(): void {
    this.gov.raceStart();
  }

  /** The player's setting: 'auto' lets the governor choose, 'low' and 'high' pin a tier. `?quality=` beats both. */
  setQualityMode(mode: QualityMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.forced !== null) return;
    this.gov.reset(mode === 'low' ? Math.min(1, this.start) : mode === 'high' ? TOP : this.start);
    this.applyTier();
  }

  /** Draws the frame, then frees what a finished race left (see retire). */
  render(): void {
    this.renderer.render(this.scene, this.camera);
    if (this.retired.length) {
      for (const o of this.retired) o.dispose();
      this.retired.length = 0;
    }
  }

  /**
   * Frees a finished race's GPU objects after the next frame rather than now: disposing the last material
   * using a shader program deletes the program, and the next race would compile it all over again. Once the
   * new race has been drawn its own materials hold those programs, and freeing the old ones costs nothing.
   */
  retire(items: Iterable<{ dispose(): void }>): void {
    for (const o of items) this.retired.push(o);
  }

  private ratio(): number {
    return Math.min(TIERS[this.gov.tier].dpr, window.devicePixelRatio || 1);
  }

  private applyTier(): void {
    const t = this.gov.tier;
    const r = this.ratio();
    if (this.renderer.getPixelRatio() !== r) this.renderer.setPixelRatio(r);
    if (t !== this.applied) {
      this.applyView();
      this.onQuality?.(t, this.applied);
    }
    this.applied = t;
  }

  /**
   * The fog at this tier's share of the environment's, and the far plane just past where it is solid: what
   * lies beyond would be drawn in the sky's own colour, so clipping it changes nothing on screen.
   */
  private applyView(): void {
    const v = TIERS[this.gov.tier].view;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.env.fogNear * v;
    fog.far = this.env.fogFar * v;
    this.camera.far = fog.far + 10;
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
  private readonly hazards: HazardView;
  /** Each rider's bowling slide already applied to its ragdoll. */
  private readonly slid: number[] = [];
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private focusX = 0;
  private focusZ = 0;
  private fovBoost = 0;
  private shakeAmp = 0;
  private first = true;
  /** The highlight's side camera: which side of the player it stands on (0: the race camera). */
  cine = 0;
  /** Drawn lateral position and speed per rider: a short spring over the sim's x, so contact can't shake. */
  private drawX: number[] = [];
  private drawVx: number[] = [];

  /** `paint`, `hat`: the player's paint job and hat (looks only: the sim keeps the stock colours). */
  constructor(private readonly stage: Stage, public w: World, seed: number, paint?: Paint, hat: Hat = 'none') {
    const env = ENVS[w.div.env];
    stage.setEnv(env);
    this.track = new Track(w.length, seed, env, w.road);
    this.riders = w.riders.map((r, i) => i === 0 && paint
      ? new RiderView(paint.body, paint.ride, w.vehicle, paint.mark)
      : new RiderView(r.body, r.ride, i === 0 ? w.vehicle : rivalRide(w, i, r.thug)));
    this.ragdolls = this.riders.map((rv) => {
      const rd = new Ragdoll(rv.body, rv.ride, rv.mat, rv.mark);
      rd.onImpact = (x, z, v) => this.fx.puff(x, z, v, Math.random);
      return rd;
    });
    // hats: the player's own, the boss' crown (and a bigger boss), every head huge in the big-heads week
    const head = w.mutator === 'bigheads' ? 1.8 : 1;
    w.riders.forEach((r, i) => {
      const kind = r.boss ? 'crown' : i === 0 ? hat : 'none';
      this.riders[i].dress(makeHat(kind), head);
      this.ragdolls[i].dress(makeHat(kind), head);
      if (r.boss) this.riders[i].root.scale.setScalar(1.22);
    });
    this.hazards = new HazardView(w);
    this.group.add(this.hazards.group, this.track.group, this.traffic.group, this.patrol.root, this.pickups.group, this.shadows.mesh, this.fx.mesh, this.fx.pows);
    for (const rv of this.riders) this.group.add(rv.root);
    for (const rd of this.ragdolls) this.group.add(rd.group);
    stage.scene.add(this.group);
    // After the first race's warm-up every program exists, so this is only cache lookups; it catches the odd
    // one a new stage brings (road works, signs) at the start rather than mid-race.
    if (stage.warmed) stage.renderer.compile(stage.scene, stage.camera);
  }

  /**
   * Compiles every shader program the race can use and uploads its textures, before boot reports the game
   * ready, so the first crash, pow or pickup doesn't stall on a compile (seconds on weak ANGLE machines).
   * three's compile walks hidden objects too, so the pooled and hidden ones (pows, sparks, ragdolls, trails,
   * the buggy, a pickup ring) are covered without showing them; nothing is moved and the sim isn't touched.
   * compileAsync lets the driver compile in parallel (KHR_parallel_shader_compile) while the page stays live.
   * Bounded by PREWARM_MAX: past that, boot goes on and the rest compiles in the background.
   */
  async prewarm(): Promise<void> {
    const r = this.stage.renderer;
    const { scene, camera } = this.stage;
    const seen = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mt)) if ((v as THREE.Texture | null)?.isTexture) seen.add(v as THREE.Texture);
      }
    });
    for (const t of seen) r.initTexture(t);
    try {
      if (!r.compileAsync) r.compile(scene, camera);
      else await Promise.race([r.compileAsync(scene, camera), new Promise((ok) => setTimeout(ok, PREWARM_MAX))]);
    } catch {
      // not fatal: whatever didn't compile here compiles when first drawn
    }
    this.stage.warmed = true;
  }

  /**
   * Hands this race's own GPU objects to the stage to free (after the next frame, see Stage.retire): its
   * geometries and materials except the shared ones kept across races, every instanced mesh's instance
   * buffers, and the track's textures.
   */
  dispose(): void {
    const bin = new Set<{ dispose(): void }>();
    this.track.collect(bin);
    for (const m of this.hazards.materials) bin.add(m);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!isShared(m.geometry)) bin.add(m.geometry);
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!isShared(mt)) bin.add(mt);
      if ((o as THREE.InstancedMesh).isInstancedMesh) bin.add(o as THREE.InstancedMesh);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) bin.add((o as THREE.SkinnedMesh).skeleton); // its bone texture
    });
    this.group.removeFromParent();
    this.stage.retire(bin);
  }

  /**
   * Draw another run of the same race (the same seed and options, so the same road, hazards and riders): the
   * highlight's re-simulation, and back. What was drawn of the old one (springs, ragdolls) starts over.
   */
  rebind(w: World): void {
    this.w = w;
    this.drawX = [];
    this.drawVx = [];
    this.slid.length = 0;
    this.first = true;
    this.shakeAmp = 0;
    w.riders.forEach((r, i) => {
      const down = r.state === 'down';
      this.riders[i].setDown(down);
      this.ragdolls[i].hide();
      if (down) this.ragdolls[i].throw(r.bikeX, r.bikeZ, 0, 0, Math.random, 0.5);
    });
  }

  scatterCones(x: number, z: number): void {
    this.track.scatterCones(x, z, Math.random);
  }

  /** How high rider i is drawn: up a ramp's slope, or along the arc of a jump. */
  private lift(i: number, x: number, z: number, alpha: number): number {
    const r = this.w.riders[i];
    if (r.state !== 'ride') return 0;
    if (r.airT > 0 && r.airMax > 0) {
      const k = Math.min(1, Math.max(0, 1 - (r.airT - alpha) / r.airMax));
      const lip = this.lipH(i);
      return lip * (1 - k) + Math.min(2.4, 0.075 * r.airMax) * 4 * k * (1 - k);
    }
    return rampLift(this.w.road.ramps, x, z);
  }

  /** The lip height of the ramp rider i took off from (the last ramp behind it). */
  private lipH(i: number): number {
    const r = this.w.riders[i];
    let best: { trail: boolean; z: number } | null = null;
    for (const m of this.w.road.ramps) if (m.z <= r.z && (!best || m.z > best.z)) best = m;
    return best ? (best.trail ? RAMP_LOOK.trailH : RAMP_LOOK.roadH) : 0;
  }

  shake(amount: number): void {
    if (MOTION.calm) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Screen position (CSS px) of a sim point, or null when behind the camera. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    toWorld(x, y, z, this.v).project(this.stage.camera);
    if (this.v.z > 1) return false;
    out.x = (this.v.x * 0.5 + 0.5) * this.stage.cssW;
    out.y = (-this.v.y * 0.5 + 0.5) * this.stage.cssH;
    return true;
  }

  /** Screen position (CSS px) of a point h metres above rider i as drawn this frame (interpolated). */
  projectRider(i: number, h: number, out: { x: number; y: number }): boolean {
    this.v.copy(this.riders[i].root.position);
    this.v.y += h;
    this.v.project(this.stage.camera);
    if (this.v.z > 1) return false;
    out.x = (this.v.x * 0.5 + 0.5) * this.stage.cssW;
    out.y = (-this.v.y * 0.5 + 0.5) * this.stage.cssH;
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
      // down, the model is just the scooter lying where it slid to; the body is the ragdoll
      const down = r.state === 'down';
      const x = this.smoothX(i, down ? lerp(r.bikePX, r.bikeX, alpha) : lerp(r.px, r.x, alpha), dt);
      const z = down ? lerp(r.bikePZ, r.bikeZ, alpha) : lerp(r.pz, r.z, alpha);
      place(rv.root, x, down ? 0 : this.lift(i, x, z, alpha), z, rv.yaw);
      rv.setWeapon(r.weapon);
      rv.charge = r.isPlayer ? Math.max(0, Math.min(1, (r.charge - 6) / (CHARGE.full - 6))) : 0;
      rv.update(dt, r.speed, this.drawVx[i], r.rubT > 0 ? r.rubSide : 0);
      // Blink while invulnerable after getting back up.
      rv.root.visible = r.invT <= 0 || Math.floor(r.invT / 3) % 2 === 0;
      if (r.state === 'ride') this.shadows.add(x, z, 0.5, 0.75);
      else this.shadows.add(x, z, 0.6, 0.6);
      const rd = this.ragdolls[i];
      // the player leaning the tumbling body (bowling): the ragdoll moves with the sim's slide
      if (down) rd.nudge(r.slide - (this.slid[i] ?? 0));
      this.slid[i] = down ? r.slide : 0;
      const stand = standTicks();
      if (down && r.runT > 0 && r.runT <= stand) {
        // getting up (the sim keeps it where it lay): the time since, between ticks
        rd.getUp(Math.max(0, r.runT - 2 + alpha) / TICK_HZ, r.bikeX, r.bikeZ, dt);
      } else if (down && r.runT > 0) {
        // up and running back to the scooter
        const pace = DOWN.run * Math.min(1, (r.runT - stand) / (DOWN.runUp * TICK_HZ));
        rd.run(lerp(r.px, r.x, alpha), lerp(r.pz, r.z, alpha), r.bikeX, r.bikeZ, pace, DOWN.reach, dt);
      } else rd.update(dt);
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
    this.hazards.update(w, dt, alpha);
    this.fx.scale = this.stage.fxScale;
    this.fx.update(dt, this.stage.camera);
    this.updateCamera(dt, alpha);
    this.stage.render();
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
    // partway across the road; out past it (on a trail) the camera goes all the way with the rider
    const out = Math.max(0, Math.abs(fx) - 5) * Math.sign(fx);
    const follow = this.cine ? 1 : cfg.follow;
    this.focusX += ((fx - out) * follow + out - this.focusX) * k;
    this.focusZ = this.first ? fz : this.focusZ + (fz - this.focusZ) * Math.min(1, dt * 14);
    this.first = false;
    const cam = this.stage.camera;
    if (this.cine) {
      // low at the roadside, a little ahead, looking back across at the player
      toWorld(this.focusX + this.cine * 6.5, 1.6, this.focusZ + 4, this.camPos);
      toWorld(this.focusX, 1, this.focusZ, this.camLook);
    } else {
      toWorld(this.focusX, cfg.h, this.focusZ - cfg.back, this.camPos);
      toWorld(this.focusX * 0.8, cfg.lookY, this.focusZ + cfg.look, this.camLook);
    }
    if (this.shakeAmp > 0.001) {
      const s = this.shakeAmp;
      this.camPos.x += (Math.random() - 0.5) * s;
      this.camPos.y += (Math.random() - 0.5) * s;
      this.shakeAmp *= Math.exp(-dt * 10);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    const boost = Math.min(10, Math.max(0, p.speed - 12) * 0.55) * (MOTION.calm ? 0.4 : 1);
    this.fovBoost += (boost - this.fovBoost) * Math.min(1, dt * 3);
    const fov = cfg.fov + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
