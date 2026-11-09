// Small canvas textures drawn in code (no image files).

import * as THREE from 'three';

export function makeCanvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The crash-test target: a circle split into quarters, black and yellow. */
export function drawTestSymbol(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, light = '#f2c230'): void {
  for (let q = 0; q < 4; q++) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, (q * Math.PI) / 2, ((q + 1) * Math.PI) / 2);
    g.closePath();
    g.fillStyle = q % 2 ? light : '#16161a';
    g.fill();
  }
  g.lineWidth = r * 0.08;
  g.strokeStyle = '#16161a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
}

/** A white square board with the test symbol, for roadside signs. */
export function testSymbolTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16161a';
    g.fillRect(0, 0, w, 6);
    g.fillRect(0, h - 6, w, 6);
    drawTestSymbol(g, w / 2, h / 2, w * 0.36);
  });
}
