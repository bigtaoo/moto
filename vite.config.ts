import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

// the build on every analytics event (src/telemetry.ts), so metrics compare release to release
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// ?stats in a dev build posts its samples here (src/view/stats.ts): one line each in the dev server's log, so
// a phone on USB (`adb reverse tcp:5182 tcp:5182`, the `phone` entry in .claude/launch.json) can be measured from the desktop. Dev server only.
const phoneStats = (): Plugin => ({
  name: 'phone-stats',
  configureServer(server) {
    server.middlewares.use('/__stats', (req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        try {
          const m = JSON.parse(body) as { id: string; device?: unknown; samples?: Record<string, unknown>[] };
          if (m.device) console.log(`[stats ${m.id}] device ${JSON.stringify(m.device)}`);
          for (const s of m.samples ?? []) {
            console.log(`[stats ${m.id}] ${s.at} ${s.fps} fps worst ${s.worst} ms slow ${s.slow} | ${s.calls} calls ${Math.round(Number(s.tris) / 1000)}k tris ${s.geos} geos ${s.tex} tex ${s.progs} progs`);
          }
        } catch { /* not ours */ }
        res.statusCode = 204;
        res.end();
      });
    });
  },
});

// Relative base: portals serve the zip from a sub-path (same as Swarm Orbit).
export default defineConfig({
  base: './',
  plugins: [phoneStats()],
  define: { __BUILD__: JSON.stringify(version) },
  server: { port: 5180, watch: { ignored: ['**/docs/**', '**/dist/**', '**/store/**'] } },
  // three.js is one ~700 kB chunk; scripts/checkBundle.mjs holds the real budget
  build: { chunkSizeWarningLimit: 900 },
  // `npm run coverage`. What is measured is what a node test can actually reach and judge: the
  // simulation, the game flow, the language table lookups, and the two view modules that hold real
  // logic (the audio mixer, the quality ladder). Left out are the entry point, the modules that only
  // exist to drive three.js, the DOM or the host's SDK, and the six translation tables, which are data
  // and are checked key by key in i18n.test.ts instead. Measured against everything, the drawing code
  // buries the number that matters under a few thousand lines nothing here can run (doc 3.3.32).
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/*.ts', 'src/sim/**/*.ts', 'src/i18n/index.ts', 'src/view/audio.ts', 'src/view/quality.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/events.ts', 'src/launchMode.ts', 'src/platform.ts', 'src/haptics.ts'],
      reporter: ['text'],
    },
  },
});
