// One JSON file holding everything Paint97 keeps in this browser: settings, window
// layout, notes (localStorage) and the canvas, drawings, folders and versions (IndexedDB).
// The Ask Clippy model is not included: it is a 253 MB download, not user data.
import type { KvStore } from "./idb.ts";

export const LS_PREFIX = "paint97.";
/** Record families this app writes to the KV database; anything else in a backup is refused. */
const KV_KEY = /^(scene$|fs:(index$|body:[\w-]+$|ver:[\w-]+:\d+$))/;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export type Backup = { app: "paint97"; version: 1; exportedAt: string; local: Record<string, string>; kv: Record<string, string> };
export type LocalLike = { readonly length: number; key(i: number): string | null; getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

const localKeys = (ls: LocalLike): string[] => {
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k?.startsWith(LS_PREFIX)) out.push(k); }
  return out;
};

export async function exportBackup(ls: LocalLike, kv: KvStore | null, now = new Date()): Promise<Backup> {
  const local: Record<string, string> = {};
  for (const k of localKeys(ls)) { const v = ls.getItem(k); if (v !== null) local[k] = v; }
  const data: Record<string, string> = {};
  for (const k of kv ? await kv.keys("") : []) {
    const v = KV_KEY.test(k) ? await kv!.get(k) : null;
    if (v !== null) data[k] = v;
  }
  return { app: "paint97", version: 1, exportedAt: now.toISOString(), local, kv: data };
}

const strings = (v: unknown, ok: (k: string) => boolean): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("bad section");
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_ENTRIES) throw new Error("too many entries");
  const out: Record<string, string> = {};
  // Unknown keys are dropped, not fatal: a backup from a newer build still restores what this one knows.
  for (const [k, val] of entries) if (typeof val === "string" && ok(k)) out[k] = val;
  return out;
};

/** Trust boundary for imported files. Throws on anything that is not a Paint97 backup. */
export function parseBackup(raw: unknown): Backup {
  if (!raw || typeof raw !== "object") throw new Error("not a backup");
  const r = raw as Record<string, unknown>;
  if (r.app !== "paint97" || r.version !== 1) throw new Error("not a Paint97 backup");
  return {
    app: "paint97", version: 1,
    exportedAt: typeof r.exportedAt === "string" ? r.exportedAt : "",
    local: strings(r.local, (k) => k.startsWith(LS_PREFIX) && k.length < 100),
    kv: strings(r.kv, (k) => KV_KEY.test(k)),
  };
}

export async function resetAll(ls: LocalLike, kv: KvStore | null): Promise<void> {
  for (const k of kv ? await kv.keys("") : []) await kv!.del(k);
  for (const k of localKeys(ls)) ls.removeItem(k);
}

/** Replace all local data with the backup. The big records go first: if storage fails there, settings are untouched. */
export async function importBackup(b: Backup, ls: LocalLike, kv: KvStore | null): Promise<void> {
  if (Object.keys(b.kv).length && !kv) throw new Error("storage unavailable");
  for (const k of kv ? await kv.keys("") : []) await kv!.del(k);
  for (const [k, v] of Object.entries(b.kv)) await kv!.set(k, v);
  for (const k of localKeys(ls)) ls.removeItem(k);
  for (const [k, v] of Object.entries(b.local)) ls.setItem(k, v);
}
