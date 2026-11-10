import { defineConfig } from 'vite';

// Relative base: portals serve the zip from a sub-path (same as Swarm Orbit).
export default defineConfig({
  base: './',
  server: { port: 5180, watch: { ignored: ['**/docs/**', '**/dist/**', '**/store/**'] } },
  // three.js is one ~700 kB chunk; scripts/checkBundle.mjs holds the real budget
  build: { chunkSizeWarningLimit: 900 },
});
