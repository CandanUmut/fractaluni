// Platform selection: the player chooses Desktop (keyboard+mouse) or Mobile
// (on-screen touch console) on first launch. The choice is remembered in
// localStorage so returning players skip straight in. Everything downstream
// reads `isMobile()` to decide whether to show touch controls / use pointer
// lock.

export type Platform = 'pc' | 'mobile';

const KEY = 'fractaluni.platform';

let current: Platform | null = null;

/** Heuristic default for the platform picker (touch + coarse pointer → mobile). */
export function guessPlatform(): Platform {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  return coarse && touch ? 'mobile' : 'pc';
}

/** The stored platform choice, if the player has picked one before. */
export function storedPlatform(): Platform | null {
  if (current) return current;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'pc' || v === 'mobile') return (current = v);
  } catch {
    /* ignore */
  }
  return null;
}

export function setPlatform(p: Platform): void {
  current = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
}

/** Resolved platform: stored choice, else heuristic. */
export function getPlatform(): Platform {
  return storedPlatform() ?? guessPlatform();
}

export function isMobile(): boolean {
  return getPlatform() === 'mobile';
}
