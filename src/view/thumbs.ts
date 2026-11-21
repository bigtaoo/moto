// Pictures of the things the garage sells, drawn from the geometry the race itself uses. 3.3.66: the Rides
// tab listed six vehicles as three lines of text each, so "Shopping cart" and "Office chair" read as the
// same purchase; the Looks tab gave paint a swatch but left hats and weapons as bare names.
//
// A throwaway 128 px renderer draws each one once, to a data URL kept for the session. It is opened on the
// first picture of a batch and closed on the microtask after it, so the garage never holds a second WebGL
// context while the race is running. Everything is wrapped: a refused context (an old phone, a lost one
// after a long session) just gives back '' and the caller falls back to the plain card it had before.

import * as THREE from 'three';
import { buildRide } from './rides';
import { makeHat } from './hats';
import { makeWeapon } from './rider';
import { kitMaterial } from './toon';
import type { Hat } from '../shop';
import type { WeaponKind } from '../sim/config';

const SIZE = 128;
const cache = new Map<string, string>();

let gl: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let cam: THREE.PerspectiveCamera | null = null;
let closing = false;
/** Set once a context has been refused: no point asking again this session. */
let broken = false;

function open(): boolean {
  if (gl) return true;
  if (broken) return false;
  try {
    gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.setPixelRatio(1);
    gl.setSize(SIZE, SIZE, false);
    scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9080, 2.4), sun);
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  } catch {
    gl = null;
    broken = true;
  }
  return !!gl;
}

function close(): void {
  closing = false;
  if (!gl) return;
  gl.dispose();
  gl.forceContextLoss();
  gl = null;
  scene = null;
  cam = null;
}

/** A PNG data URL of what `make` builds, framed to fill the square; '' when it could not be drawn. */
function shot(key: string, make: () => THREE.Object3D | null): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    if (open()) {
      const obj = make();
      if (obj) {
        scene!.add(obj);
        const box = new THREE.Box3().setFromObject(obj);
        const c = box.getCenter(new THREE.Vector3());
        // far enough back that the bounding sphere fits the 30 degree frame, from three quarters above
        const d = (box.getSize(new THREE.Vector3()).length() / 2) / Math.sin((cam!.fov * Math.PI) / 360) * 0.98;
        cam!.position.set(c.x + d * 0.62, c.y + d * 0.42, c.z + d * 0.66);
        cam!.lookAt(c);
        gl!.render(scene!, cam!);
        url = gl!.domElement.toDataURL('image/png');
        scene!.remove(obj);
      }
    }
  } catch {
    url = '';
  }
  cache.set(key, url);
  // the tab draws its whole list in one go: close once that run of calls is over, not between them
  if (gl && !closing) {
    closing = true;
    queueMicrotask(close);
  }
  return url;
}

/** `<img>` markup for a thumbnail, or '' where there is nothing to show. */
const img = (url: string, cls: string): string => (url ? `<img class="${cls}" src="${url}" alt="" loading="lazy">` : '');

/** The vehicle as it is ridden (the player's current ride number picks the wheels and the frame). */
export const rideThumb = (v: number, ride: number): string =>
  img(shot(`ride:${v}:${ride}`, () => new THREE.Mesh(buildRide(v, ride).kit.build(), kitMaterial())), 'thumb');

/** A hat on its own; 'none' has nothing to draw. */
export const hatThumb = (h: Hat): string => (h === 'none' ? '' : img(shot(`hat:${h}`, () => makeHat(h)), 'thumb sm'));

/** A weapon on its own. */
export const weaponThumb = (k: WeaponKind): string => img(shot(`wep:${k}`, () => makeWeapon(k)), 'thumb sm');
