// The look: models built in code from simple parts, coloured per vertex, lit with a few hard light
// bands (toon) and drawn with a dark outline. No textures, no image files.
//
// A Kit collects parts (geometry + colour) and merges them into ONE geometry, so a whole car or a
// rider's arm is one draw call. The outline is an "inverted hull" baked into that same geometry: each
// part again, pushed out along smoothed normals, winding flipped, coloured dark. With front-face
// culling only its far side shows, as a rim around the part. No post-processing pass.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INK = 0x1b1b22;

let ramp: THREE.DataTexture | null = null;

/** Light bands: shadow, mid, lit. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const levels = [120, 200, 255];
  ramp = new THREE.DataTexture(new Uint8Array(levels), levels.length, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });
}

// What lives across races. RaceView.dispose frees every geometry and material it finds in its scene
// graph except these: the next race uses them again, and disposing them would only make it rebuild them.
const keepers = new WeakSet<object>();
/** Mark a geometry or material as kept across races. */
export function shared<T extends object>(o: T): T {
  keepers.add(o);
  return o;
}
export const isShared = (o: object) => keepers.has(o);

let unitBox: THREE.BufferGeometry | null = null;
/**
 * A box with rounded corners and edges, the same shape three's `RoundedBoxGeometry` makes with one
 * segment, built from a unit box kept across calls and without texture coordinates. Kits delete those
 * unread, and three spends most of a rounded box on them (an `angleTo` per vertex per axis): between that
 * and the shared unit box this is the cheapest part of the opening to make, and the opening makes
 * hundreds (3.3.57).
 */
export function roundedBox(w: number, h: number, d: number, radius: number): THREE.BufferGeometry {
  const r = Math.min(w / 2, h / 2, d / 2, radius);
  unitBox ??= new THREE.BoxGeometry(1, 1, 1, 3, 3, 3).toNonIndexed();
  const src = unitBox.attributes.position.array as Float32Array;
  const n = src.length;
  const pos = new Float32Array(n);
  const nor = new Float32Array(n);
  const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r;
  const half = 0.5 / 3; // the unit box's segment size: pulls a vertex off its face before normalising
  for (let i = 0; i < n; i += 3) {
    const px = src[i], py = src[i + 1], pz = src[i + 2];
    let nx = px - Math.sign(px) * half, ny = py - Math.sign(py) * half, nz = pz - Math.sign(pz) * half;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    pos[i] = bx * Math.sign(px) + nx * r;
    pos[i + 1] = by * Math.sign(py) + ny * r;
    pos[i + 2] = bz * Math.sign(pz) + nz * r;
    nor[i] = nx; nor[i + 1] = ny; nor[i + 2] = nz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

const prims = new Map<string, THREE.BufferGeometry>();
/**
 * A primitive shape built once per size and handed out again. `Kit.add` copies whatever it is given, so
 * no two parts share one. Worth it because the shapes a model is built from repeat (two arms, four
 * wheels, the same crate in every car) and because three's rounded box spends most of its time on the
 * texture coordinates, which a kit deletes unread: cached, that waste is paid once (3.3.57).
 */
export function prim(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = prims.get(key);
  if (!g) {
    g = build();
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    prims.set(key, g);
  }
  return g;
}

const built = new Map<string, THREE.BufferGeometry>();
/**
 * A kit-built geometry, built once per `key` and kept. Building a rider means hundreds of mergeVertices
 * calls (the outlines); the key must hold everything the geometry depends on (vehicle, colours). Keys come
 * from fixed palettes, so this stays small.
 */
export function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = built.get(key);
  if (!g) built.set(key, (g = shared(build())));
  return g;
}

let kitMat: THREE.MeshToonMaterial | null = null;
/** One material for every kit-built model that needs nothing per object. */
export function kitMaterial(): THREE.MeshToonMaterial {
  kitMat ??= shared(toonMaterial({ vertexColors: true }));
  return kitMat;
}

let painted: THREE.MeshToonMaterial | null = null;
/**
 * For instanced kits: the instance colour tints only the parts added with `paint: 1` (a car's body),
 * not its glass, tyres or outline.
 */
export function paintedMaterial(): THREE.MeshToonMaterial {
  if (painted) return painted;
  painted = shared(toonMaterial({ vertexColors: true }));
  painted.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float paint;')
      .replace('#include <color_vertex>', `
        vColor = vec4(1.0);
        vColor.rgb *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, paint);
        #endif`);
  };
  painted.customProgramCacheKey = () => 'painted';
  return painted;
}

export interface PartOpts {
  at?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  /** Outline this part (default true). Off for flat decals and tiny bits. */
  ink?: boolean;
  /** 1: tinted by the instance colour (see paintedMaterial). */
  paint?: number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();

export class Kit {
  private readonly body: THREE.BufferGeometry[] = [];
  private readonly hull: THREE.BufferGeometry[] = [];

  /** @param ink outline thickness in metres (0: none) */
  constructor(private readonly ink = 0.03, private readonly inkColor = INK) {}

  add(geo: THREE.BufferGeometry, color: number, o: PartOpts = {}): this {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.deleteAttribute('uv');
    m4.compose(v.set(...(o.at ?? [0, 0, 0])), q.setFromEuler(e.set(...(o.rot ?? [0, 0, 0]))), s.set(...(o.scale ?? [1, 1, 1])));
    g.applyMatrix4(m4);
    this.body.push(paintAttrs(g, color, o.paint ?? 0));
    if ((o.ink ?? true) && this.ink > 0) this.hull.push(hullOf(g, this.ink, this.inkColor));
    return this;
  }

  /** The crash-test target as flat geometry facing +z: quarters of ink and `light`, with an ink rim. */
  decal(r: number, light: number, o: PartOpts = {}): this {
    const parts: THREE.BufferGeometry[] = [];
    const rim = new THREE.CircleGeometry(r * 1.14, 16).translate(0, 0, -0.002);
    parts.push(paintAttrs(rim.toNonIndexed(), INK, 0));
    for (let i = 0; i < 4; i++) {
      const g = new THREE.CircleGeometry(r, 4, (i * Math.PI) / 2, Math.PI / 2).toNonIndexed();
      parts.push(paintAttrs(g, i % 2 ? light : INK, 0));
    }
    for (const p of parts) p.deleteAttribute('uv');
    const g = mergeGeometries(parts)!;
    return this.add(g, -1, { ...o, ink: false });
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries([...this.body, ...this.hull])!;
    g.computeBoundingSphere();
    return g;
  }
}


/** Colour every vertex (color < 0 keeps existing colours) and set the paint mask. */
function paintAttrs(g: THREE.BufferGeometry, color: number, paint: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  if (color >= 0 || !g.attributes.color) {
    c.setHex(Math.max(0, color), THREE.SRGBColorSpace);
    const col = new Float32Array(n * 3);
    // written straight into the array: `col.set([r, g, b], i * 3)` allocates a three-element array per
    // vertex, and a race's models are hundreds of thousands of vertices (3.3.57)
    const { r, g: gr, b } = c;
    for (let i = 0; i < n * 3; i += 3) { col[i] = r; col[i + 1] = gr; col[i + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(n).fill(paint), 1));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Vertices this close together (metres) are the same corner when the outline's normals are averaged. */
const WELD = 1e-4;

/**
 * The part pushed out along normals averaged across its hard edges, inside out, in ink.
 *
 * Written over the typed arrays in one pass rather than with `mergeVertices` + `computeVertexNormals` +
 * `toNonIndexed` + the attribute accessors: this runs once per part of every model, hundreds of times for
 * a race's riders, cars and props, and three's weld hashes each vertex into a string, which made it the
 * single most expensive thing the boot did (3.3.57). The welding is the same: positions quantised to
 * WELD, their face normals summed (so the sum is area-weighted, as three's is) and normalised.
 */
function hullOf(g: THREE.BufferGeometry, ink: number, color: number): THREE.BufferGeometry {
  const src = g.attributes.position.array as ArrayLike<number>;
  const n = g.attributes.position.count;
  // weld: a quantised position to its slot in the normal accumulator
  const slot = new Int32Array(n);
  const at = new Map<number, number[]>();
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  let slots = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.round(src[i * 3] / WELD), b = Math.round(src[i * 3 + 1] / WELD), d = Math.round(src[i * 3 + 2] / WELD);
    const key = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(d, 83492791)) | 0;
    const bucket = at.get(key);
    let found = -1;
    if (bucket) { for (const s of bucket) if (qx[s] === a && qy[s] === b && qz[s] === d) { found = s; break; } }
    if (found < 0) {
      found = slots++;
      qx[found] = a; qy[found] = b; qz[found] = d;
      if (bucket) bucket.push(found); else at.set(key, [found]);
    }
    slot[i] = found;
  }
  // every face's normal (cross product, so its length is twice the area) summed onto its three corners
  const acc = new Float32Array(slots * 3);
  for (let t = 0; t < n; t += 3) {
    const i0 = t * 3, i1 = i0 + 3, i2 = i0 + 6;
    const ax = src[i1] - src[i0], ay = src[i1 + 1] - src[i0 + 1], az = src[i1 + 2] - src[i0 + 2];
    const bx = src[i2] - src[i0], by = src[i2 + 1] - src[i0 + 1], bz = src[i2 + 2] - src[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (let k = 0; k < 3; k++) {
      const s = slot[t + k] * 3;
      acc[s] += nx; acc[s + 1] += ny; acc[s + 2] += nz;
    }
  }
  for (let s = 0; s < slots * 3; s += 3) {
    const len = Math.hypot(acc[s], acc[s + 1], acc[s + 2]) || 1;
    acc[s] /= len; acc[s + 1] /= len; acc[s + 2] /= len;
  }
  // push out along the smoothed normal, flip the normal and swap the 2nd and 3rd vertex of every triangle
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const from = t + k;
      const to = (t + (k === 1 ? 2 : k === 2 ? 1 : 0)) * 3;
      const s = slot[from] * 3;
      pos[to] = src[from * 3] + acc[s] * ink;
      pos[to + 1] = src[from * 3 + 1] + acc[s + 1] * ink;
      pos[to + 2] = src[from * 3 + 2] + acc[s + 2] * ink;
      nor[to] = -acc[s]; nor[to + 1] = -acc[s + 1]; nor[to + 2] = -acc[s + 2];
    }
  }
  const h = new THREE.BufferGeometry();
  h.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  h.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return paintAttrs(h, color, 0);
}

/**
 * Parts merged into ONE geometry for a skinned mesh, part k riding bone k at full weight: a body whose
 * parts move apart (a rider's torso and arms, a ragdoll's limbs) in one draw call instead of one each.
 */
export function rigidParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((p, k) => {
    const g = p.clone();
    const n = g.attributes.position.count;
    const idx = new Uint8Array(n * 4);
    const wt = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { idx[i * 4] = k; wt[i * 4] = 255; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4, true));
    return g;
  }))!;
  return merged;
}

/**
 * A mesh of `rigidParts` whose bones are plain scene objects: part k is drawn as if it were a child of
 * `bones[k]` (identity bind and inverse matrices). three computes a skinned mesh's bounding sphere once
 * and lets it go stale, so the caller passes one (in the mesh's frame) and keeps it where the body is.
 */
export function rigidMesh(geo: THREE.BufferGeometry, mat: THREE.Material, bones: THREE.Object3D[], sphere: THREE.Sphere): THREE.SkinnedMesh {
  const m = new THREE.SkinnedMesh(geo, mat);
  m.bind(new THREE.Skeleton(bones as THREE.Bone[], bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  m.boundingSphere = sphere;
  return m;
}
