// Persisted user settings. `sanitizeSettings` is the single trust boundary for
// stored / imported JSON: unknown keys drop, bad values fall back to defaults.
import { createStore } from "./store.ts";
import { WALLPAPERS, type WallpaperId } from "./wallpapers.ts";

export type Locale = "en" | "nl";
export type Personality = "classic" | "concise" | "hype";
export type MotionPref = "system" | "reduce" | "full";

export type Settings = {
  locale: Locale;
  wallpaper: WallpaperId;
  volume: number; // 0..1
  muted: boolean;
  glass: boolean;
  clippyOn: boolean;
  personality: Personality;
  clippyScale: 1 | 2 | 3 | 4;
  motion: MotionPref;
};

export const DEFAULT_SETTINGS: Settings = {
  locale: "en",
  wallpaper: "auto",
  volume: 0.6,
  muted: false,
  glass: false,
  clippyOn: true,
  personality: "classic",
  clippyScale: 2,
  motion: "system",
};

export const SETTINGS_KEY = "paint97.settings.v1";
const pick = <T extends string>(v: unknown, ok: readonly T[], fb: T): T => (ok.includes(v as T) ? (v as T) : fb);

export function sanitizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const vol = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume;
  return {
    locale: pick(r.locale, ["en", "nl"], d.locale),
    wallpaper: pick(r.wallpaper, WALLPAPERS.map((w) => w.id), d.wallpaper),
    volume: vol,
    muted: typeof r.muted === "boolean" ? r.muted : d.muted,
    glass: typeof r.glass === "boolean" ? r.glass : d.glass,
    clippyOn: typeof r.clippyOn === "boolean" ? r.clippyOn : d.clippyOn,
    personality: pick(r.personality, ["classic", "concise", "hype"], d.personality),
    clippyScale: ([1, 2, 3, 4] as const).find((n) => n === r.clippyScale) ?? d.clippyScale,
    motion: pick(r.motion, ["system", "reduce", "full"], d.motion),
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settings = createStore<Settings>(typeof localStorage === "undefined" ? DEFAULT_SETTINGS : load());
settings.subscribe(() => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.get())); } catch { /* blocked storage: non-fatal */ }
});
export const updateSettings = (patch: Partial<Settings>) => settings.set((s) => sanitizeSettings({ ...s, ...patch }));

/** Effective reduced-motion: explicit setting wins over the OS preference. */
export const prefersReducedMotion = (s: Settings = settings.get()): boolean =>
  s.motion === "reduce" || (s.motion === "system" && typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
