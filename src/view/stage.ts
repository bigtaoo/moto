// The renderer, the camera and the quality tier: everything one race's objects are drawn into.
// Split out of scene.ts, which was at the 500-line cap. Reads the World; never writes to it.

import * as THREE from 'three';
import { ENVS, type Env } from './env';
import { Governor, TIERS, TOP, forcedTier, isSoftware, probeDevice, startTier, type QualityMode } from './quality';

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
