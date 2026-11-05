import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The only chunk past 500 kB is the lazily imported 3D viewer (three.js, ~160 kB gzip),
    // which never loads before first paint.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        sandbox: resolve(import.meta.dirname, 'sandbox.html'),
      },
    },
  },
});
