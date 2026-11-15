// The shape of the road: the bends and hills every piece of the course is placed against, and the ramp
// surfaces that sit on it. Pure maths over `phase`, no three.js scene -- split out of track.ts in 3.3.34,
// which had grown to nine lines under the 500-line cap.

import * as THREE from 'three';
import type { Ramp } from '../sim/road';

let phase = 0;
/** The bends' phase, which the last Track built set: the launch mode builds its own road and puts this back after. */
export const roadPhase = (): number => phase;
export const setRoadPhase = (p: number): void => { phase = p; };

/** Sideways offset of the road centre at distance z. */
export function centreX(z: number): number {
  return 34 * Math.sin(z / 230 + phase) + 14 * Math.sin(z / 87 + phase * 2.3) - 34 * Math.sin(phase) - 14 * Math.sin(phase * 2.3);
}

/** Road height at distance z. */
export function heightAt(z: number): number {
  return 7 * Math.sin(z / 170 + phase * 1.7) + 2.2 * Math.sin(z / 57 + phase) - 7 * Math.sin(phase * 1.7) - 2.2 * Math.sin(phase);
}

/** Sim (x across, y up, z along) to world. Sim +x is the screen's right when looking down the road (+z). */
export function toWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-(centreX(z) + x), heightAt(z) + y, z);
}

/** Heading (rotation about y) and pitch of the road at z. */
export function yawAt(z: number): number {
  return Math.atan(-(centreX(z + 1) - centreX(z - 1)) / 2);
}
export function pitchAt(z: number): number {
  return Math.atan((heightAt(z + 1) - heightAt(z - 1)) / 2);
}

/** Put an object on the road at sim (x, y, z), facing down the road, with optional extra yaw. */
export function place(o: THREE.Object3D, x: number, y: number, z: number, yaw = 0): void {
  toWorld(x, y, z, o.position);
  o.rotation.set(-pitchAt(z), yawAt(z) + yaw, 0, 'YXZ');
}

/** Drawn ramp sizes: length up the slope and height at the lip. */
export const RAMP_LOOK = { roadL: 4, roadH: 0.7, trailL: 5.5, trailH: 0.9 };

/** Height of the ramp surface under sim (x, z), 0 off every ramp. */
export function rampLift(ramps: readonly Ramp[], x: number, z: number): number {
  for (const r of ramps) {
    const L = r.trail ? RAMP_LOOK.trailL : RAMP_LOOK.roadL;
    const d = r.z - z;
    if (d < 0 || d > L || Math.abs(x - r.x) > r.halfW) continue;
    return (r.trail ? RAMP_LOOK.trailH : RAMP_LOOK.roadH) * (1 - d / L);
  }
  return 0;
}

/** A wedge rising along +z from 0 at z = -len to h at z = 0, 2*halfW wide. Non-indexed, flat-shaded. */
export function wedge(halfW: number, len: number, h: number): THREE.BufferGeometry {
  const w = halfW;
  const A = [-w, 0, -len], B = [w, 0, -len], Cc = [-w, h, 0], D = [w, h, 0], E = [-w, 0, 0], F = [w, 0, 0];
  const tris = [A, D, B, A, Cc, D, E, F, D, E, D, Cc, A, E, Cc, B, D, F];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  return g;
}
