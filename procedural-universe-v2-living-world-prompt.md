# Claude Code Prompt — v2: The Living World Layer

> This builds **on top of the finished v1 universe viewer.** Do not start it until v1 (Phases 0–7: deterministic infinite universe, galaxy/system/surface scenes, streamed fBm terrain, flora, fauna, deploy) is complete and stable. v2 makes the planet you are standing on *responsive*: you change it, and a local ecosystem responds, under light survival pressure that gives those changes personal stakes. Built for someone fluent in Three.js and the v1 codebase.

---

## Mission

Make the **active planet alive and writable.** Wherever the player stands, the local environment responds to what they do — plant and a forest spreads, over-hunt and the herds thin and the predators starve, clear land and the moisture and life shift. The player is embodied *inside* this system, not floating above it: a few light survival needs mean the world's response is felt personally, and the way you stay alive is by shaping the place around you.

Only the planet you are currently on simulates in real time. Every planet you change remembers your changes (a sparse diff) and resolves "what happened while you were gone" in one coarse step when you return. Nothing about v1's stateless, infinite, deploy-as-static-site nature changes — the cosmos stays pure math; **the diff is the only stateful thing in the entire project.**

## Design priority order (protect this when tradeoffs arise)

1. **The world visibly responds to the player.** Cause and effect must always *read clearly* — the player should be able to see *why* something happened. This is the soul of v2; never sacrifice legibility for realism or scale.
2. **Embodied transformation feels tactile and consequential.** Acting on the world is hands-on and its effects persist and ripple.
3. **Light survival provides stakes, never chores.** Needs should pressure decisions; they must never become tedious meter-management. "Small survival" is a hard guardrail — if it starts dominating minute-to-minute play, it has gone too far.

---

## Hard constraints (carried from v1, plus new ones)

- **Static hosting only.** Persistence is client-side: **IndexedDB** (for anything sizable) keyed by `universeSeed + planetPath`. No backend. (A future Supabase share-hook is noted at the end but is out of scope.)
- **v1 substrate stays pure.** The seed cascade and all baseline generation remain a pure function of the seed. Never mutate baseline generation. All change lives in a **sparse diff layered over** the baseline.
- **Simulate the active planet only.** Never simulate the universe, never simulate unvisited planets, never background-simulate other planets. Returning to a changed planet triggers a coarse catch-up, not continuous background sim.
- **Populations are fields, creatures are a sample.** Simulate populations as coarse per-cell counts; render only a representative visible sample as actual creatures (reuse v1's boids/animals as the *visualization* of the underlying field). Do **not** simulate thousands of individual animals — this is the single most important performance and tuning rule in v2.
- 60fps target on a mid laptop. The sim runs on a fixed timestep decoupled from render.

---

## Architecture additions

### 1. PlanetState = baseline seed + sparse diff
A planet is now `baseline (pure, from seed)` + an optional `diff`. The diff stores **only what differs from baseline**, sparsely (a `Map` keyed by cell/region coords, plus small global offsets). Contents:

- **Terrain/vegetation edits:** forested/cleared cells, planted seed points, moisture/water edits.
- **Biota:** introduced or removed species and their per-cell population counts.
- **Survival/world bookkeeping:** depleted resources, placed shelter/markers, last-visited in-world timestamp.

Most of the planet remains purely derived; only your footprint carries state. This is what keeps storage tiny and preserves "the universe is free."

### 2. Persistence + coarse catch-up
- On **entering** a planet: look up `IndexedDB[universeSeed + planetPath]`. If a diff exists, apply it over the baseline, then run a **coarse catch-up** — advance the simulation by the elapsed in-world time in one (or a few large) steps, so the world has plausibly "moved on." If no diff, the planet is pristine baseline.
- On **leaving** (or periodically): persist the sparse diff + the current in-world timestamp.
- Pristine planets must stay byte-for-byte pristine; touching planet A must never affect planet B.

### 3. Local ecosystem simulation (the core)
A discrete-time model over a **low-resolution grid** covering the region around the player. Keep the coupled variables *few* and the couplings *visible*.

**Continuous fields (per cell, updated each tick):**
- **Moisture/water** — diffuses; sourced from seas/rivers/precipitation derived from the v1 biome.
- **Temperature** — from biome + day/night (+ optional seasons); drives what can live where.
- **Vegetation density** — grows where moisture + temperature are favorable, spreads to neighbors (cellular-automata / reaction-diffusion-lite), capped by carrying capacity, reduced by grazing.

**Population fields (per cell counts, Lotka–Volterra-style coupling + migration toward food):**
- **Herbivores** — graze vegetation (grow with food, decline without), migrate up vegetation gradients.
- **Predators** — eat herbivores, migrate toward them, oscillate against prey.

**The player is a node in this web:** hunting lowers local herbivores; planting raises vegetation; clearing lowers it; introducing a species seeds a new population; editing moisture shifts where life can spread. Every player action writes to the diff *and* perturbs the live sim.

**Legibility is mandatory:** provide toggleable overlays (vegetation heatmap, population indicators, moisture) and make the visible world reflect the fields — herds visibly thin where overgrazed, forest visibly creeps toward water. The player must be able to watch the causal chain.

**Time control:** pause / 1× / fast / "skip ahead", so consequences are watchable rather than glacial.

### 4. Embodied transformation (hybrid: embodied first, powers later)
- **Embodied (first):** hands-on actions, lightly tied to resources gathered in-world — plant a gathered seed (a vegetation source point that grows over sim time), introduce a captured/sampled creature (seeds a population), clear vegetation, dig/redirect water (edit the moisture field). Each writes to the diff and perturbs the sim.
- **Broader powers (later, unlocked via simple progression — e.g. a region stabilized or resources accumulated):** region-scale versions of the same verbs — "afforest this area", "introduce species across a region", coarse terraform. Mechanically these are just *batched* embodied actions writing larger diffs. Frame them as the same verbs scaled up, not a separate system.

### 5. Light survival (stakes, not a chore)
- **A few needs:** energy/stamina (spent on activity, restored by eating/resting), warmth (threatened by cold nights / harsh biomes; mitigated by shelter, fire, hospitable biome), sustenance (eat flora/fauna you gather or hunt), and a single vitality/health value that drops when a need is critical or from hazards.
- **Environmental danger derived from the v1 planet profile** — this is where v1's derivation pipeline pays off: a molten/airless/toxic world is lethal without preparation and time-limited; a temperate world is gentle. Temperature extremes, hostile fauna (some predators treat *you* as prey/threat), and hazards apply pressure scaled by the planet's derived numbers.
- **The elegant coupling:** you survive *through* the ecosystem you shape. Forest a barren patch → food, shade, moderated temperature. Over-hunt → nothing to eat. Transformation is not decoration; it is how you live, so the world's response is felt in your own body.
- **Failure is instructive, not punishing (recommended default):** on death, black out and wake at a safe point losing some resources/progress — not hard permadeath. The point is experimentation. (Flip to permadeath only if you explicitly want that tone.)

---

## Build phases — build and verify in this order

Each phase must produce a running build layered cleanly on v1. Commit per phase. Do not jump ahead — and in particular, do not start survival (E) until the world-response phases (B, C, D) read clearly.

**Phase A — State & persistence.** Introduce `PlanetState` (baseline + sparse diff), the diff data structures, IndexedDB save/load keyed by `universeSeed + planetPath`, and apply-diff-over-baseline on entry. No simulation yet — prove the plumbing with a trivial edit (flag/recolor a cell).
*Done when:* a trivial change to a planet survives leaving and returning; pristine planets stay pristine; another planet is unaffected; diffs are sparse.

**Phase B — Ecosystem fields (no animals yet).** Low-res moisture/temperature/vegetation grids over the active region; growth/spread/diffusion rules on a fixed sim tick; time controls (pause/1×/fast/skip); a debug overlay of the fields. Fields seed from the v1 biome.
*Done when:* under fast-forward you can watch vegetation spread toward water and retreat from cold/heat, legibly, at a stable framerate. **This is the first half of the real work — get it tuned before adding animals.**

**Phase C — Population fields + sampled rendering.** Herbivore/predator per-cell counts with Lotka–Volterra coupling and migration toward food; render a *representative sample* as visible creatures (reuse v1 fauna as the field's visualization). Populations rise/fall/migrate; overgrazing collapses vegetation locally; predator–prey oscillation is visible.
*Done when:* pressuring one variable produces a visible, plausible cascade; rendering samples the field cheaply with no per-animal life-cycle simulation. **This is the second half of the real work — expect most of your tuning time here.**

**Phase D — Embodied transformation.** Gather seeds/samples; plant (seeds vegetation), introduce a creature (seeds a population), clear, light moisture/water editing. Each writes to the diff and perturbs the sim live.
*Done when:* every action visibly and persistently changes the world and ripples through the ecosystem — the cause-and-effect core is real and legible.

**Phase E — Light survival.** Player needs (energy, warmth, sustenance, vitality), environmental danger scaled from the derived planet profile, eat/rest/shelter to recover, instructive failure model. Food/safety come from what you grow and hunt.
*Done when:* a hostile planet meaningfully threatens you; a planet you've cultivated sustains you; needs pressure decisions without becoming tedious meter-management.

**Phase F — Coarse catch-up & broader powers.** On returning to a touched planet, advance the sim by elapsed in-world time in a few large steps ("the world moved on"). Unlock region-scale transformation tools as batched embodied actions — the "broader powers later" half of the hybrid.
*Done when:* leaving a planet and returning shows believable progression; region tools behave as scaled-up embodied actions writing larger diffs.

**Phase G — Polish, tuning & integration.** HUD/overlays for needs and ecosystem legibility; the **simulation tuning pass** (stability vs liveliness — budget real time for this, it is the hard part); performance pass (field resolution, sampled-render budget, tick budget, worker if needed); persistence robustness. Optional future hook: a Supabase row to *share a reshaped planet by URL* (cosmos = math, diff = shared data) — design the diff to be serializable for this, but do not implement it now.
*Done when:* the loop is legible, lively, stable, and a reshaped planet reliably reloads exactly as left (plus catch-up).

---

## Working agreement (for you, Claude Code)

- **Never mutate v1's baseline generation.** The seed cascade stays pure; the sparse diff is the only state in the entire project.
- **Simulate the active planet only.** No background or multi-planet simulation, ever.
- **Populations are fields; creatures are a sample.** No per-individual animal life-cycle simulation.
- Keep the simulation module **pure and headless** where possible (fields in, fields out, given a tick), so it is testable and tunable without rendering.
- Keep the build runnable after every phase; never leave it broken. Commit per phase.
- **Tune B and C until they feel alive before expanding scope.** A lively two-variable loop beats a dead five-variable one. If a richer model won't stabilize, simplify rather than pile on rules.
- Protect the design priority order above: legible response first, tactile transformation second, light survival third.
- If a design choice here proves wrong or too costly once it meets real code, stop and flag the tradeoff rather than silently working around it.
