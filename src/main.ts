import { SceneManager } from './scenes/SceneManager.ts';
import { PlaceholderScene } from './scenes/PlaceholderScene.ts';
import { GalaxyScene } from './scenes/GalaxyScene.ts';
import { SystemScene } from './scenes/SystemScene.ts';
import type { AppScene } from './scenes/AppScene.ts';
import { Hud } from './ui/hud.ts';
import { readState, writeState, type Location, type UniverseState } from './ui/urlState.ts';
import { hashString } from './core/hash.ts';
import { profileToLines } from './universe/debug.ts';

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

const hud = new Hud(hudEl);
const manager = new SceneManager();
appEl.appendChild(manager.domElement);

let state: UniverseState = readState();
// Ensure the seed is always present in the address bar (Phase-0 done criterion).
writeState(state);

// Map each location kind to its scene. Galaxy is real (Phase 2); system/surface
// are still placeholders until Phases 3–4.
const universeSeed = hashString(state.seed);

function sceneForLocation(loc: Location): AppScene {
  switch (loc.kind) {
    case 'system': {
      const system = new SystemScene(universeSeed, loc.cell, loc.star, manager.domElement);
      system.onSelectPlanet = (planet) =>
        goTo({ kind: 'surface', cell: loc.cell, star: loc.star, planet });
      system.onBack = () => goTo({ kind: 'galaxy' });
      return system;
    }
    case 'surface':
      return new PlaceholderScene('surface', 0x7fd08a, 0x0a1410);
    case 'galaxy':
    default: {
      const galaxy = new GalaxyScene(universeSeed, manager.domElement);
      galaxy.onSelectStar = (sel) => goTo({ kind: 'system', cell: sel.cell, star: sel.index });
      return galaxy;
    }
  }
}

function goTo(loc: Location): void {
  state = { ...state, location: loc };
  writeState(state);
  manager.setScene(sceneForLocation(loc));
  if (profileVisible) hud.setProfile(currentProfileLines());
}

manager.setScene(sceneForLocation(state.location));

// Derived-profile debug panel: prints the star/planet derivation for the current
// location (defaults to star 0 / planet 0 when the location is less specific).
let profileVisible = false;
function currentProfileLines(): string[] {
  const loc = state.location;
  const cell = loc.kind === 'galaxy' ? ([0, 0, 0] as const) : loc.cell;
  const star = loc.kind === 'galaxy' ? 0 : loc.star;
  const planet = loc.kind === 'surface' ? loc.planet : 0;
  return profileToLines(state.seed, cell, star, planet);
}

// Demonstrate SceneManager swapping + URL state via number keys (placeholder nav).
window.addEventListener('keydown', (e) => {
  if (e.key === '1') goTo({ kind: 'galaxy' });
  else if (e.key === '2') goTo({ kind: 'system', cell: [0, 0, 0], star: 0 });
  else if (e.key === '3') goTo({ kind: 'surface', cell: [0, 0, 0], star: 0, planet: 0 });
  else if (e.key === 'p' || e.key === 'P') {
    profileVisible = !profileVisible;
    const lines = profileVisible ? currentProfileLines() : null;
    hud.setProfile(lines);
    if (lines) console.log(lines.join('\n')); // also dump to console per the brief
  }
});

// Confirm the seed resolves to a uint32 universe seed on load (Phase-1 sanity log).
console.log(`universe seed "${state.seed}" → u32 ${hashString(state.seed)}`);

// Reflect browser back/forward navigation.
window.addEventListener('popstate', () => {
  state = readState();
  manager.setScene(sceneForLocation(state.location));
});

function resize(): void {
  manager.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  manager.update(dt);
  manager.render();

  hud.tickFps(dt);
  hud.setLines([
    `seed: ${state.seed}`,
    ...manager.hudLines(),
    'nav: [1] galaxy  [2] system  [3] surface',
  ]);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
