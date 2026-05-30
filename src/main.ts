import { SceneManager } from './scenes/SceneManager.ts';
import { GalaxyScene, type GalaxyEntry } from './scenes/GalaxyScene.ts';
import { SystemScene } from './scenes/SystemScene.ts';
import { SurfaceScene } from './scenes/SurfaceScene.ts';
import type { AppScene } from './scenes/AppScene.ts';
import { Hud } from './ui/hud.ts';
import { Transition } from './ui/transition.ts';
import { readState, writeState, type Location, type UniverseState } from './ui/urlState.ts';
import { hashString } from './core/hash.ts';
import { profileToLines } from './universe/debug.ts';
import { loadProgression } from './sim/progression.ts';
import { PauseMenu } from './ui/pauseMenu.ts';
import { settings } from './ui/settings.ts';
import { audio } from './audio/audio.ts';
import { StartScreen } from './ui/startScreen.ts';
import { isMobile } from './ui/platform.ts';
import { TouchControls, touch, touchUI } from './ui/touchControls.ts';

// Load global player progression (currency, equipment tiers) up front.
void loadProgression();

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

const hud = new Hud(hudEl);
const manager = new SceneManager();
appEl.appendChild(manager.domElement);

// Pause / settings menu (applies volume + FOV live).
const pause = new PauseMenu(hudEl);
audio.setVolume(settings.volume);
pause.onVolume = (v) => audio.setVolume(v);
function applyFov(v: number): void {
  const s = manager.activeScene;
  if (s) {
    s.camera.fov = v;
    s.camera.updateProjectionMatrix();
  }
}
pause.onFov = applyFov;
// Reveal the mobile console again whenever the pause menu closes (incl. Resume).
pause.onResume = () => touchUI.current?.block('menu', false);

// Start looping background music on the first user gesture (browsers require one).
let audioStarted = false;
function startAudioOnce(): void {
  if (audioStarted) return;
  audioStarted = true;
  audio.init();
  audio.startMusic(0.16); // quiet background loop
}
window.addEventListener('pointerdown', startAudioOnce);
window.addEventListener('keydown', startAudioOnce);

let state: UniverseState = readState();
// Ensure the seed is always present in the address bar (Phase-0 done criterion).
writeState(state);

// Map each location kind to its scene. Galaxy is real (Phase 2); system/surface
// are still placeholders until Phases 3–4.
const universeSeed = hashString(state.seed);

// Remember which star we last flew into, so returning to the galaxy map drops us
// back beside it instead of snapping to the origin.
let galaxyEntry: GalaxyEntry | undefined;

function sceneForLocation(loc: Location): AppScene {
  switch (loc.kind) {
    case 'system': {
      const system = new SystemScene(universeSeed, loc.cell, loc.star, manager.domElement);
      system.onSelectPlanet = (planet) =>
        goTo({ kind: 'surface', cell: loc.cell, star: loc.star, planet });
      system.onBack = () => goTo({ kind: 'galaxy' });
      return system;
    }
    case 'surface': {
      const surface = new SurfaceScene(
        universeSeed,
        loc.cell,
        loc.star,
        loc.planet,
        manager.domElement,
      );
      surface.onTakeOff = () => goTo({ kind: 'system', cell: loc.cell, star: loc.star });
      return surface;
    }
    case 'galaxy':
    default: {
      const galaxy = new GalaxyScene(universeSeed, manager.domElement, galaxyEntry);
      galaxy.onSelectStar = (sel) => {
        galaxyEntry = { cell: sel.cell, offset: sel.record.offset };
        goTo({ kind: 'system', cell: sel.cell, star: sel.index });
      };
      return galaxy;
    }
  }
}

const transition = new Transition();
let navigating = false;
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function goTo(loc: Location): Promise<void> {
  if (navigating) return;
  navigating = true;
  await transition.cover();
  state = { ...state, location: loc };
  writeState(state);
  hud.setShareUrl(window.location.href);
  manager.setScene(sceneForLocation(loc));
  applySceneTouch();
  applyFov(settings.fov);
  if (profileVisible) hud.setProfile(currentProfileLines());
  // Let a couple of frames render the new scene before revealing.
  await nextFrame();
  await nextFrame();
  await transition.reveal();
  navigating = false;
}

/** Refresh the mobile console's action buttons for the active scene. */
function applySceneTouch(): void {
  if (!touch.enabled) return;
  touchUI.current?.setActions(manager.activeScene?.touchActions?.() ?? []);
}

manager.setScene(sceneForLocation(state.location));
applyFov(settings.fov);
hud.setShareUrl(window.location.href);

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

// Debug: toggle the derived-profile panel. (Scene navigation is via in-world
// flight + Enter/Backspace/take-off; number keys belong to weapon selection.)
function togglePause(): void {
  pause.toggle();
  touchUI.current?.block('menu', pause.visible);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    togglePause();
  } else if (e.key === 'p' || e.key === 'P') {
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
  hud.setShareUrl(window.location.href);
  manager.setScene(sceneForLocation(state.location));
  applySceneTouch();
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

// Launch flow: pick platform (+ first-run onboarding), then enable the mobile
// console if the player chose touch. The game renders behind the overlay.
const startScreen = new StartScreen(hudEl);
void startScreen.start().then(() => {
  startAudioOnce();
  if (isMobile()) {
    touch.enabled = true;
    const controls = new TouchControls(hudEl);
    controls.onMenu = togglePause;
    touchUI.current = controls;
    applySceneTouch();
  }
});
