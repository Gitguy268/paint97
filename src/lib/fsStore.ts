// My Drawings storage: one index record (lib/fs.ts) plus one body record per
// file and per version, all in the shared `paint97` KV database.
//   fs:index            the Fs index (names, folders, bin flags, version stamps)
//   fs:body:<id>        current scene JSON
//   fs:ver:<id>:<at>    snapshot scene JSON
// Bodies are written before the index, so a crash leaves an orphan body, never a dangling file.
import * as F from "./fs.ts";
import { kvOf, type KvArg, type KvStore } from "./idb.ts";
import { parseStoredScene, slimAppState, type Scene } from "./storage.ts";
import { createStore } from "./store.ts";

const INDEX = "fs:index";
const bodyKey = (id: string) => `fs:body:${id}`;
const verKey = (id: string, at: number) => `fs:ver:${id}:${at}`;

type Inverse = (fs: F.Fs) => F.Fs;
export type FsState = { fs: F.Fs; undo: readonly Inverse[]; loaded: boolean };
export const fsState = createStore<FsState>({ fs: F.EMPTY_FS, undo: [], loaded: false });

const need = async (kv: KvArg): Promise<KvStore> => {
  const store = await kvOf(kv);
  if (!store) throw new Error("storage unavailable");
  return store;
};
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const toJson = (scene: Scene) => JSON.stringify({ elements: scene.elements, appState: slimAppState(scene.appState) });
const fromJson = (raw: string | null): Scene | null => {
  if (raw === null) return null;
  try { return parseStoredScene(JSON.parse(raw)); } catch { return null; }
};

/** Index writes run one at a time so an autosave can't land an older index over a newer one. */
let queue: Promise<unknown> = Promise.resolve();
function commit(kv: KvArg, change: (fs: F.Fs) => F.Fs, inverse?: Inverse | "clear"): Promise<void> {
  const run = queue.then(async () => {
    const store = await need(kv);
    const cur = fsState.get();
    const next = change(cur.fs);
    if (next === cur.fs) return;
    await store.set(INDEX, JSON.stringify(next));
    const undo = inverse === "clear" ? [] : inverse ? [...cur.undo, inverse].slice(-20) : cur.undo;
    fsState.set({ fs: next, undo, loaded: true });
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function loadFs(kv?: KvArg): Promise<void> {
  const store = await kvOf(kv);
  let fs = F.EMPTY_FS;
  try {
    const raw = store ? await store.get(INDEX) : null;
    if (raw) fs = F.parseFs(JSON.parse(raw));
  } catch { /* unreadable index: start empty rather than crash the folder window */ }
  fsState.set({ fs, undo: [], loaded: true });
}

async function dropBodies(store: KvStore, removed: readonly F.FsNode[]) {
  for (const n of removed) {
    if (n.kind !== "file") continue;
    await store.del(bodyKey(n.id));
    for (const at of n.versions) await store.del(verKey(n.id, at));
  }
}

export const fsOps = {
  newFolder: (name: string, parent: string | null, kv?: KvArg) =>
    commit(kv, (fs) => F.addNode(fs, { id: newId(), kind: "folder", name, parent, at: Date.now() })),

  /** Save a scene as a new file; resolves its id. */
  async create(name: string, parent: string | null, scene: Scene, kv?: KvArg): Promise<string> {
    const store = await need(kv);
    const id = newId();
    const json = toJson(scene);
    const at = Date.now();
    await store.set(bodyKey(id), json);
    await store.set(verKey(id, at), json);
    await commit(kv, (fs) => F.touch(F.addNode(fs, { id, kind: "file", name, parent, at }), id, json.length, at, true).fs);
    return id;
  },

  /** Overwrite a file. A snapshot is kept when `snapshot` is set or the last one is old enough. */
  async write(id: string, scene: Scene, snapshot = false, kv?: KvArg): Promise<void> {
    const store = await need(kv);
    const node = fsState.get().fs.nodes[id];
    if (!node || node.kind !== "file") throw new Error("no such file");
    const json = toJson(scene);
    const at = Date.now();
    const snap = snapshot || F.snapshotDue(node, at);
    await store.set(bodyKey(id), json);
    if (snap) await store.set(verKey(id, at), json);
    let dropped: number[] = [];
    await commit(kv, (fs) => { const r = F.touch(fs, id, json.length, at, snap); dropped = r.dropped; return r.fs; });
    for (const old of dropped) await store.del(verKey(id, old)).catch(() => undefined);
  },

  /**
   * Snapshot the current body if it has changed since the last snapshot. Called before an
   * older version replaces it, so autosaved-but-unversioned work is never lost to a restore.
   */
  async keep(id: string, kv?: KvArg): Promise<void> {
    const store = await need(kv);
    const node = fsState.get().fs.nodes[id];
    if (!node || node.kind !== "file" || node.modifiedAt <= (node.versions.at(-1) ?? 0)) return;
    const raw = await store.get(bodyKey(id));
    if (raw === null) return;
    const at = Date.now();
    await store.set(verKey(id, at), raw);
    let dropped: number[] = [];
    await commit(kv, (fs) => { const r = F.touch(fs, id, raw.length, at, true); dropped = r.dropped; return r.fs; });
    for (const old of dropped) await store.del(verKey(id, old)).catch(() => undefined);
  },

  read: async (id: string, kv?: KvArg) => fromJson(await (await need(kv)).get(bodyKey(id))),
  readVersion: async (id: string, at: number, kv?: KvArg) => fromJson(await (await need(kv)).get(verKey(id, at))),

  rename(id: string, name: string, kv?: KvArg) {
    const old = fsState.get().fs.nodes[id]?.name;
    return commit(kv, (fs) => F.rename(fs, id, name, Date.now()), old === undefined ? undefined : (fs) => F.rename(fs, id, old, Date.now()));
  },
  move(id: string, parent: string | null, kv?: KvArg) {
    const from = fsState.get().fs.nodes[id]?.parent ?? null;
    return commit(kv, (fs) => F.move(fs, id, parent), (fs) => F.move(fs, id, from));
  },
  async trash(id: string, kv?: KvArg) {
    await commit(kv, (fs) => F.trash(fs, id, Date.now()), (fs) => F.restore(fs, id));
    // Housekeeping: evict the oldest bin entries beyond the cap.
    for (const old of F.binOverflow(fsState.get().fs)) await fsOps.purge(old, kv).catch(() => undefined);
  },
  restore(id: string, kv?: KvArg) {
    const at = fsState.get().fs.nodes[id]?.trashedAt ?? Date.now();
    return commit(kv, (fs) => F.restore(fs, id), (fs) => F.trash(fs, id, at));
  },
  /** Permanent: bodies are deleted, so the undo history is dropped too. */
  async purge(id: string, kv?: KvArg) {
    const store = await need(kv);
    let removed: F.FsNode[] = [];
    await commit(kv, (fs) => { const r = F.purge(fs, id); removed = r.removed; return r.fs; }, "clear");
    await dropBodies(store, removed);
  },
  async emptyBin(kv?: KvArg) {
    for (const n of F.trashed(fsState.get().fs)) await fsOps.purge(n.id, kv);
  },
  undo(kv?: KvArg) {
    const { undo } = fsState.get();
    const inverse = undo.at(-1);
    if (!inverse) return Promise.resolve();
    fsState.set((s) => ({ ...s, undo: s.undo.slice(0, -1) }));
    return commit(kv, inverse);
  },
};
