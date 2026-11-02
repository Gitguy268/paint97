// Ask Clippy's model lifecycle as a pure state machine, so every transition
// (including pause/resume of the 1.6 GB download) is unit-tested without a browser.

export type DownloadProgress = { loadedBytes: number; totalBytes: number };

export type ModelPhase = "checking" | "absent" | "downloading" | "paused" | "loading" | "ready" | "error";
export type ModelState = {
  phase: ModelPhase;
  /** Kept while paused so the bar doesn't jump back to zero. */
  progress: DownloadProgress | null;
  error: { kind: "install" | "load"; msg: string } | null;
};
export type ModelEvent =
  | { type: "probed"; cached: boolean }
  | { type: "download" } // also "resume": shards that already finished stay cached
  | { type: "progress"; progress: DownloadProgress }
  | { type: "paused" }
  | { type: "installed" }
  | { type: "ready" }
  | { type: "failed"; kind: "install" | "load"; msg: string }
  | { type: "removing" }
  | { type: "removed" };

export const MODEL_STATE0: ModelState = { phase: "checking", progress: null, error: null };

export function modelReducer(s: ModelState, e: ModelEvent): ModelState {
  switch (e.type) {
    case "probed": return s.phase === "checking" ? { ...s, phase: e.cached ? "loading" : "absent" } : s;
    case "download": return s.phase === "absent" || s.phase === "paused" || s.phase === "error" ? { ...s, phase: "downloading", error: null } : s;
    // Late progress from an aborted fetch must not un-pause the UI.
    case "progress": return s.phase === "downloading" ? { ...s, progress: e.progress } : s;
    case "paused": return s.phase === "downloading" ? { ...s, phase: s.progress && s.progress.loadedBytes > 0 ? "paused" : "absent" } : s;
    case "installed": return s.phase === "downloading" ? { ...s, phase: "loading", progress: null } : s;
    case "ready": return s.phase === "loading" ? { ...s, phase: "ready", error: null } : s;
    case "failed": return { ...s, phase: "error", error: { kind: e.kind, msg: e.msg } };
    case "removing": return { phase: "checking", progress: null, error: null };
    case "removed": return { phase: "absent", progress: null, error: null };
  }
}

export const percent = (p: DownloadProgress | null): number =>
  p && p.totalBytes > 0 ? Math.min(100, Math.floor((p.loadedBytes / p.totalBytes) * 100)) : 0;
