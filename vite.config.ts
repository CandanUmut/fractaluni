import { defineConfig } from 'vitest/config';

// GH Pages serves this repo under /fractaluni/. The leading+trailing slash
// matters: it makes built asset URLs resolve correctly on Pages.
// In dev (`vite`) base is irrelevant; in `vite build` it is baked into asset paths.
export default defineConfig({
  base: '/fractaluni/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
