// ?stats: frame rate and what the GPU is asked to draw, for checking the art budget on a phone.
// In a dev build the samples also go to the dev server (vite.config.ts logs them), so a phone on the
// LAN can be measured from the desktop; release builds send nothing.

import type { WebGLRenderer } from 'three';

export function statsOverlay(renderer: WebGLRenderer, where: () => string = () => ''): (dt: number) => void {
  const el = document.body.appendChild(document.createElement('pre'));
  el.style.cssText = 'position:fixed;left:4px;bottom:4px;margin:0;padding:4px 6px;font:11px/1.3 monospace;color:#fff;background:#000a;pointer-events:none;z-index:99';
  let time = 0;
  let n = 0;
  let worst = 0;
  let slow = 0; // frames over 33 ms (under 30 fps) in this sample
  const send = import.meta.env.DEV ? reporter(renderer) : null;
  return (dt) => {
    time += dt;
    n++;
    worst = Math.max(worst, dt);
    if (dt > 1 / 30) slow++;
    if (time < 0.5) return;
    const r = renderer.info;
    const fps = Math.round(n / time);
    el.textContent = `${fps} fps  worst ${Math.round(worst * 1000)} ms
` +
      `${r.render.calls} calls  ${(r.render.triangles / 1000).toFixed(1)}k tris
` +
      `${r.memory.geometries} geos  ${r.memory.textures} tex  ${r.programs?.length ?? 0} progs`;
    send?.({ fps, worst: Math.round(worst * 1000), slow, calls: r.render.calls, tris: r.render.triangles,
      geos: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length ?? 0, at: where() });
    time = n = worst = slow = 0;
  };
}

/** Batches samples to the dev server's /__stats, about every 2 s, with the device once at the start. */
function reporter(renderer: WebGLRenderer): (s: Record<string, number | string>) => void {
  const id = Math.random().toString(36).slice(2, 6);
  let queue: Record<string, number | string>[] = [];
  const post = (body: unknown) => void fetch('/__stats', { method: 'POST', body: JSON.stringify(body), keepalive: true }).catch(() => {});
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  post({ id, device: {
    ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio,
    canvas: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`, cores: navigator.hardwareConcurrency,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  } });
  setInterval(() => { if (queue.length) { post({ id, samples: queue }); queue = []; } }, 2000);
  return (s) => void queue.push(s);
}
