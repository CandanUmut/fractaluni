import { SceneManager } from './scenes/SceneManager.ts';
import { PlaceholderScene } from './scenes/PlaceholderScene.ts';
import type { AppScene } from './scenes/AppScene.ts';
import { Hud } from './ui/hud.ts';
import { readState, writeState, type Location, type UniverseState } from './ui/urlState.ts';

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

const hud = new Hud(hudEl);
const manager = new SceneManager();
appEl.appendChild(manager.domElement);

let state: UniverseState = readState();
// Ensure the seed is always present in the address bar (Phase-0 done criterion).
writeState(state);

// Phase 0: map each location kind to a labelled placeholder scene. Real scenes
// replace these in Phases 2–4.
function sceneForLocation(loc: Location): AppScene {
  switch (loc.kind) {
    case 'system':
      return new PlaceholderScene('system', 0xffcf6f, 0x080611);
    case 'surface':
      return new PlaceholderScene('surface', 0x7fd08a, 0x0a1410);
    case 'galaxy':
    default:
      return new PlaceholderScene('galaxy', 0x8fbaff, 0x05060a);
  }
}

function goTo(loc: Location): void {
  state = { ...state, location: loc };
  writeState(state);
  manager.setScene(sceneForLocation(loc));
}

manager.setScene(sceneForLocation(state.location));

// Demonstrate SceneManager swapping + URL state via number keys (placeholder nav).
window.addEventListener('keydown', (e) => {
  if (e.key === '1') goTo({ kind: 'galaxy' });
  else if (e.key === '2') goTo({ kind: 'system', cell: [0, 0, 0], star: 0 });
  else if (e.key === '3') goTo({ kind: 'surface', cell: [0, 0, 0], star: 0, planet: 0 });
});

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
