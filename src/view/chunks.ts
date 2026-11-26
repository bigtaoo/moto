// A course as slices: one group holding everything a track is built from, cut into CHUNK-long pieces along
// z so the camera's frustum and far plane drop what is out of sight, plus the bin of textures, materials and
// geometries that go with it. Knows how long a course is and how to lay a strip of ground along it; knows
// nothing about roads, cones or trees -- track.ts and roadworks.ts put those in.

import * as THREE from 'three';
import { toWorld } from './road';

/** Distance between the rows of a strip, in m. */
export const SEG = 2;
/** Length of a course slice, in m (a multiple of SEG, so slices of a strip meet row on row). */
export const CHUNK = 150;

/** One instance of something, with the z it is bucketed by. */
export interface Placed {
  z: number;
  m: THREE.Matrix4;
  c?: THREE.Color;
}

export class Chunks {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];

  add(...objects: THREE.Object3D[]): void {
    this.group.add(...objects);
  }

  /** Hands this chunk set something it is now responsible for freeing, and gives it straight back. */
  keep<T extends { dispose(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }

  /**
   * Adds what was built here and nothing else frees (textures, materials, geometries) to `bin`; the race
   * view frees it all once the next race is drawn (Stage.retire).
   */
  collect(bin: Set<{ dispose(): void }>): void {
    for (const o of this.owned) bin.add(o);
  }

  /** Instances bucketed by z into one InstancedMesh per course slice. */
  sliced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placed[]): void {
    const buckets = new Map<number, Placed[]>();
    for (const it of items) {
      const b = Math.floor(it.z / CHUNK);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(it);
    }
    for (const list of buckets.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); if (it.c) mesh.setColorAt(i, it.c); });
      this.group.add(mesh);
    }
  }

  /** A strip in slices sharing one material. */
  strips(from: number, to: number, mat: THREE.Material, xs: number[], yOff: (x: number, z: number) => number, color?: (x: number, z: number) => THREE.Color): void {
    for (let z = from; z < to; z += CHUNK) this.group.add(new THREE.Mesh(this.strip(z, Math.min(z + CHUNK, to), xs, yOff, color), mat));
  }

  /** One slice of a strip: a row of vertices every SEG m, bent onto the road by toWorld. */
  strip(from: number, to: number, xs: number[], yOff: (x: number, z: number) => number, color?: (x: number, z: number) => THREE.Color): THREE.BufferGeometry {
    const rows = Math.ceil((to - from) / SEG) + 1;
    const cols = xs.length;
    const pos = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    const col = color ? new Float32Array(rows * cols * 3) : null;
    const v = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      const z = from + r * SEG;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        toWorld(xs[c], yOff(xs[c], z), z, v);
        pos.set([v.x, v.y, v.z], i * 3);
        uv.set([c / (cols - 1), z / 8], i * 2);
        if (col && color) { const k = color(xs[c], z); col.set([k.r, k.g, k.b], i * 3); }
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return this.keep(g);
  }

  /**
   * Nothing a course holds ever moves again (cones are knocked over through an instance matrix, not by
   * moving the mesh), so each piece keeps the matrix it was built with and the renderer composes none of
   * them again. Call once, after everything is in.
   *
   * 3.3.66: this used to clear matrixWorldAutoUpdate as well, which three reads as "never compose this
   * object's world matrix" -- the first time included. Every piece put down with place() was therefore
   * drawn at the world origin, which is exactly where the player starts: both arches' four posts, both
   * chequered beams, the start and finish lines, the roadworks signs, arrow and roller and the ramps,
   * all in one pile in the middle of the opening frame. (The road, the ground, the barriers, the trees
   * and the cones never showed it, because their vertices are built in world coordinates already.) The
   * world matrices are composed once, here; after that matrixWorldNeedsUpdate stays false and the
   * renderer recomposes nothing, which is all the saving the old line was after.
   */
  seal(): void {
    this.group.traverse((o) => { if (o !== this.group) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    this.group.updateMatrixWorld(true);
  }
}
