// Pure file-system index for My Drawings: folders, files, a Recycle Bin flag
// and per-file version timestamps. No storage, no clock, no DOM: every
// function returns a new index. Bodies live elsewhere (fsStore.ts), keyed by id.
export type FsNode = {
  id: string;
  kind: "folder" | "file";
  name: string;
  /** null = the My Drawings root. */
  parent: string | null;
  createdAt: number;
  modifiedAt: number;
  /** Body size in JSON characters (files only). */
  chars: number;
  /** Set while the node sits in the Recycle Bin. */
  trashedAt: number | null;
  /** Snapshot timestamps, oldest first (files only). */
  versions: readonly number[];
};
export type Fs = { nodes: Readonly<Record<string, FsNode>> };

export const EMPTY_FS: Fs = { nodes: {} };
export const MAX_VERSIONS = 10;
/** A new snapshot is kept at most this often while a drawing autosaves. */
export const VERSION_GAP_MS = 2 * 60_000;
export const BIN_MAX_ITEMS = 50;
const MAX_NODES = 5000;

/** A name is a list label, not a path: letters/numbers plus space and ._-, max 64 chars. */
export function sanitizeName(name: string): string {
  return (
    (name ?? "")
      .replace(/\.excalidraw$/i, "")
      .replace(/[^\p{L}\p{N}_.\- ()]+/gu, "")
      .trim()
      .slice(0, 64)
      .trim() || "untitled"
  );
}

const live = (fs: Fs) => Object.values(fs.nodes).filter((n) => n.trashedAt === null);
const put = (fs: Fs, n: FsNode): Fs => ({ nodes: { ...fs.nodes, [n.id]: n } });
const isFolder = (fs: Fs, id: string | null) => id === null || (fs.nodes[id]?.kind === "folder" && fs.nodes[id]?.trashedAt === null);

/** "name", then "name (2)", "name (3)"… so siblings never collide. */
export function uniqueName(fs: Fs, parent: string | null, name: string, exceptId?: string): string {
  const taken = new Set(live(fs).filter((n) => n.parent === parent && n.id !== exceptId).map((n) => n.name.toLowerCase()));
  const base = sanitizeName(name);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 58)} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Folder listing: folders first, then by name. */
export function children(fs: Fs, parent: string | null): FsNode[] {
  return live(fs)
    .filter((n) => n.parent === parent)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "folder" ? -1 : 1));
}

/** Recycle Bin listing, newest deletion first. */
export const trashed = (fs: Fs): FsNode[] =>
  Object.values(fs.nodes).filter((n) => n.trashedAt !== null).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

/** Folder names from the root down to (and including) `id`. */
export function pathOf(fs: Fs, id: string | null): string[] {
  const out: string[] = [];
  for (let cur = id, guard = 0; cur !== null && guard < 64; guard++) {
    const n = fs.nodes[cur];
    if (!n) break;
    out.unshift(n.name);
    cur = n.parent;
  }
  return out;
}

export function isDescendant(fs: Fs, id: string | null, ancestor: string): boolean {
  for (let cur = id, guard = 0; cur !== null && guard < 64; guard++) {
    if (cur === ancestor) return true;
    cur = fs.nodes[cur]?.parent ?? null;
  }
  return false;
}

/** True when the node and every folder above it are outside the bin. */
export function isLive(fs: Fs, id: string): boolean {
  for (let cur: string | null = id, guard = 0; cur !== null && guard < 64; guard++) {
    const n: FsNode | undefined = fs.nodes[cur];
    if (!n || n.trashedAt !== null) return false;
    cur = n.parent;
  }
  return true;
}

export function addNode(fs: Fs, spec: { id: string; kind: FsNode["kind"]; name: string; parent: string | null; at: number; chars?: number }): Fs {
  if (fs.nodes[spec.id] || Object.keys(fs.nodes).length >= MAX_NODES) return fs;
  const parent = isFolder(fs, spec.parent) ? spec.parent : null;
  return put(fs, {
    id: spec.id, kind: spec.kind, name: uniqueName(fs, parent, spec.name), parent,
    createdAt: spec.at, modifiedAt: spec.at, chars: spec.chars ?? 0, trashedAt: null, versions: [],
  });
}

export function rename(fs: Fs, id: string, name: string, at: number): Fs {
  const n = fs.nodes[id];
  if (!n) return fs;
  const next = uniqueName(fs, n.parent, name, id);
  return next === n.name ? fs : put(fs, { ...n, name: next, modifiedAt: at });
}

/** Move into a folder (or the root). A folder can never move into itself or its own subtree. */
export function move(fs: Fs, id: string, parent: string | null): Fs {
  const n = fs.nodes[id];
  if (!n || n.parent === parent || !isFolder(fs, parent) || isDescendant(fs, parent, id)) return fs;
  return put(fs, { ...n, parent, name: uniqueName(fs, parent, n.name, id) });
}

export function trash(fs: Fs, id: string, at: number): Fs {
  const n = fs.nodes[id];
  return n && n.trashedAt === null ? put(fs, { ...n, trashedAt: at }) : fs;
}

/** Back to where it was; if that folder is gone or binned, to the root. */
export function restore(fs: Fs, id: string): Fs {
  const n = fs.nodes[id];
  if (!n || n.trashedAt === null) return fs;
  const parent = n.parent !== null && isLive(fs, n.parent) ? n.parent : null;
  return put(fs, { ...n, trashedAt: null, parent, name: uniqueName(fs, parent, n.name, id) });
}

/** Permanently drop a node and everything inside it. `removed` lists the nodes whose bodies must go too. */
export function purge(fs: Fs, id: string): { fs: Fs; removed: FsNode[] } {
  if (!fs.nodes[id]) return { fs, removed: [] };
  const removed = Object.values(fs.nodes).filter((n) => isDescendant(fs, n.id, id));
  const gone = new Set(removed.map((n) => n.id));
  return { fs: { nodes: Object.fromEntries(Object.entries(fs.nodes).filter(([k]) => !gone.has(k))) }, removed };
}

/** Oldest bin entries beyond the cap: the bin is a safety net, not an archive. */
export const binOverflow = (fs: Fs): string[] => trashed(fs).slice(BIN_MAX_ITEMS).map((n) => n.id);

export const snapshotDue = (n: FsNode, at: number): boolean => at - (n.versions.at(-1) ?? -Infinity) >= VERSION_GAP_MS;

/** Record a write. With `snapshot`, `at` joins the version list; `dropped` are evicted version stamps. */
export function touch(fs: Fs, id: string, chars: number, at: number, snapshot: boolean): { fs: Fs; dropped: number[] } {
  const n = fs.nodes[id];
  if (!n || n.kind !== "file") return { fs, dropped: [] };
  const all = snapshot ? [...n.versions, at] : [...n.versions];
  const dropped = all.slice(0, Math.max(0, all.length - MAX_VERSIONS));
  return { fs: put(fs, { ...n, chars, modifiedAt: at, versions: all.slice(dropped.length) }), dropped };
}

// ---- persistence (the stored index is untrusted input) ----
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function parseFs(raw: unknown): Fs {
  if (!raw || typeof raw !== "object") return EMPTY_FS;
  const src = (raw as { nodes?: unknown }).nodes;
  if (!src || typeof src !== "object") return EMPTY_FS;
  const nodes: Record<string, FsNode> = {};
  for (const [id, v] of Object.entries(src as Record<string, unknown>).slice(0, MAX_NODES)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (r.id !== id || (r.kind !== "folder" && r.kind !== "file") || typeof r.name !== "string" || !num(r.createdAt) || !num(r.modifiedAt)) continue;
    nodes[id] = {
      id, kind: r.kind, name: sanitizeName(r.name),
      parent: typeof r.parent === "string" ? r.parent : null,
      createdAt: r.createdAt, modifiedAt: r.modifiedAt,
      chars: num(r.chars) ? r.chars : 0,
      trashedAt: num(r.trashedAt) ? r.trashedAt : null,
      versions: Array.isArray(r.versions) ? r.versions.filter(num).slice(-MAX_VERSIONS) : [],
    };
  }
  // Orphans (parent missing or not a folder) surface in the root instead of vanishing.
  for (const n of Object.values(nodes)) if (n.parent !== null && nodes[n.parent]?.kind !== "folder") nodes[n.id] = { ...n, parent: null };
  return { nodes };
}
