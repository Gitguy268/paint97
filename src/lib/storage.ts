// `./idb.ts` keeps the import resolvable under Node's native type-stripping
// (the unit tests run these modules directly) — allowImportingTsExtensions
// is on in tsconfig.app.json.
import { kvOf, type KvArg } from "./idb.ts";

export const LS_KEY = "paint97.scene.v1";
/** IndexedDB record key inside the `paint97` KV database. */
const IDB_KEY = "scene";

export type Scene = { elements: object[]; appState: object };

const isElementLike = (e: unknown): boolean => !!e && typeof e === "object" && !Array.isArray(e);

// Shape check shared by the localStorage record, the IndexedDB copy and
// My Drawings (drawings.ts): a stored scene must be a record whose
// elements are all objects. Returns null (never throws) so hostile or
// truncated data degrades to "no scene".
export const parseStoredScene = (raw: unknown): Scene | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.elements)) return null;
  if (!rec.elements.every(isElementLike)) return null;
  if (rec.appState !== undefined && (typeof rec.appState !== "object" || rec.appState === null || Array.isArray(rec.appState))) return null;
  return { elements: rec.elements as object[], appState: (rec.appState as object) ?? {} };
};

// Legacy localStorage record — still the fallback while IndexedDB is
// unavailable, and the migration source on the first IndexedDB load.
export function loadLocal(): Scene | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return parseStoredScene(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

// Drop Excalidraw's Map-backed collaborators key before serialising: it
// survives as a meaningless `{}` in JSON. Shared by the autosave and
// My Drawings so both records are shaped identically.
export const slimAppState = (appState: object): Record<string, unknown> => {
  const slim = { ...(appState as Record<string, unknown>) };
  delete slim.collaborators;
  return slim;
};

// ---------------------------------------------------------------- scene store

// Writes run one at a time: the debounced autosave, the unmount flush and
// clearScene must never interleave, or an older snapshot could land on top
// of a newer one (or resurrect a cleared scene).
let writeQueue: Promise<unknown> = Promise.resolve();
const enqueue = (op: () => Promise<void>): Promise<void> => {
  const run = writeQueue.then(op, op);
  writeQueue = run.catch(() => undefined);
  return run;
};

/**
 * Load the autosaved scene. IndexedDB is the source of truth when it
 * answers; a legacy localStorage record is migrated across (copied over
 * only after the new store confirmed the write, then removed) and remains
 * the fallback whenever IndexedDB is unavailable, blocked or broken.
 * Never rejects.
 */
export async function loadScene(kv?: KvArg): Promise<Scene | null> {
  const store = await kvOf(kv);
  if (store) {
    try {
      const raw = await store.get(IDB_KEY);
      if (raw !== null) {
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        const rec = parseStoredScene(parsed);
        if (rec) {
          // Drop a stale migration leftover, best-effort: the IndexedDB
          // copy wins from here on.
          try { localStorage.removeItem(LS_KEY); } catch { /* blocked storage */ }
          return rec;
        }
      }
    } catch { /* read failed/timed out — try the legacy record below */ }
  }
  const legacy = loadLocal();
  if (!legacy || !store) return legacy;
  try {
    await store.set(IDB_KEY, JSON.stringify({ elements: legacy.elements, appState: legacy.appState }));
    try { localStorage.removeItem(LS_KEY); } catch { /* blocked storage */ }
  } catch { /* keep serving from localStorage — never drop the only copy */ }
  return legacy;
}

/**
 * Persist the scene. Resolves on success; rejects when nothing could be
 * written (full/blocked storage) so the UI can warn instead of dropping
 * the drawing silently.
 */
export function saveScene(elements: object[], appState: object, kv?: KvArg): Promise<void> {
  return enqueue(async () => {
    const store = await kvOf(kv);
    const json = JSON.stringify({ elements, appState: slimAppState(appState) });
    if (store) {
      await store.set(IDB_KEY, json);
      return;
    }
    // Legacy path: quota/blocked errors must surface, not vanish.
    localStorage.setItem(LS_KEY, json);
  });
}

/**
 * Remove the autosaved scene from both stores. IndexedDB first: if that
 * fails the whole operation rejects and the localStorage copy survives
 * untouched, so "clear" never half-happens.
 */
export function clearScene(kv?: KvArg): Promise<void> {
  return enqueue(async () => {
    const store = await kvOf(kv);
    if (store) await store.del(IDB_KEY);
    try { localStorage.removeItem(LS_KEY); } catch { /* blocked storage — nothing to clear */ }
  });
}

export function download(filename: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Attached before click: detached-anchor clicks are ignored on Safari/Firefox.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Strip the target suffix (and the legacy .excalidraw one), kill path
// separators and control chars so exports land with sane names on every OS.
// Falls back to "untitled". Truncates to 100 chars so 255-byte OS limits
// can't break the download.
export function slugFilename(name: string, ext: string): string {
  const base = (name ?? "")
    .trim()
    .replace(/\.excalidraw$/i, "")
    .replace(/\.txt$/i, "")
    .replace(new RegExp(ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"), "")
    .replace(/[^\w\-. ]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 100) || "untitled";
  return base + ext;
}

export function buildScenePayload(elements: unknown, appState: unknown) {
  const { collaborators: _drop, ...restAppState } = ((appState as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
  void _drop;
  return {
    type: "excalidraw",
    version: 2,
    source: "paint97",
    elements: elements ?? [],
    appState: restAppState,
    files: {},
  };
}

export function sceneToFile(elements: unknown, appState: unknown, name: string) {
  download(slugFilename(name, ".excalidraw"), JSON.stringify(buildScenePayload(elements, appState), null, 2));
}

// 25MB cap: Excalidraw scenes are JSON text; anything bigger is either not
// a scene or would wedge the canvas. Shape-checked so a malformed file can
// never reach updateScene.
const MAX_SCENE_FILE = 25 * 1024 * 1024;
// Element-count cap: a 25MB file could hold hundreds of thousands of tiny
// objects, and validating/rendering those would freeze the tab long after
// the JSON itself parsed. Real drawings stay far below this.
const MAX_SCENE_ELEMENTS = 100_000;

const checkElements = (elements: unknown): object[] => {
  if (!Array.isArray(elements)) throw new Error("bad elements");
  if (elements.length > MAX_SCENE_ELEMENTS) throw new Error("too many elements");
  if (!elements.every(isElementLike)) throw new Error("bad elements");
  return elements as object[];
};

// Shape-checked scene parsing shared by the file loader and share links:
// a hostile payload (whatever its transport) must never reach updateScene.
// supports both raw .excalidraw and array exports.
export function parseSceneJson(json: unknown): { elements: object[]; appState: object } {
  if (Array.isArray(json)) {
    return { elements: checkElements(json), appState: {} };
  }
  if (!json || typeof json !== "object") throw new Error("not a scene");
  const rec = json as Record<string, unknown>;
  const elements = checkElements(rec.elements ?? []);
  const appState = rec.appState ?? {};
  if (!appState || typeof appState !== "object" || Array.isArray(appState)) throw new Error("bad appState");
  return { elements, appState: appState as object };
}

export async function readSceneFile(file: File): Promise<{ elements: object[]; appState: object }> {
  if (file.size > MAX_SCENE_FILE) throw new Error("file too large");
  const text = await file.text();
  return parseSceneJson(JSON.parse(text));
}
