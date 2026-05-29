# Claude Code Prompt — v3: The Scavenger Game Layer

> This builds **on top of the finished v1 universe viewer** (deterministic infinite universe, galaxy/system/surface scenes, streamed fBm terrain, flora, fauna, galaxy map, seed-URL, deploy). It does **not** use the v2 ecosystem-simulation plan — that is set aside. It does reuse v1's derivation pipeline and the sparse-diff persistence concept. The goal is to turn the universe into a professional first-person scavenger-hunt game. Built for someone fluent in Three.js and the v1 codebase.

---

## Mission

A first-person scavenger loop across the infinite procedural universe: **scan a planet for resources → travel to deposits → clear the hostile creatures guarding the valuable ones → extract with drills and bombs → haul the haul back to your ship → sell → buy better guns, bombs, mining tools, and scanners → reach richer, more dangerous resources on harder planets.** Different planets carry different resources (derived from their physics), a compass guides you to nearby deposits, and the only survival pressure is **energy — which never kills you**, only forces you to manage and retreat.

It should feel **professional**, which in a solo low-poly game means *game-feel and procedural animation*, not asset fidelity: juicy weapons, satisfying extraction, clean HUD, good audio, tight feedback.

## Design priority order (protect this when tradeoffs arise)

1. **The core loop is tight and pulls you forward:** find → extract → sell → upgrade → reach previously-inaccessible resources. If the loop doesn't create "one more planet" pull, nothing else matters.
2. **Weapons and extraction *feel* good.** Procedural animation + game-feel (recoil, shake, hit-stop, particles, audio). This is the "professional" the player will actually perceive.
3. **PvE guardians add spice and gate value** — they make rich deposits worth defending against, no more.
4. **Energy is non-lethal pressure**, present in every decision but never a death or a chore.

---

## What carries from v1 (do not rebuild)

- The stateless universe substrate and seed cascade — **untouched**.
- The **derivation pipeline now decides each planet's resource profile**: star class + biome + composition determine which resources exist, their rarity, and their hardness. Richer/rarer resources correlate with harsher, more dangerous worlds. This is the relational logic doing real work — resources are *derived*, never sprinkled randomly.
- Surface terrain streaming, flora, fauna (fauna is reused both as ambient life and as guardian creatures), galaxy/system map, seed-URL, instancing/perf infrastructure.
- The **sparse-diff persistence concept** (from the v2 design): reused to remember depleted deposits, cleared guardians, and per-planet changes.

---

## Hard constraints (carried from v1)

- **Static hosting only.** Client-side persistence via **IndexedDB**: player progression (currency, equipment, inventory, energy capacity) stored globally; per-planet changes (depleted nodes, cleared guardians) stored as a sparse diff keyed by `universeSeed + planetPath`. No backend.
- **v1 substrate stays pure.** All change lives in the sparse diff layered over baseline. Never mutate baseline generation.
- **Procedural animation first.** Do not author rigged keyframe animation clips for weapons/tools — build animation from transform math (recoil/sway/bob/equip) plus effects. Authored clips are optional later polish only.
- 60fps on a mid laptop. Reuse v1's instancing/culling/streaming discipline. Combat AI stays simple.

---

## Systems

### 1. First-person controller + viewmodel
Refactor v1's surface controller to **first-person**: camera + mouse-look, walk/sprint/jetpack movement, and a **viewmodel rendering setup** so the held item never clips terrain (separate viewmodel camera/render pass, or a dedicated near-layer scene composited over the world). The held weapon/tool sways and bobs with movement and look.

### 2. Weapon & tool framework (the "professional" core)
An equippable-item system. Categories:
- **Guns** — combat against guardians; tunable damage / fire rate / energy-per-shot / range. Hitscan or fast projectile.
- **Bombs** — thrown with an arc; AoE; used to clear creature clusters and to crack high-hardness deposits guns/drills can't.
- **Mining tools** — drill / mining laser / cutter; extract from deposit nodes; tool *tier* determines which node hardnesses are extractable and how fast.

Each item has procedural animation states: **idle sway, equip/holster, use/fire, reload/cooldown**, built from transform math. Plus game-feel: muzzle flash, projectile/impact particles, screen shake, hit-stop on solid hits, decals, audio per action; drill spin-up + beam + sparks; bomb throw arc preview + explosion shockwave. **This juice is what reads as professional — invest here.**

### 3. Resource deposits + extraction (deposit-node model)
- **Nodes** are placed per surface chunk via the seeded hash (deterministic, persistent). Each node's **type, richness, and hardness derive from the planet profile** (relational), tiered common → rare → exotic.
- **Scan** reveals nearby nodes; the **compass/HUD** shows direction, distance, and type of deposits within scanner range (scanner tier = range + rarity-detection, upgradeable).
- **Extract** with the right tool: node hardness vs tool tier gates whether/how fast you can mine it; the hardest/richest nodes require higher-tier tools or bombs to crack open.
- **Depletion persists** via the sparse diff — a mined-out node stays gone on return.

### 4. PvE guardians
Some fauna are hostile and **guard valuable deposits** (reuse v1 fauna meshes/morphology). Behavior stays simple: aggro detection → approach → attack, with simple health, death, and a loot drop. Seeded per planet; **richer deposits are better guarded.** Getting hit drains **energy**, never health-to-death.

### 5. Energy — the only survival mechanic, non-lethal
A single **energy** resource. Spent by: sprint/jetpack, firing/drilling, and taking hits. Regenerates passively (slowly) and faster via recharge at the ship, consumables, or sunlight (solar regen tied to the system's star — another payoff of the derivation pipeline). **At zero energy the player does not die** — actions are disabled / movement throttled / forced retreat until energy recovers. Energy capacity and regen are upgradeable stats. Energy must shape moment-to-moment scavenging decisions without ever being lethal or a tedious meter to babysit.

### 6. Economy, ship-hub & progression
- **Your ship is the mobile hub:** inventory/cargo (capacity-limited and upgradeable — creates haul-it-back tension), energy recharge, a **trade terminal** (sell resources → single currency), and an **upgrade bench** (buy higher-tier guns, bombs, mining tools, scanners, energy cells, cargo, jetpack).
- **Progression gate (this is what makes the economy meaningful):** richer resources require higher-tier tools to extract *and* better gear to survive their guardians. Each upgrade unlocks access to a tier of resource that was previously unreachable, which pulls the player toward richer, more dangerous planets. Without this scarcity/gating it's just a grind — guard it.
- Optional: trade stations in some systems offering better prices or rare gear.

### 7. HUD & feel
Compass/deposit bar, energy, cargo, scanner pings, crosshair, damage/feedback indicators, currency. Clean, low-poly-consistent, atmospheric. Audio across weapons, impacts, extraction, ambient, and UI. The HUD plus audio plus game-feel is most of the "professional" perception.

---

## Build phases — build and verify in this order

Each phase must produce a running build layered cleanly on v1. Commit per phase. Do not jump ahead.

**Phase A — First-person refactor.** Convert the surface controller to FP (camera, mouse-look, walk/sprint/jetpack) and stand up the viewmodel rendering setup with a placeholder held item that sways/bobs and never clips terrain.
*Done when:* FP movement and look feel good on any planet, viewmodel never clips, 60fps.

**Phase B — Weapon/tool framework + procedural animation.** Equippable-item system with equip/holster, idle sway, use/fire, reload, built procedurally, plus muzzle flash, particles, screen shake, hit-stop, and raycast/projectile hits. Ship at least one gun, one bomb (arc + explosion), one drill (spin + beam).
*Done when:* switching between gun, bomb, and drill feels distinct and juicy; animation is procedural and reads as deliberate, not floaty.

**Phase C — Resource deposits + extraction + compass.** Seeded per-chunk deposit nodes with type/richness/hardness derived from the planet profile; scan to reveal; compass/HUD shows nearby deposits; extract with tool-tier-vs-hardness gating; collect to inventory; depletion persists via the sparse diff.
*Done when:* you scan, find via compass, extract, and collect; depleted nodes stay depleted on return; different planets clearly yield different resources.

**Phase D — PvE guardians.** Hostile guardian creatures on valuable deposits (aggro → approach → attack, simple health, death, loot). Hits drain energy. Seeded per planet; richer deposits better guarded.
*Done when:* valuable resources are meaningfully defended, combat is fair and juicy, and no death occurs — only energy pressure.

**Phase E — Energy (non-lethal).** Single energy resource: spent by sprint/jetpack/tools/hits; regen passive + recharge + solar; zero-energy disables actions / forces retreat, never kills. Capacity/regen as stats.
*Done when:* energy creates real in-the-moment decisions while scavenging and never kills or becomes a chore.

**Phase F — Economy, ship-hub & progression.** Ship hub: cargo (capacity-limited, upgradeable), recharge, trade terminal (sell → currency), upgrade bench (gun/bomb/tool/scanner/energy/cargo/jetpack tiers). Progression gate: richer resources need higher tools + better gear; upgrades unlock new resource tiers and pull you to harder planets. Optional trade stations.
*Done when:* the full loop closes and pulls forward — scavenge → sell → upgrade → reach previously-inaccessible resources.

**Phase G — Professional polish & ship.** HUD pass, audio pass, game-feel tuning (shake/hit-stop/particles), **economy balancing** (scarcity, prices, gate pacing so it never becomes a grind), performance pass, persistence robustness (global progression + per-planet diffs), and deploy verification.
*Done when:* it reads as a professional, juicy, coherent scavenger game; the loop is balanced; the deployed build is smooth.

---

## Working agreement (for you, Claude Code)

- **Never mutate v1's baseline generation.** All change lives in the sparse diff; the cosmos stays pure math.
- **Reuse the sparse-diff layer** for node depletion and cleared guardians; persist player progression globally in IndexedDB. Do not reinvent persistence.
- **Procedural animation first** — no authored rigged weapon clips unless explicitly added as later polish.
- **Keep combat AI simple** (aggro → approach → attack). Do not let enemy behavior balloon.
- Protect the design priority order: loop first, feel second, PvE third, energy fourth.
- Keep the build runnable after every phase; commit per phase.
- The two genuinely hard parts are **weapon/extraction game-feel (B)** and **economy balancing/gate pacing (F/G)** — budget real iteration time for both; they are tuned by feel, not specified into existence.
- If a design choice here proves wrong or too costly against real code, stop and flag the tradeoff rather than working around it silently.
