// A single in-world clock shared across scenes. Advances with real time while
// playing; used to compute "how long were you away" when returning to a planet
// so its ecosystem can catch up. (Session-scoped — not persisted across reloads.)

export const worldClock = { seconds: 0 };

export function advanceWorldClock(dt: number): void {
  worldClock.seconds += dt;
}
