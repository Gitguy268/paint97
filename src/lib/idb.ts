// Minimal IndexedDB key/value wrapper behind Paint97's scene autosave.
//
// Why IndexedDB: localStorage caps an origin near ~5 MB while scenes may be
// up to 25 MB, so a big drawing failed to autosave (the quota error was
// swallowed). IndexedDB shares the origin's much larger storage allowance
// and its writes do not block timers.
//
// The wrapper exposes a structural KV interface (get/set/del over JSON
// strings) so unit tests pass a stand-in — the same pattern as
// localAi/model.ts's PartCache. When IndexedDB is missing, blocked or
// broken, `openSceneStore()` resolves null and callers fall back to the
// legacy localStorage record instead of losing the canvas.

export type KvStore = {
  /** Resolve the stored string, or null when the key is genuinely absent. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Every string key starting with `prefix`, ascending — IndexedDB returns
   * keys in primary-key order, which the record layouts in drawings.ts and
   * bin.ts exploit (they encode timestamps so key order is chronological).
   */
  keys(prefix: string): Promise<string[]>;
};

const DB_NAME = "paint97";
const DB_VERSION = 1;
const STORE = "kv";
// Browsers can stall on open (an onblocked upgrade, a wedged storage
// process). The boot overlay waits on this read, so a stalled open must
// degrade to the legacy path rather than pinning the splash screen.
const OPEN_MS = 3000;
// Per-operation guard for the same reason: a transaction that never settles
// would stall loadScene forever. A timeout counts as failure — the caller
// keeps the localStorage copy rather than dropping data.
const OP_MS = 4000;

/** Reject when `p` has not settled within `ms` — storage must never hang boot. */
export const withTimeout = <T>(p: Promise<T>, ms = OP_MS): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("storage timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

const wrap = (db: IDBDatabase): KvStore => {
  // Another tab upgrading the schema: close instead of blocking it.
  db.onversionchange = () => db.close();
  const run = <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    withTimeout(
      new Promise<T>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE, mode);
          const req = body(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req.result);
          tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
          req.onerror = () => reject(req.error ?? new Error("request failed"));
        } catch (e) {
          reject(e);
        }
      }),
    );
  return {
    get: (key) => run<string | undefined>("readonly", (s) => s.get(key)).then((v) => v ?? null),
    set: (key, value) => run("readwrite", (s) => s.put(value, key)).then(() => undefined),
    del: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
    keys: (prefix) =>
      run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((all) =>
        all.filter((k): k is string => typeof k === "string" && k.startsWith(prefix)),
      ),
  };
};

/**
 * Open the Paint97 KV database, resolving null when IndexedDB is
 * unavailable, blocked or does not answer within OPEN_MS. The promise is
 * memoised by callers (storage.ts), so a failed open never retries mid-run —
 * the session simply stays on the legacy localStorage path.
 */
export function openSceneStore(): Promise<KvStore | null> {
  let idb: IDBFactory | undefined;
  try {
    // The getter itself throws in some hardened privacy modes.
    idb = globalThis.indexedDB;
  } catch {
    idb = undefined;
  }
  if (!idb) return Promise.resolve(null);
  return new Promise<KvStore | null>((resolve) => {
    let settled = false;
    const done = (v: KvStore | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), OPEN_MS);
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      if (settled) {
        // The open timed out earlier — don't leak the late handle.
        req.result.close();
        return;
      }
      done(wrap(req.result));
    };
    req.onerror = () => done(null);
    req.onblocked = () => { /* onerror or the timeout settles the open */ };
  });
}

// Memoised shared handle: the scene autosave, My Drawings and the Recycle
// Bin all talk to the ONE `paint97` connection opened per session (a failed
// open stays failed — no retry storms while storage is broken).
let shared: Promise<KvStore | null> | null = null;
export const sharedStore = (): Promise<KvStore | null> => (shared ??= openSceneStore());

// Structural injection point used by every store module: `undefined` means
// "use the real shared store", `null` means "IndexedDB is unavailable"
// (callers take their documented fallback path), and unit tests pass a
// stand-in KvStore instead. The same pattern as PartCache in
// localAi/model.ts.
export type KvArg = KvStore | null | undefined;
export const kvOf = (kv: KvArg): Promise<KvStore | null> =>
  kv === undefined ? sharedStore() : Promise.resolve(kv);
