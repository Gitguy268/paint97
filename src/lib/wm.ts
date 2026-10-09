// Pure window-manager logic. State is an array whose order IS the z-order
// (last = topmost). Everything returns a new state; no DOM, no timers.
export type Rect = { x: number; y: number; w: number; h: number };
export type Mode = "normal" | "min" | "max";
export type Props = Readonly<Record<string, string>>;
export type WinState = {
  id: string;
  appId: string;
  /** App-supplied title override (e.g. "note.txt - Notepad"); null = app default. */
  title: string | null;
  rect: Rect;
  mode: Mode;
  /** Rect to return to after maximize/snap. */
  restore: Rect | null;
  /** Mode a minimised window returns to. */
  minFrom: "normal" | "max";
  props: Props;
};
export type Wm = { wins: readonly WinState[]; seq: number };
export type OpenSpec = { appId: string; size: { w: number; h: number }; singleton: boolean };
export type SnapZone = "left" | "right" | "max";

export const MIN_W = 220;
export const MIN_H = 120;
export const EMPTY_WM: Wm = { wins: [], seq: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const map = (wm: Wm, id: string, fn: (w: WinState) => WinState): Wm => ({
  ...wm,
  wins: wm.wins.map((w) => (w.id === id ? fn(w) : w)),
});
const toTop = (wm: Wm, id: string): Wm => {
  const w = wm.wins.find((x) => x.id === id);
  return w ? { ...wm, wins: [...wm.wins.filter((x) => x.id !== id), w] } : wm;
};

/** Topmost visible window = the focused one. */
export const focusedId = (wm: Wm): string | null =>
  [...wm.wins].reverse().find((w) => w.mode !== "min")?.id ?? null;

/** Most-recently-used first (for Alt+Tab). */
export const mruOrder = (wm: Wm): string[] => [...wm.wins].reverse().map((w) => w.id);

export function focus(wm: Wm, id: string): Wm {
  if (!wm.wins.some((w) => w.id === id)) return wm;
  return toTop(map(wm, id, (w) => (w.mode === "min" ? { ...w, mode: w.minFrom } : w)), id);
}

export function open(wm: Wm, spec: OpenSpec, props: Props, area: Rect): Wm {
  if (spec.singleton) {
    const existing = wm.wins.find((w) => w.appId === spec.appId);
    if (existing) return focus({ ...wm, wins: wm.wins.map((w) => (w.id === existing.id ? { ...w, props: { ...w.props, ...props } } : w)) }, existing.id);
  }
  const seq = wm.seq + 1;
  const w = Math.min(spec.size.w, area.w);
  const h = Math.min(spec.size.h, area.h);
  const step = ((seq - 1) % 8) * 28;
  const win: WinState = {
    id: `${spec.appId}#${seq}`,
    appId: spec.appId,
    title: null,
    rect: { x: clamp(area.x + 60 + step, area.x, Math.max(area.x, area.x + area.w - w)), y: clamp(area.y + 30 + step, area.y, Math.max(area.y, area.y + area.h - h)), w, h },
    mode: "normal",
    restore: null,
    minFrom: "normal",
    props,
  };
  return { wins: [...wm.wins, win], seq };
}

export const close = (wm: Wm, id: string): Wm => ({ ...wm, wins: wm.wins.filter((w) => w.id !== id) });
export const setTitle = (wm: Wm, id: string, title: string | null): Wm => map(wm, id, (w) => (w.title === title ? w : { ...w, title }));

export function minimize(wm: Wm, id: string): Wm {
  // Sink to the bottom so the next window becomes the focused (topmost visible) one.
  const w = wm.wins.find((x) => x.id === id);
  if (!w) return wm;
  const m: WinState = { ...w, mode: "min", minFrom: w.mode === "max" ? "max" : "normal" };
  return { ...wm, wins: [m, ...wm.wins.filter((x) => x.id !== id)] };
}

export function toggleMax(wm: Wm, id: string, area: Rect): Wm {
  return toTop(
    map(wm, id, (w) =>
      w.mode === "max"
        ? { ...w, mode: "normal", rect: w.restore ?? w.rect, restore: null }
        : { ...w, mode: "max", restore: w.rect, rect: area },
    ),
    id,
  );
}

/** Taskbar button semantics: focused → minimise; otherwise raise/restore. */
export const taskbarClick = (wm: Wm, id: string): Wm => (focusedId(wm) === id ? minimize(wm, id) : focus(wm, id));

/** Keep at least a grab strip of the title bar inside the work area. */
export function move(wm: Wm, id: string, x: number, y: number, area: Rect): Wm {
  return map(wm, id, (w) =>
    w.mode === "max"
      ? w
      : { ...w, rect: { ...w.rect, x: clamp(x, area.x - w.rect.w + 80, area.x + area.w - 80), y: clamp(y, area.y, area.y + area.h - 24) } },
  );
}

export function resize(wm: Wm, id: string, r: Rect): Wm {
  return map(wm, id, (w) => (w.mode === "max" ? w : { ...w, rect: { x: r.x, y: r.y, w: Math.max(MIN_W, r.w), h: Math.max(MIN_H, r.h) } }));
}

/** Pointer on a screen edge while dragging → snap target. */
export function snapZone(px: number, py: number, area: Rect): SnapZone | null {
  if (py <= area.y) return "max";
  if (px <= area.x) return "left";
  if (px >= area.x + area.w - 1) return "right";
  return null;
}

export function snap(wm: Wm, id: string, zone: SnapZone, area: Rect): Wm {
  if (zone === "max") return toggleMaxTo(wm, id, area);
  const half = Math.floor(area.w / 2);
  const rect: Rect = zone === "left" ? { x: area.x, y: area.y, w: half, h: area.h } : { x: area.x + half, y: area.y, w: area.w - half, h: area.h };
  return map(wm, id, (w) => ({ ...w, mode: "normal", restore: w.restore ?? w.rect, rect }));
}
const toggleMaxTo = (wm: Wm, id: string, area: Rect): Wm => {
  const w = wm.wins.find((x) => x.id === id);
  return w && w.mode !== "max" ? toggleMax(wm, id, area) : wm;
};

/** Keep maximised windows glued to the work area when the viewport changes. */
export const fitMaximized = (wm: Wm, area: Rect): Wm => ({ ...wm, wins: wm.wins.map((w) => (w.mode === "max" ? { ...w, rect: area } : w)) });

// ---- persistence (validated: stored layout is untrusted input) ----
const isRect = (r: unknown): r is Rect => {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k]));
};
export function parseWm(raw: unknown, knownApps: (id: string) => boolean): Wm {
  if (!raw || typeof raw !== "object") return EMPTY_WM;
  const rec = raw as { wins?: unknown; seq?: unknown };
  if (!Array.isArray(rec.wins) || typeof rec.seq !== "number") return EMPTY_WM;
  const wins: WinState[] = [];
  for (const w of rec.wins.slice(0, 32) as Record<string, unknown>[]) {
    if (!w || typeof w.id !== "string" || typeof w.appId !== "string" || !knownApps(w.appId) || !isRect(w.rect)) continue;
    const mode = w.mode === "min" || w.mode === "max" ? w.mode : "normal";
    const props: Record<string, string> = {};
    if (w.props && typeof w.props === "object") for (const [k, v] of Object.entries(w.props)) if (typeof v === "string") props[k] = v;
    wins.push({ id: w.id, appId: w.appId, title: null, rect: w.rect, mode, restore: isRect(w.restore) ? w.restore : null, minFrom: w.minFrom === "max" ? "max" : "normal", props });
  }
  return { wins, seq: Math.max(rec.seq, 0) };
}
