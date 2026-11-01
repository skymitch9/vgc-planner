/**
 * The player's details for the official team list, kept in browser storage under their OWN key
 * (`config.storage.playerDetailsKey`). Never part of the library, so never in `writeLibrary`, an export, a share or
 * the account sync.
 */
import type { PlayerDetailsFile } from '../domain/team-list.ts';
import { emptyDetailsFile, readDetailsFile } from '../domain/team-list.ts';

export interface DetailsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class PlayerDetailsStore {
  private readonly storage: DetailsStorage | null;
  private readonly key: string;

  constructor(storage: DetailsStorage | null, key: string) {
    this.storage = storage;
    this.key = key;
  }

  /** True when the details survive a reload (storage works); false in private modes that block it. */
  get persistent(): boolean { return this.storage !== null; }

  load(): PlayerDetailsFile {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? readDetailsFile(JSON.parse(raw)) : emptyDetailsFile();
    } catch { return emptyDetailsFile(); }
  }

  save(file: PlayerDetailsFile): void {
    try { this.storage?.setItem(this.key, JSON.stringify(readDetailsFile(file))); } catch { /* optional: storage full or blocked */ }
  }

  clear(): void {
    try { this.storage?.removeItem(this.key); } catch { /* nothing saved, nothing to clear */ }
  }
}
