// One shot of the store trailer: the built game, played by the bot, stepped by hand and saved frame
// by frame as jpegs. `scripts/make_trailer.mjs` is what strings the shots together; this records one.
//
//   node scripts/capture_trailer.mjs dist-cg --frames out/ --start 1 \
//        --w 1920 --h 1080 --seconds 6 --skip 25 --save '{"div":3,"tier":1}'
//
// Why step by hand: a trailer must not stutter, and nothing about a headless window's real clock is
// steady. We hijack requestAnimationFrame and performance.now, advance them ourselves in fixed
// 1/60 s beats, and take a screenshot after every other beat -- so every frame of the video is
// exactly 1/30 s of game time no matter how long the machine took to draw it. The same hijack keeps
// the recording out of our own telemetry: the shim answers the collector itself.
//
// Needs Chrome at one of the usual places. It prints the next free frame number.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : argv[i + 1];
};
const DIR = resolve(argv[0] ?? 'dist-cg');
const FRAMES = resolve(flag('frames', 'frames'));
const START = Number(flag('start', 1));
const W = Number(flag('w', 1920));
const H = Number(flag('h', 1080));
const FPS = Number(flag('fps', 30));
const SECONDS = Number(flag('seconds', 6));
const SKIP = Number(flag('skip', 0)); // seconds of race played through before the first frame
const NEAR = Number(flag('near', 0)); // then wait for this many rivals to be within reach, so the shot has a fight in it
const MAX_WAIT = Number(flag('maxWait', 40));
const SAVE = flag('save', ''); // a partial save, JSON: which division, season, garage (src/meta.ts reads it leniently)
const LEN = flag('len', '');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
if (!CHROME) throw new Error('no Chrome found');
if (!existsSync(join(DIR, 'index.html'))) throw new Error(`${DIR} has no index.html -- build first`);
mkdirSync(FRAMES, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

/** The page's clock and its save, installed before any of the game's own code runs. */
const SHIM = `(() => {
  let t = 0;
  let q = [];
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(performance, 'now', { value: () => t, configurable: true });
  window.__clock = {
    get t() { return t; },
    /** One beat: move the clock on and run whatever asked for the next frame. */
    beat(ms) { t += ms; const due = q; q = []; for (const cb of due) cb(t); },
    beats(n, ms) { for (let i = 0; i < n; i++) this.beat(ms); },
  };
  try { ${SAVE ? `localStorage.setItem('dummy-brawl-v1', ${JSON.stringify(SAVE)});` : ''} } catch (e) {}
  // A recording is not a player: never let it reach the collector.
  const ours = (u) => String(u || '').includes('dx.gamestao.com');
  const fetch0 = window.fetch.bind(window);
  window.fetch = (u, o) => (ours(typeof u === 'string' ? u : u && u.url) ? Promise.resolve(new Response(null, { status: 204 })) : fetch0(u, o));
  navigator.sendBeacon = () => true;
})();`;

// ---------------------------------------------------------------- static server

const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const path = join(DIR, rel);
  if (!path.startsWith(DIR) || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ---------------------------------------------------------------- chrome + CDP

const profile = mkdtempSync(join(tmpdir(), 'trailer-'));
const DEBUG_PORT = 9300 + (process.pid % 300);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
  `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--enable-unsafe-swiftshader', '--use-angle=d3d11',
  'about:blank',
], { stdio: 'ignore' });

const json = async (path) => {
  for (let i = 0; i < 100; i++) {
    try { return await (await fetch(`http://127.0.0.1:${DEBUG_PORT}${path}`)).json(); }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('Chrome never answered on the debugging port');
};
const page = (await json('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let nextId = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
/** Run an expression in the page and hand back its value. */
const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SHIM });
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/?bot&lang=en${LEN ? `&len=${LEN}` : ''}` });

// ---------------------------------------------------------------- play, then shoot

const BEAT = 1000 / 60;
const perFrame = Math.round(60 / FPS);
const beats = (n) => evaluate(`__clock.beats(${n}, ${BEAT})`);

process.stdout.write('booting');
let ready = false;
for (let i = 0; i < 600 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 50)); // the boot waits on real promises, not on us
  try { await beats(2); ready = await evaluate(`!!(window.__game && __game.world && __game.state === 'race')`); } catch { /* still navigating */ }
  if (i % 20 === 0) process.stdout.write('.');
}
if (!ready) throw new Error('the game never reached a race');
process.stdout.write(` ${await evaluate('__game.world.div && __game.world.div.name || ""')}`);

for (let s = 0; s < SKIP; s++) await beats(60);

// An empty stretch of road is no advertisement. Ride on until the pack is around the player again --
// counted in the page so the wait costs one call, and given up on rather than missing the shot.
if (NEAR > 0) {
  const waited = await evaluate(`(() => {
    const near = () => { const w = window.__game.world, p = w.player; if (p.state !== 'ride') return -1;
      let n = 0; for (const r of w.riders) if (!r.isPlayer && r.state === 'ride' && Math.abs(r.z - p.z) < 20 && Math.abs(r.x - p.x) < 10) n++;
      return n; };
    for (let i = 0; i < ${MAX_WAIT * 60}; i++) { if (near() >= ${NEAR}) return i / 60; __clock.beat(${BEAT}); }
    return -1; })()`);
  process.stdout.write(waited < 0 ? ' (no pack found)' : ` +${waited.toFixed(1)}s to the pack`);
}

const total = Math.round(FPS * SECONDS);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await beats(perFrame);
  const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 95, fromSurface: true });
  writeFileSync(join(FRAMES, `${String(START + i).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
}
console.log(`  ${W}x${H} +${SKIP}s  ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s  next ${START + total}`);

ws.close();
server.close();
chrome.kill();
await new Promise((r) => chrome.on('exit', r));
// Windows holds the profile open for a moment after Chrome goes; it is a temp folder either way.
try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* the OS will */ }
