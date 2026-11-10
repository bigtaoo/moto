// ?stats: frame rate and what the GPU is asked to draw, for checking the art budget on a phone.

import type { WebGLRenderer } from 'three';

export function statsOverlay(renderer: WebGLRenderer): (dt: number) => void {
  const el = document.body.appendChild(document.createElement('pre'));
  el.style.cssText = 'position:fixed;left:4px;bottom:4px;margin:0;padding:4px 6px;font:11px/1.3 monospace;color:#fff;background:#000a;pointer-events:none;z-index:99';
  let time = 0;
  let n = 0;
  let worst = 0;
  return (dt) => {
    time += dt;
    n++;
    worst = Math.max(worst, dt);
    if (time < 0.5) return;
    const r = renderer.info;
    el.textContent = `${Math.round(n / time)} fps  worst ${Math.round(worst * 1000)} ms
` +
      `${r.render.calls} calls  ${(r.render.triangles / 1000).toFixed(1)}k tris
` +
      `${r.memory.geometries} geos  ${r.memory.textures} tex  ${r.programs?.length ?? 0} progs`;
    time = n = worst = 0;
  };
}
