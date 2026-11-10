// Small SVG icons, so the UI draws the same on every device instead of relying on emoji fonts.
// `icon()` gives inline markup that takes the text colour; `installIconCss()` also exposes each one as a
// CSS mask (`var(--ic-skull)` ...) for the ::before badges in style.css.

const PATHS = {
  play: 'M7 4l13 8-13 8z',
  left: 'M16 4L5 12l11 8z',
  right: 'M8 4l11 8-11 8z',
  up: 'M12 5l9 14H3z',
  star: 'M12 2l3 7 7.4.6-5.6 4.8 1.7 7.3L12 17.8l-6.5 3.9 1.7-7.3L1.6 9.6 9 9z',
  skull: 'M12 2C6.5 2 3 5.8 3 10.5c0 2.8 1.3 4.6 3 5.6V20c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-3.9c1.7-1 3-2.8 3-5.6C21 5.8 17.5 2 12 2z' +
    'M8.5 9a2 2 0 1 0 0 4.2 2 2 0 1 0 0-4.2zM15.5 9a2 2 0 1 0 0 4.2 2 2 0 1 0 0-4.2zM12 13.6l1.3 2.2h-2.6zM10 18.5h1.2V22H10zM12.8 18.5H14V22h-1.2z',
  lock: 'M5 10h14v12H5zM7 10V7a5 5 0 0 1 10 0v3h-2.6V7a2.4 2.4 0 0 0-4.8 0v3z',
  warn: 'M12 2L1 21h22zM10.8 9h2.4v6h-2.4zM10.8 16.6h2.4V19h-2.4z',
  bang: 'M9.8 2h4.4l-1 13.5h-2.4zM10 18h4v4h-4z',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 1 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8z',
  burst: 'M12 1l2.4 5.6 5.4-2.8-1.9 5.8L23 12l-5.1 2.4 1.9 5.8-5.4-2.8L12 23l-2.4-5.6-5.4 2.8 1.9-5.8L1 12l5.1-2.4-1.9-5.8 5.4 2.8z',
  flame: 'M12 1.5c.8 4 6.5 6 6.5 12.5a6.5 6.5 0 0 1-13 0c0-3.4 2-5.6 3.3-6.6 0 2.2.9 3.6 2.3 3.6 0-4.4-1.3-6.5.9-9.5z',
  soundOn: 'M3 9h4l5-4.5v15L7 15H3zM15.3 8.3a5.2 5.2 0 0 1 0 7.4l-1.5-1.5a3.1 3.1 0 0 0 0-4.4zM18.3 5.3a9.4 9.4 0 0 1 0 13.4l-1.5-1.5a7.3 7.3 0 0 0 0-10.4z',
  soundOff: 'M3 9h4l5-4.5v15L7 15H3zM15 9.4L16.4 8 19 10.6 21.6 8 23 9.4 20.4 12 23 14.6 21.6 16 19 13.4 16.4 16 15 14.6 17.6 12z',
  pause: 'M6 4h4.5v16H6zM13.5 4H18v16h-4.5z',
} as const;

export type IconName = keyof typeof PATHS;

const svg = (d: string, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" fill-rule="evenodd" d="${d}"/></svg>`;

/** Inline SVG markup for an icon, sized to the text and drawn in its colour. */
export const icon = (name: IconName): string =>
  svg(PATHS[name], 'currentColor').replace('<svg ', '<svg class="ic" aria-hidden="true" ');

/** Define `--ic-<name>` mask images on :root, once. */
export function installIconCss(): void {
  if (document.getElementById('icon-css')) return;
  const vars = Object.entries(PATHS).map(([k, d]) => `--ic-${k}:url("data:image/svg+xml,${encodeURIComponent(svg(d, '#000'))}");`);
  const el = document.createElement('style');
  el.id = 'icon-css';
  el.textContent = `:root{${vars.join('')}}`;
  document.head.appendChild(el);
}
