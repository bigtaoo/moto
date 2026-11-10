import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// the build on every analytics event (src/telemetry.ts), so metrics compare release to release
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Relative base: portals serve the zip from a sub-path (same as Swarm Orbit).
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(version) },
  server: { port: 5180, watch: { ignored: ['**/docs/**', '**/dist/**', '**/store/**'] } },
  // three.js is one ~700 kB chunk; scripts/checkBundle.mjs holds the real budget
  build: { chunkSizeWarningLimit: 900 },
});
