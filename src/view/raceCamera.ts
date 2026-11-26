// Where the race camera stands, where it points, and how a sim point lands on the screen. It is told a focus
// point each frame (the player, or the dummy while it is down) and follows it with a spring; everything else
// -- the framing per orientation, the speed-widened fov, the shake, the highlight's side camera, and the
// steering gain the drag scale is read from -- is its own. Reads nothing from the World.

import * as THREE from 'three';
import { toWorld } from './road';
import { MOTION } from './motion';
import type { Stage } from './stage';

/** Camera framing per orientation: portrait sees more road ahead from higher up. */
const CAM = {
  portrait: { fov: 66, h: 8.6, back: 10, look: 12, lookY: 0, follow: 0.45 },
  landscape: { fov: 54, h: 3.8, back: 6.6, look: 12, lookY: 0.8, follow: 0.6 },
};

/**
 * Degrees the camera widens by at `speed`. The old single slope (0.55 deg per m/s, capped at 10) ran out at
 * 30.2 m/s, which the player passes about the Mobility Scooter -- and 60% of a mid- or late-career race was
 * spent over that line, so every top-speed upgrade after it bought a bigger number on the HUD and no change
 * on screen at all (doc 3.3.31). The first slope is untouched, so the early career looks exactly as it did;
 * past the old ceiling a shallower one carries on to 14 degrees, which the fastest bike in the game
 * (49.3 m/s) still does not quite reach.
 */
function speedFov(speed: number): number {
  const over = Math.max(0, speed - 12) * 0.55;
  return over <= 10 ? over : Math.min(14, 10 + (over - 10) * (0.18 / 0.55));
}

export class RaceCamera {
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  /** A spare camera the steering gain is measured on, so the real one is never disturbed. */
  private readonly probe = new THREE.PerspectiveCamera(60, 1, 0.3, 600);
  private gain = 0;
  private gainKey = '';
  private focusX = 0;
  private focusZ = 0;
  private fovBoost = 0;
  private shakeAmp = 0;
  private first = true;

  constructor(private readonly stage: Stage) {}

  /** Metres the camera stands behind the point it follows, in the orientation showing now. */
  get back(): number {
    return (this.stage.portrait ? CAM.portrait : CAM.landscape).back;
  }

  /** Another run of the same race: snap to the next focus point rather than spring across to it. */
  reset(): void {
    this.first = true;
    this.shakeAmp = 0;
  }

  shake(amount: number): void {
    if (MOTION.calm) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /**
   * Follow sim (fx, fz) at `speed` m/s. `cine` is the highlight's side camera: which side of the focus it
   * stands on, 0 for the race camera.
   */
  follow(fx: number, fz: number, speed: number, dt: number, cine: number): void {
    const cfg = this.stage.portrait ? CAM.portrait : CAM.landscape;
    const k = this.first ? 1 : Math.min(1, dt * 6);
    // partway across the road; out past it (on a trail) the camera goes all the way with the rider
    const out = Math.max(0, Math.abs(fx) - 5) * Math.sign(fx);
    const follow = cine ? 1 : cfg.follow;
    this.focusX += ((fx - out) * follow + out - this.focusX) * k;
    this.focusZ = this.first ? fz : this.focusZ + (fz - this.focusZ) * Math.min(1, dt * 14);
    this.first = false;
    const cam = this.stage.camera;
    if (cine) {
      // low at the roadside, a little ahead, looking back across at the player
      toWorld(this.focusX + cine * 6.5, 1.6, this.focusZ + 4, this.pos);
      toWorld(this.focusX, 1, this.focusZ, this.look);
    } else {
      toWorld(this.focusX, cfg.h, this.focusZ - cfg.back, this.pos);
      toWorld(this.focusX * 0.8, cfg.lookY, this.focusZ + cfg.look, this.look);
    }
    if (this.shakeAmp > 0.001) {
      const s = this.shakeAmp;
      this.pos.x += (Math.random() - 0.5) * s;
      this.pos.y += (Math.random() - 0.5) * s;
      this.shakeAmp *= Math.exp(-dt * 10);
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    this.fovBoost += (speedFov(speed) * (MOTION.calm ? 0.4 : 1) - this.fovBoost) * Math.min(1, dt * 3);
    const fov = cfg.fov + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Screen position (CSS px) of a sim point, or null when behind the camera. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    return this.onScreen(toWorld(x, y, z, this.v), out);
  }

  /** Screen position (CSS px) of a point `h` metres above the world position `at`. */
  projectAbove(at: THREE.Vector3, h: number, out: { x: number; y: number }): boolean {
    this.v.copy(at);
    this.v.y += h;
    return this.onScreen(this.v, out);
  }

  private onScreen(world: THREE.Vector3, out: { x: number; y: number }): boolean {
    world.project(this.stage.camera);
    if (world.z > 1) return false;
    out.x = (world.x * 0.5 + 0.5) * this.stage.cssW;
    out.y = (-world.y * 0.5 + 0.5) * this.stage.cssH;
    return true;
  }

  /**
   * Screen px the player slides sideways for one metre across the road. It is far less than the projection's
   * px per metre, because the camera follows them sideways (CAM.follow) and the look-at point tracks them as
   * well, so most of the move is taken straight back out again: 22 px/m of a projected 41 in landscape,
   * 31 of 45 in portrait (doc 3.3.30). A drag is scaled by this, so the bike keeps up with the thumb.
   *
   * Measured on a straight, flat reference rather than on the road under the player: the bends and hills
   * would make the number differ by the metre, and a steering scale that moved under the thumb would be
   * worse than one a few per cent out. The speed boost is in it, though -- at a racing 26 m/s it widens the
   * fov by 8 degrees and takes a sixth off the bike's travel, which is far too much to leave out. A drag
   * holds the number it was given when the finger went down, so none of this moves mid-drag.
   */
  steerPxPerMetre(): number {
    const st = this.stage;
    const key = `${st.cssW}x${st.cssH}x${Math.round(this.fovBoost * 4)}`;
    if (this.gainKey !== key) {
      const cfg = st.portrait ? CAM.portrait : CAM.landscape;
      const cam = this.probe;
      cam.fov = cfg.fov + this.fovBoost;
      cam.aspect = st.cssW / Math.max(1, st.cssH);
      cam.updateProjectionMatrix();
      // inside the barrier CAM's `out` term is 0, so the camera takes exactly `follow` of the player's move
      const screenX = (fx: number): number => {
        cam.position.set(-fx * cfg.follow, cfg.h, -cfg.back);
        cam.lookAt(this.v.set(-fx * cfg.follow * 0.8, cfg.lookY, cfg.look));
        cam.updateMatrixWorld();
        return (this.v.set(-fx, 0.8, 0).project(cam).x * 0.5 + 0.5) * st.cssW;
      };
      this.gain = Math.abs(screenX(1) - screenX(-1)) / 2;
      this.gainKey = key;
    }
    return this.gain;
  }
}
