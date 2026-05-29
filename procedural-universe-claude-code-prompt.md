# Claude Code Prompt — Fractal Procedural Universe

> Paste everything below into Claude Code as the project brief. It is written for someone fluent in Three.js, so it specifies *architecture and rules*, not Three.js basics. Build in the numbered phases — each phase must run before moving on.

---

## Mission

Build a browser-based, infinite **procedural universe** that deploys as a static site to GitHub Pages. The player flies freely through space, approaches a star to enter its system, picks a planet, and descends to walk/fly on a procedurally generated surface with terrain, water, plants, roaming animals, and flocking birds. Every location is derived deterministically from a single universe seed, so the same coordinates always produce the same world, and any location is shareable via URL.

The aesthetic is **low-poly flat-shaded geometry + a stylized atmospheric layer** (gradient skies, fog, bloom, per-system color grading driven by the star's spectral class). It does not need to be photorealistic; it needs to feel cohesive and intentional.

## Hard constraints

- **Static hosting only** (GitHub Pages). No backend, no database, no server-side anything. The universe is computed client-side from a seed; nothing is persisted server-side.
- **Deterministic.** No `Math.random()` anywhere in world generation. All randomness flows through a seeded hash. Same seed + same coordinates ⇒ identical world, every time, on every machine.
- **Infinite.** The player can fly arbitrarily far. This forces a floating-origin coordinate scheme (see Gotchas) — implement it from Phase 2, not as a retrofit.
- **Performant on a mid laptop.** Target 60fps. Use instanced meshes, frustum culling, object pooling, and chunk streaming. Profile before adding features.

## Tech stack

- **Vite** (dev server + production build).
- **Three.js** (latest stable), plus `EffectComposer` for post-processing (bloom, color grading).
- Plain TypeScript. No game engine, no React unless a HUD genuinely needs it (prefer plain DOM/canvas overlay for the HUD).
- **Deploy:** Vite `base` set correctly for the GH Pages repo path; build to `dist`; deploy via a GitHub Actions workflow to the `gh-pages` branch (or Pages-from-Actions). Verify the deployed build loads with correct asset paths before calling it done.

---

## Core architectural principle: the derivation pipeline

The universe is a **pure function of a seed**. Implement a small deterministic toolkit first and route *all* generation through it:

- `hash(...ints) -> uint32` — an integer hash (e.g. a wang/pcg-style mix). Pure, fast, no state.
- `makeRNG(seed) -> () => float` — a seeded PRNG (splitmix or PCG variant) returning `[0,1)`.
- `deriveSeed(parentSeed, ...keys) -> uint32` — forks a child seed from a parent plus discriminator keys. **This is the backbone.** Every entity gets its seed by deriving from its parent.

The seed hierarchy:

```
universeSeed
  └─ galacticCell(cx,cy,cz)              = deriveSeed(universeSeed, cx, cy, cz)
       └─ star(index)                    = deriveSeed(cellSeed, index)
            └─ planet(index)             = deriveSeed(starSeed, index)
                 └─ surfaceChunk(gx,gy)  = deriveSeed(planetSeed, gx, gy)
                      └─ feature(...)    = deriveSeed(chunkSeed, ...)
```

**The "relational logic" is the whole point: properties cascade through physics-flavored rules, they are never rolled independently.** Pipeline (physically *inspired*, not accurate — tune for variety and beauty, but keep the causal chain real):

1. **Star** from its seed: spectral class drawn from a weighted distribution skewed toward M/K dwarfs (O B A F G K M). Class → surface temperature → emissive color (blackbody-ish) → luminosity → habitable-zone radius.
2. **Planet** from its seed + star: orbital radius, mass, axial tilt, water fraction, atmosphere density. Then **derive, don't roll**: equilibrium temperature from star luminosity and orbital distance (`T_eq ∝ L^(1/4) / sqrt(d)`), adjusted by atmosphere (greenhouse) and albedo.
3. **Biome** is *classified* from (equilibrium temp, water fraction, atmosphere): e.g. frozen, tundra, temperate, arid, desert, tropical, molten, oceanic, barren-rock. Biome is not random — it falls out of the numbers above.
4. **Biome drives everything visible:** terrain palette and roughness, sea level and water color, sky/horizon gradient, fog density and color, which flora L-system parameters are plausible, which fauna body-plans appear, and the post-processing color grade.

Make this pipeline a set of **pure, unit-testable functions** in their own module, fully decoupled from Three.js. You should be able to print a planet's full derived profile to the console without rendering anything.

---

## Scene architecture

A `SceneManager` owns three scenes and transitions between them. The current location is encoded in the URL (e.g. `?u=SEED&loc=galaxy|system:cell:star|surface:cell:star:planet`) so any view is shareable and reloadable.

1. **Galaxy scene** — infinite chunked starfield. Space is divided into a 3D grid of galactic cells; each cell's stars come from `galacticCell` seed. Stream cells in/out around the player. Stars render as instanced billboards/points, colored by spectral class, with bloom. Free-fly 6DOF camera with a warp/boost. Approaching a star triggers a transition into its System scene.
2. **System scene** — the selected star (emissive, colored, bloomed) with N planets on seeded orbits, orbiting in real time. Fly toward a planet; selecting it triggers a descent transition into the Surface scene.
3. **Surface scene** — a **flat terrain patch** generated and streamed around the player as they move (chunked fBm heightfield). Includes water plane at sea level, gradient sky dome with the system's sun(s), biome-driven fog and color grade, flora, fauna, and a walk+fly character controller. A "take off" action transitions back to the System scene.

**Transitions** should be quick and legible (fade + camera move/zoom), not literal seamless descent — that was explicitly out of scope.

---

## Procedural / fractal techniques per element

- **Starfield:** spatial hashing per galactic cell → deterministic star positions + properties. Instanced rendering.
- **Terrain:** fractal Brownian motion (stacked simplex/Perlin octaves) for the heightfield; **domain warping** for natural coastlines and ridgelines. Per-chunk meshes streamed around the player, seeded by `surfaceChunk`. Flat-shaded (per-face normals) for the low-poly look.
- **Water:** flat plane at the biome's sea level, colored by biome, with a subtle animated normal/vertex wobble. No expensive reflections.
- **Trees / plants:** **L-systems** (recursive grammars), parameterized by biome (branching angle, depth, leaf form, trunk taper). Placed via per-chunk hashed positions or Poisson-disk sampling; instanced where geometry repeats.
- **Animals (roaming):** low-poly **procedural morphology** — assemble a body from primitives (body, head, legs, tail) using recursive/parametric rules seeded per species per planet, so each planet has consistent-looking creatures. Movement via simple **steering behaviors** (wander + obstacle/edge avoidance + terrain-following).
- **Birds (flocking):** classic **boids** (separation, alignment, cohesion + bounds + gentle goal). Instanced low-poly bird mesh with a cheap wing-flap. This is simpler and higher-payoff than the animals — do it first.
- **Sky & sun:** gradient sky dome (horizon→zenith colors from biome), one or more suns colored by spectral class, directional light matching the sun, fog tuned to atmosphere density.

---

## Visual style spec

- **Flat shading everywhere** (`flatShading: true`, no textures, no UV work). Form and silhouette over surface detail.
- **Palette derivation:** every color (terrain, water, sky, fog, foliage, creatures) is derived from the biome + star, not hardcoded. Build a small palette generator that takes a biome profile and returns a coherent set (use HSL with controlled hue/lightness spread so palettes always look harmonious).
- **Post-processing:** `EffectComposer` with bloom (for stars/suns/emissive) and a per-system color grade (LUT or simple tone/contrast/tint shift). The atmospheric layer is where most of the "nice" comes from — invest here.
- **Fog** as the primary depth cue on surfaces; it also conveniently hides chunk pop-in.

---

## Critical technical gotchas (handle these deliberately)

- **Floating-origin (do this in Phase 2, not later).** Single-precision floats jitter far from the origin, which breaks infinite flight. Keep the player's position as `(integer galactic cell, local float offset)`; recenter the world to the player when the local offset exceeds a threshold, shifting all rendered objects back. The same chunked-coordinate discipline applies to terrain in the Surface scene.
- **Instancing is mandatory** for stars, trees, birds, rocks — anything that repeats. Don't create thousands of individual meshes.
- **Chunk streaming** must load/unload and pool geometry as the player moves; never accumulate. Consider doing fBm terrain generation in a Web Worker if the main thread stutters.
- **Determinism is testable** — add a tiny test that generates a known seed/coordinate and asserts stable output, so a refactor can't silently break reproducibility.

---

## Suggested module layout

```
src/
  core/        seed/hash/rng, deriveSeed, math utils, floating-origin
  universe/    derivation pipeline (star, planet, biome) — PURE, no Three.js
  palette/     biome+star -> color palette generator
  scenes/      SceneManager, galaxyScene, systemScene, surfaceScene
  gen/         starfield, terrain (fBm + domain warp), lsystem flora, creature morphology
  agents/      boids (birds), steering (animals)
  render/      composer/postprocessing, instancing helpers, materials
  ui/          HUD overlay, transitions, URL state (seed + location)
  main.ts
```

---

## Build phases — build and verify in this order

Each phase must produce a **running build**. Commit at the end of each. Do not jump ahead.

**Phase 0 — Scaffold.** Vite + TS + Three.js. Render loop, stats/FPS overlay, resize handling, a `SceneManager` that can swap between placeholder scenes, and URL state read/write (universe seed + location). Configure Vite `base` and a GH Pages Actions deploy; confirm a placeholder cube renders on the live Pages URL.
*Done when:* live GH Pages URL shows a spinning placeholder and the seed appears in the URL.

**Phase 1 — Determinism core.** Implement hash/RNG/`deriveSeed` and the full **universe derivation pipeline** (star → planet → biome) as pure functions. Add a console/debug panel that prints a derived planet profile for a given seed+indices, and a determinism test.
*Done when:* the same seed prints identical profiles across reloads, and biomes clearly vary with star class and orbital distance.

**Phase 2 — Galaxy scene + floating origin.** Chunked infinite starfield via cell hashing, instanced star billboards colored by spectral class, bloom, 6DOF free-fly + warp, **floating-origin recentering**. Approaching a star selects it.
*Done when:* you can fly indefinitely in any direction with no jitter and no frame drops, and stars stream in/out smoothly.

**Phase 3 — System scene.** On star approach, transition to a system: emissive colored star, seeded planets on orbits, real-time orbital motion, fly-to-planet, select-to-descend. Back-out returns to galaxy.
*Done when:* every star yields a consistent, distinct planet set; transitions both ways work.

**Phase 4 — Surface scene (terrain only).** Flat streamed fBm terrain patch around the player (with domain warping), water plane at biome sea level, gradient sky + colored sun(s), biome fog + color grade, walk+fly controller, "take off" back to system. No flora/fauna yet.
*Done when:* you can land on any planet and roam a coherent, biome-appropriate, infinitely-streaming surface at 60fps. **This is the centerpiece — polish it before adding life.**

**Phase 5 — Flora.** L-system trees/plants parameterized by biome, placed per-chunk via hashed/Poisson positions, instanced. Streamed and pooled with the terrain.
*Done when:* vegetation matches the biome and density stays performant while moving.

**Phase 6 — Fauna.** Birds first: instanced boids flock with wing-flap. Then roaming animals: procedural low-poly morphology (consistent per species per planet) with steering + terrain-following. All seeded per planet.
*Done when:* each planet has recognizable, consistent species; flocks and herds behave plausibly and stay within frame budget.

**Phase 7 — Polish & ship.** Transition effects, HUD (seed, coordinates, current planet's derived stats, shareable-URL copy), atmosphere/color-grade tuning pass, full performance pass (instancing/culling/pooling/worker), and final GH Pages deploy verification.
*Done when:* a shared URL reliably reproduces the exact same location for someone else, and the deployed build is smooth.

---

## Working agreement (for you, Claude Code)

- Keep the build runnable after every phase; never leave it broken between sessions.
- Keep the `universe/` derivation layer **pure and Three.js-free** so it stays testable.
- Prefer small, focused modules over large files. Commit per phase with clear messages.
- Profile before optimizing, but never violate the instancing/streaming/pooling rules.
- If a phase reveals that a design choice here is wrong or too costly, **stop and flag it with the tradeoff** rather than silently working around it.
- Do not add features beyond the current phase's scope without asking.
