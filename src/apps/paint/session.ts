// Hand-off between the folder windows and Paint97, plus the "which file is on the canvas" binding.
import type { Scene } from "../../lib/storage.ts";
import { createStore } from "../../lib/store.ts";
import { actions } from "../../shell/wmStore.ts";

export type OpenReq = { scene: Scene; name: string; fileId: string | null };
/** Pending open request; Paint consumes it once its canvas is ready. Not persisted. */
export const openReq = createStore<OpenReq | null>(null);
export function openInPaint(req: OpenReq) {
  openReq.set(req);
  actions.open("paint");
}

const KEY = "paint97.file.v1";
export const boundFile = createStore<string | null>((() => { try { return localStorage.getItem(KEY); } catch { return null; } })());
boundFile.subscribe(() => {
  try { const id = boundFile.get(); if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* blocked storage */ }
});
