import { DataError, readLibrary, readLibraryStamp, writeLibrary } from '../domain/codec.ts';
import type { LibraryStamp } from '../domain/codec.ts';
import type { Library } from '../domain/types.ts';

/**
 * Where the user's library lives. The app only talks to this interface, so moving from the browser to a
 * server means adding one class (e.g. `HttpLibraryRepository`) and changing one line in `state/instance.ts`.
 */
export interface LibraryRepository {
  load(): Promise<Library>;
  save(library: Library): Promise<void>;
  /** How long to wait after an edit before saving (default: `config.storage.saveDelayMs`). */
  readonly saveDelayMs?: number;
  /**
   * Calls `listener` with the stored library whenever another tab saves it (for repositories that can tell).
   * The listener must merge it in: the next save takes it as read. Returns a function that stops listening.
   */
  watch?(listener: (stored: Library) => void): () => void;
}

export class RepositoryError extends Error {
  override readonly name = 'RepositoryError';
}

/**
 * A save was refused because another tab saved since this one last read: nothing was written. `stored` is the
 * library now in storage; merge it in and save again (the repository takes it as read).
 */
export class StaleLibraryError extends RepositoryError {
  readonly stored: Library;
  constructor(stored: Library) {
    super('The library was changed in another tab.');
    this.stored = stored;
  }
}

/** The subset of the Web Storage API we use (also easy to fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What a `storage` event carries that we use: which key changed (null when all storage was cleared). */
export interface StorageChange { key: string | null }
/** Where `storage` events come from (`window` in the browser; a stand-in in tests). */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (e: StorageChange) => void): void;
  removeEventListener(type: 'storage', listener: (e: StorageChange) => void): void;
}

export class MemoryRepository implements LibraryRepository {
  private library: Library;
  constructor(initial: Library = { teams: [] }) { this.library = structuredClone(initial); }
  load(): Promise<Library> { return Promise.resolve(structuredClone(this.library)); }
  save(library: Library): Promise<void> { this.library = structuredClone(library); return Promise.resolve(); }
}

/**
 * The library in browser storage. Every save stamps it with a revision one higher than the stored one, and refuses
 * (with {@link StaleLibraryError}) to write over a revision this tab hasn't read, so a tab never writes its whole
 * copy over what another tab saved. With `events`, {@link watch} hears other tabs' saves as they happen.
 */
export class LocalStorageRepository implements LibraryRepository {
  private readonly storage: StorageLike;
  private readonly key: string;
  private readonly legacyKey: string | null;
  private readonly events: StorageEvents | null;
  /** The stamp of the stored library this tab last read or wrote; null while nothing is stored under the key. */
  private lastStamp: LibraryStamp | null = null;

  constructor(storage: StorageLike, key: string, legacyKey: string | null = null, events: StorageEvents | null = null) {
    this.storage = storage;
    this.key = key;
    this.legacyKey = legacyKey;
    this.events = events;
  }

  load(): Promise<Library> {
    const current = this.storage.getItem(this.key);
    const raw = current ?? (this.legacyKey ? this.storage.getItem(this.legacyKey) : null);
    if (raw === null) { this.lastStamp = null; return Promise.resolve({ teams: [] }); }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
      const library = readLibrary(parsed);
      this.lastStamp = current === null ? null : readLibraryStamp(parsed);
      return Promise.resolve(library);
    } catch (e) {
      // Taken as read: the copy below is what keeps it, so the next save may replace it without another copy.
      this.lastStamp = current === null ? null : readLibraryStamp(parsed);
      return Promise.reject(new RepositoryError(`Saved data couldn't be read (${reasonOf(e)}). A copy was kept under "${this.keepCopy(raw)}".`));
    }
  }

  save(library: Library): Promise<void> {
    const raw = this.storage.getItem(this.key);
    let revision = 0;
    if (raw !== null) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw) as unknown; } catch { parsed = undefined; }
      const stamp = readLibraryStamp(parsed);
      if (!sameStamp(stamp, this.lastStamp)) {
        // Another tab saved since we last read: hand its library back to be merged instead of writing over it.
        try {
          const stored = readLibrary(parsed);
          this.lastStamp = stamp;
          return Promise.reject(new StaleLibraryError(stored));
        } catch {
          this.keepCopy(raw); // what we can't read is kept aside, then replaced
        }
      }
      revision = stamp.revision;
    }
    const stamp: LibraryStamp = { revision: revision + 1, savedAt: new Date().toISOString() };
    try {
      this.storage.setItem(this.key, JSON.stringify(writeLibrary(library, stamp)));
      this.lastStamp = stamp;
      return Promise.resolve();
    } catch {
      return Promise.reject(new RepositoryError("Couldn't save: browser storage is full or unavailable. Export your data to keep it."));
    }
  }

  watch(listener: (stored: Library) => void): () => void {
    const events = this.events;
    if (!events) return () => {};
    const onStorage = (e: StorageChange): void => { this.handleStorageEvent(e, listener); };
    events.addEventListener('storage', onStorage);
    return () => events.removeEventListener('storage', onStorage);
  }

  /**
   * Another tab wrote to storage. If it saved a library this tab hasn't read, `listener` gets it (read now, so it is
   * the latest even if events queued up). A removed or unreadable library is left to the next save.
   */
  handleStorageEvent(e: StorageChange, listener: (stored: Library) => void): void {
    if (e.key !== this.key && e.key !== null) return;
    const raw = this.storage.getItem(this.key);
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const stamp = readLibraryStamp(parsed);
      if (sameStamp(stamp, this.lastStamp)) return;
      const stored = readLibrary(parsed);
      this.lastStamp = stamp;
      listener(stored);
    } catch { /* unreadable: the next save keeps a copy of it */ }
  }

  /** Keeps unreadable data under a side key so it can be recovered by hand; returns that key. */
  private keepCopy(raw: string): string {
    const backupKey = `${this.key}:unreadable-${Date.now()}`;
    try { this.storage.setItem(backupKey, raw); } catch { /* storage full: nothing more we can do */ }
    return backupKey;
  }
}

const sameStamp = (a: LibraryStamp, b: LibraryStamp | null): boolean => b !== null && a.revision === b.revision && a.savedAt === b.savedAt;
const reasonOf = (e: unknown): string => (e instanceof DataError || e instanceof SyntaxError ? e.message : 'unknown error');

/** Returns `localStorage` if it works (it can throw in private modes or when blocked), otherwise null. */
export function usableLocalStorage(): Storage | null {
  try {
    const probe = '__vgc_planner_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch { return null; }
}
