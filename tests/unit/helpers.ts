// Shared localStorage stub for Node unit tests.
//
// The modules under test read/write browser storage through a bare
// `localStorage` global, which does not exist in Node. Installed via
// defineProperty so it works whether or not the runtime ships a WebStorage
// global. `fail = true` simulates blocked/full storage (every operation
// throws) — the app code must swallow those.
export class MemoryStorage {
  fail = false;
  #store = new Map<string, string>();

  getItem(key: string): string | null {
    if (this.fail) throw new Error("storage blocked");
    return this.#store.has(key) ? this.#store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw new Error("storage blocked");
    this.#store.set(key, String(value));
  }

  removeItem(key: string): void {
    if (this.fail) throw new Error("storage blocked");
    this.#store.delete(key);
  }

  clear(): void {
    if (this.fail) throw new Error("storage blocked");
    this.#store.clear();
  }
}

/** Replace the global with a fresh stub; call in beforeEach. */
export function installStorage(): MemoryStorage {
  const stub = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: stub,
    configurable: true,
    writable: true,
  });
  return stub;
}

// In-memory stand-in for src/lib/idb.ts's KvStore (Node has no IndexedDB).
// `fail = true` simulates a broken/full database (every operation rejects):
// reads must fall back to the legacy localStorage record, saves and clears
// must surface the rejection instead of swallowing it. `delayMs` slows each
// operation so tests can prove storage.ts serialises its writes.
export class MemoryKv {
  fail = false;
  delayMs = 0;
  #m = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    if (this.fail) throw new Error("kv blocked");
    if (this.delayMs) await new Promise<void>((r) => { setTimeout(r, this.delayMs); });
    return this.#m.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.fail) throw new Error("kv blocked");
    if (this.delayMs) await new Promise<void>((r) => { setTimeout(r, this.delayMs); });
    this.#m.set(key, String(value));
  }

  async del(key: string): Promise<void> {
    if (this.fail) throw new Error("kv blocked");
    if (this.delayMs) await new Promise<void>((r) => { setTimeout(r, this.delayMs); });
    this.#m.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    if (this.fail) throw new Error("kv blocked");
    if (this.delayMs) await new Promise<void>((r) => { setTimeout(r, this.delayMs); });
    // Sorted like IndexedDB primary-key order — key layouts depend on it.
    return [...this.#m.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
