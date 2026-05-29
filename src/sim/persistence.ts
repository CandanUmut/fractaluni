import {
  deserialize,
  serialize,
  type PlanetDiff,
  type SerializedDiff,
} from './planetDiff.ts';

// Client-side persistence for planet diffs, in IndexedDB, keyed by
// universeSeed + planetPath. No backend. Pristine planets store nothing, so
// "the universe is free" holds — only your footprint costs storage.

const DB_NAME = 'fractaluni';
const STORE = 'planetDiffs';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Stable storage key for a specific planet in a specific universe. */
export function planetPath(
  universeSeed: number,
  cell: readonly [number, number, number],
  starIndex: number,
  planetIndex: number,
): string {
  return `u${universeSeed >>> 0}|c${cell[0]},${cell[1]},${cell[2]}|s${starIndex}|p${planetIndex}`;
}

export async function loadDiff(key: string): Promise<PlanetDiff | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as SerializedDiff | undefined;
        resolve(v ? deserialize(v) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null; // storage unavailable (e.g. private mode) → treat as pristine
  }
}

export async function saveDiff(key: string, diff: PlanetDiff): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(serialize(diff), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore persistence failures — gameplay must not break on storage errors */
  }
}

const PROGRESS_KEY = '__progression__';

/** Load global player progression (currency, equipment tiers). */
export async function loadProgress<T>(): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(PROGRESS_KEY);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveProgress<T>(obj: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(obj, PROGRESS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Remove a planet's diff (restores it to pristine baseline). */
export async function clearDiff(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
