import { defineConfig } from 'vitest/config';

// GH Pages serves this repo under /fractaluni/. The leading+trailing slash
// matters: it makes built asset URLs resolve correctly on Pages.
// In dev (`vite`) base is irrelevant; in `vite build` it is baked into asset paths.
export default defineConfig({
  base: '/fractaluni/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700, // the three.js vendor chunk is inherently ~500kB
    rollupOptions: {
      output: {
        // Split Three.js into its own long-cached vendor chunk.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
