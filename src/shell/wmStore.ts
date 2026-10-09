// The single window-manager store. Pure transitions live in lib/wm.ts.
import { appById } from "../apps/registry.ts";
import { createStore } from "../lib/store.ts";
import * as W from "../lib/wm.ts";

export const TASKBAR_H = 30;
const LS_KEY = "paint97.wm.v1";

export const workArea = (): W.Rect => ({ x: 0, y: 0, w: window.innerWidth, h: Math.max(0, window.innerHeight - TASKBAR_H) });

function load(): W.Wm {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? W.parseWm(JSON.parse(raw), (id) => !!appById(id)) : W.EMPTY_WM;
  } catch { return W.EMPTY_WM; }
}

export const wm = createStore<W.Wm>(load());

let timer: ReturnType<typeof setTimeout> | undefined;
wm.subscribe(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(wm.get())); } catch { /* non-fatal */ }
  }, 250);
});

const apply = (fn: (s: W.Wm) => W.Wm) => wm.set(fn);

export const actions = {
  open(appId: string, props: W.Props = {}) {
    const def = appById(appId);
    if (def) apply((s) => W.open(s, { appId, size: def.size, singleton: def.singleton }, props, workArea()));
  },
  focus: (id: string) => apply((s) => W.focus(s, id)),
  close: (id: string) => apply((s) => W.close(s, id)),
  minimize: (id: string) => apply((s) => W.minimize(s, id)),
  toggleMax: (id: string) => apply((s) => W.toggleMax(s, id, workArea())),
  taskbar: (id: string) => apply((s) => W.taskbarClick(s, id)),
  move: (id: string, x: number, y: number) => apply((s) => W.move(s, id, x, y, workArea())),
  resize: (id: string, r: W.Rect) => apply((s) => W.resize(s, id, r)),
  /** Resize in place (apps that hug their content). */
  setSize: (id: string, w: number, h: number) => apply((s) => { const r = s.wins.find((x) => x.id === id)?.rect; return r && (r.w !== w || r.h !== h) ? W.resize(s, id, { ...r, w, h }) : s; }),
  snap: (id: string, z: W.SnapZone) => apply((s) => W.snap(s, id, z, workArea())),
  setTitle: (id: string, title: string | null) => apply((s) => W.setTitle(s, id, title)),
  fit: () => apply((s) => W.fitMaximized(s, workArea())),
};
