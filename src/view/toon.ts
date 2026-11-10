// The look: models built in code from simple parts, coloured per vertex, lit with a few hard light
// bands (toon) and drawn with a dark outline. No textures, no image files.
//
// A Kit collects parts (geometry + colour) and merges them into ONE geometry, so a whole car or a
// rider's arm is one draw call. The outline is an "inverted hull" baked into that same geometry: each
// part again, pushed out along smoothed normals, winding flipped, coloured dark. With front-face
// culling only its far side shows, as a rim around the part. No post-processing pass.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(n).fill(paint), 1));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** The part pushed out along normals averaged across its hard edges, inside out, in ink. */
function hullOf(g: THREE.BufferGeometry, ink: number, color: number): THREE.BufferGeometry {
  const smooth = new THREE.BufferGeometry();
  smooth.setAttribute('position', g.attributes.position.clone());
  const welded = mergeVertices(smooth, 1e-4);
  welded.computeVertexNormals();
  const h = welded.toNonIndexed();
  const pos = h.attributes.position;
  const nor = h.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * ink, pos.getY(i) + nor.getY(i) * ink, pos.getZ(i) + nor.getZ(i) * ink);
    nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
  // flip winding: swap the 2nd and 3rd vertex of every triangle
  for (let t = 0; t < pos.count; t += 3) {
    for (const a of [pos, nor]) {
      const x = a.getX(t + 1), y = a.getY(t + 1), z = a.getZ(t + 1);
      a.setXYZ(t + 1, a.getX(t + 2), a.getY(t + 2), a.getZ(t + 2));
      a.setXYZ(t + 2, x, y, z);
    }
  }
  return paintAttrs(h, color, 0);
}
