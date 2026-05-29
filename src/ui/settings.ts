// Global player settings, persisted to localStorage. Controllers read
// `sensitivity` live; the pause menu applies volume/FOV through callbacks.

export interface Settings {
  sensitivity: number; // look-speed multiplier
  volume: number; // master audio [0,1]
  fov: number; // vertical FOV degrees
}

const KEY = 'fractaluni.settings';
const DEFAULTS: Settings = { sensitivity: 1, volume: 0.6, fov: 75 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
