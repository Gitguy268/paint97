// Desktop wallpapers for Paint97.
//
// Every entry is a pure CSS `background` value — gradients and solid colours
// only, no image files — so the picker adds no assets, no network requests
// and no CSP surface. "auto" applies no inline style and defers to the
// stylesheet: Windows teal in Classic mode, the night gradient in Midnight
// mode.

export type WallpaperId = "auto" | "teal" | "midnight" | "clouds" | "sunset" | "grid";

export type Wallpaper = { id: WallpaperId; label: string; css: string };

/** "auto": no inline style — the stylesheet's theme-aware default. */
export const DEFAULT_WALLPAPER: Wallpaper = { id: "auto", label: "Default", css: "" };

/** The stylesheet's Windows-teal desktop (also the "auto" swatch preview). */
export const TEAL_CSS =
  "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.06) 0 2px, transparent 3px), " +
  "radial-gradient(circle at 70% 60%, rgba(255,255,255,0.05) 0 2px, transparent 3px), #008080";

export const WALLPAPERS: readonly Wallpaper[] = [
  DEFAULT_WALLPAPER,
  { id: "teal", label: "Windows Teal", css: TEAL_CSS },
  { id: "midnight", label: "Midnight", css: "linear-gradient(180deg, #060618 0%, #101038 60%, #0a0a2a 100%)" },
  {
    id: "clouds",
    label: "Clouds",
    css:
      "radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.85) 0 9%, transparent 26%), " +
      "radial-gradient(ellipse at 68% 45%, rgba(255,255,255,0.75) 0 11%, transparent 30%), " +
      "radial-gradient(ellipse at 45% 70%, rgba(255,255,255,0.6) 0 9%, transparent 27%), " +
      "linear-gradient(180deg, #6aaee0 0%, #a8d2f0 100%)",
  },
  { id: "sunset", label: "Sunset", css: "linear-gradient(180deg, #1c1c4c 0%, #c84b78 55%, #f0a04b 100%)" },
  {
    id: "grid",
    label: "Grid",
    css:
      "repeating-linear-gradient(0deg, rgba(0,255,255,0.15) 0 1px, transparent 1px 32px), " +
      "repeating-linear-gradient(90deg, rgba(0,255,255,0.15) 0 1px, transparent 1px 32px), " +
      "linear-gradient(180deg, #0a1f3d, #061428)",
  },
];

/** Unknown ids fall back to the stylesheet default. */
export const wallpaperById = (id: string): Wallpaper =>
  WALLPAPERS.find((w) => w.id === id) ?? DEFAULT_WALLPAPER;

const LS_KEY = "paint97.wallpaper";

export function loadWallpaper(): WallpaperId {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw !== null && WALLPAPERS.some((w) => w.id === raw) ? (raw as WallpaperId) : "auto";
  } catch {
    return "auto";
  }
}

export function saveWallpaper(id: WallpaperId): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* storage full/blocked — non-fatal */
  }
}
