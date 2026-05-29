# fractaluni — a fractal procedural universe

An infinite, deterministic procedural universe in the browser. Fly through a
galaxy of stars, drop into a star system, and descend to walk or fly on a
procedurally generated planet surface with terrain, water, plants, herds, and
flocking birds. Every location is a pure function of a single seed, so the same
URL always reproduces the same world — on any machine.

**Live:** https://candanumut.github.io/fractaluni/

## How it works

The universe is a *derivation pipeline* — a pure, Three.js-free function of the
seed (`src/universe/`). Properties cascade through physics-inspired rules
(spectral class → temperature → luminosity → habitable zone; orbital distance →
equilibrium temperature → biome). Biomes are *classified* from the numbers, never
rolled. The same seed + coordinates always yields the same world.

Everything flows from a seeded hash (`src/core/hash.ts`) — there is no
`Math.random()` in world generation. Infinite flight uses a **floating origin**
so single-precision floats never jitter far from the camera.

## Controls

- **Galaxy:** click to capture the mouse · `WASD` + `R/F` fly · `Q/E` roll · hold
  `Shift` to warp · approach a star and press `Enter` to enter its system.
- **System:** fly to a planet, `Enter` to descend · `Backspace` back to galaxy.
- **Surface:** `WASD` move · mouse look · `Space` jump/ascend · `Shift`
  sprint/boost · `G` toggle walk/fly · `T` (or `Backspace`) take off.
- `p` toggles the derived-profile debug panel. Bottom-right button copies the
  shareable URL.

## Develop

```bash
npm install
npm run dev      # dev server
npm test         # determinism + generation tests
npm run build    # type-check + production build to dist/
```

Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.

## Module layout

```
src/
  core/      hash / rng / deriveSeed, math, color, floating origin
  universe/  pure derivation pipeline (star → planet → biome) + tests
  palette/   biome + star → harmonious color palette
  gen/       starfield, fBm + domain-warp terrain, L-system flora
  agents/    boids (birds), steering (animals)
  render/    composer (bloom + color grade), star/water/sky materials
  scenes/    SceneManager + galaxy / system / surface + controllers
  ui/        HUD, transitions, URL state
```
