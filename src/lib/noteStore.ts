import type { FSModule } from "browserfs/dist/node/core/FS.js";
import { withTimeout } from "./idb.ts";

export const NOTE_TEXT_KEY = "paint97.notepad.v1";
export const NOTE_NAME_KEY = "paint97.notepad.name.v1";
export const MAX_NOTE_BYTES = 5 * 1024 * 1024;
export type Note = { text: string; name: string };
export type NoteStore = { load(): Promise<Note | null>; save(note: Note): Promise<void>; clear(): Promise<void> };
type NoteFs = Pick<FSModule, "readFile" | "writeFile" | "rename" | "unlink" | "stat">;
const FILE = "/notepad.json", TEMP = "/notepad.pending.json";
const missing = (e: unknown) => (e as { code?: string } | null)?.code === "ENOENT";

export function parseNote(raw: string): Note {
  const n: unknown = JSON.parse(raw);
  if (!n || typeof n !== "object") throw new Error("invalid note");
  const { text, name } = n as Record<string, unknown>;
  if (typeof text !== "string" || typeof name !== "string" || text.length > MAX_NOTE_BYTES || name.length > 1024) throw new Error("invalid note");
  return { text, name };
}

export function createNoteStore(fs: NoteFs): NoteStore {
  let writes: Promise<void> = Promise.resolve();
  const queue = (job: () => Promise<void>) => (writes = writes.catch(() => undefined).then(job));
  const unlink = (path: string) => new Promise<void>((resolve, reject) => { fs.unlink(path, (e) => e && !missing(e) ? reject(e) : resolve()); });
  return {
    async load() {
      await withTimeout(writes.catch(() => undefined));
      return withTimeout(new Promise<Note | null>((resolve, reject) => {
        fs.stat(FILE, (e, stats) => {
          if (missing(e)) { resolve(null); return; }
          if (e || !stats || stats.size > MAX_NOTE_BYTES * 6 + 2048) { reject(e ?? new Error("note too large")); return; }
          fs.readFile(FILE, "utf8", (err, raw) => {
            if (err) { reject(err); return; }
            try { resolve(parseNote(raw as string)); } catch (bad) { reject(bad); }
          });
        });
      }));
    },
    save(note) {
      const raw = JSON.stringify(parseNote(JSON.stringify(note)));
      return withTimeout(queue(() => new Promise<void>((resolve, reject) => {
        // Rename only after the complete write, so an interrupted save keeps the previous note.
        fs.writeFile(TEMP, raw, "utf8", (e) => {
          if (e) { reject(e); return; }
          fs.rename(TEMP, FILE, (err) => err ? reject(err) : resolve());
        });
      })));
    },
    clear: () => withTimeout(queue(async () => { await unlink(FILE); await unlink(TEMP); })),
  };
}

let shared: Promise<NoteStore | null> | null = null;
export function sharedNoteStore(): Promise<NoteStore | null> {
  return shared ??= withTimeout((async () => {
    const bfs = await import("browserfs");
    await new Promise<void>((resolve, reject) => { bfs.configure({ fs: "IndexedDB", options: { storeName: "paint97-notepad" } }, (e) => e ? reject(e) : resolve()); });
    return createNoteStore(bfs.BFSRequire("fs"));
  })(), 3000).catch(() => null);
}
