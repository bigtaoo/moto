// Per-division look: sky, fog, light, ground and tree colours. Same meshes everywhere; only paint changes.

import type { Division } from '../sim/config';

export interface Env {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunI: number;
  /** Two ground colours, noise-blended. */
  ground: [number, number];
  /** Off-road dirt for the shortcut trails. */
  dirt: number;
  trunk: number;
  leaves: number[];
  /** Trees per 6 m of road (1: the meadow's). */
  trees: number;
}

export const ENVS: Record<Division['env'], Env> = {
  meadow: {
    sky: 0xbfe2f2, fogNear: 110, fogFar: 330, hemiSky: 0xffffff, hemiGround: 0x5f8a4a, hemi: 1.25, sun: 0xfff4e0, sunI: 1.5,
    ground: [0x7cc25a, 0x5fa847], dirt: 0xa8865a, trunk: 0x7a5236, leaves: [0x3f8f45, 0x4f9e3a, 0x2f7a4a, 0x6aa83c], trees: 1,
  },
  desert: {
    sky: 0xf3dfb8, fogNear: 120, fogFar: 360, hemiSky: 0xfff3dc, hemiGround: 0xb08850, hemi: 1.3, sun: 0xffe2b0, sunI: 1.6,
    ground: [0xe0bd7e, 0xcda469], dirt: 0xb07a48, trunk: 0x8a6a3a, leaves: [0x7a9a48, 0x8aa65a, 0x6d8a3e], trees: 0.3,
  },
  autumn: {
    sky: 0xd8e2ea, fogNear: 100, fogFar: 310, hemiSky: 0xfff0dc, hemiGround: 0x7a6a3a, hemi: 1.2, sun: 0xffd8a8, sunI: 1.45,
    ground: [0xa3aa58, 0x8c9446], dirt: 0x9a6a42, trunk: 0x5e3e28, leaves: [0xd9622b, 0xe8a33a, 0xb8432a, 0xc9b03a, 0x8a9a3a], trees: 1.2,
  },
  snow: {
    sky: 0xdbe6ef, fogNear: 70, fogFar: 250, hemiSky: 0xffffff, hemiGround: 0x9aaabb, hemi: 1.35, sun: 0xeef4ff, sunI: 1.3,
    ground: [0xf4f7fa, 0xdfe7ef], dirt: 0x9a9088, trunk: 0x4e3a2c, leaves: [0x2f5d4a, 0x3a6b52, 0x29503f], trees: 1.1,
  },
  dusk: {
    sky: 0xf2a07a, fogNear: 90, fogFar: 300, hemiSky: 0xffc6a8, hemiGround: 0x4a4a78, hemi: 1.15, sun: 0xff9a6a, sunI: 1.4,
    ground: [0x7a8a5a, 0x5f7050], dirt: 0x8a6448, trunk: 0x5a3a30, leaves: [0x2a8a7a, 0x3aa08a, 0x1f6f6a], trees: 0.8,
  },
};
