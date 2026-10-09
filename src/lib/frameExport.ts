// Framed PNG export — the drawing composited inside a painted Windows-9x
// window (title bar, menu strip, status bar). Everything is Canvas2D
// geometry we own: no html2canvas-style dependency, nothing to rasterise
// from the live DOM, and the layout maths is unit-testable in Node.

export type FrameStrings = {
  /** Title-bar caption. */
  title: string;
  /** Status-bar text. */
  status: string;
  /** Menu-strip labels, left to right. */
  menu: string[];
};

type Rect = { x: number; y: number; width: number; height: number };

export type FrameLayout = {
  width: number;
  height: number;
  /** Drawing area (a `drawImage` target). */
  inner: Rect;
  title: Rect;
  menu: Rect;
  status: Rect;
};

/** Frame geometry in pixels; the e2e suite derives its assertions from it. */
export const FRAME = { border: 3, titleH: 30, menuH: 22, statusH: 24 } as const;

/** Outer canvas size + every panel rect for a drawing of w × h pixels. */
export function computeFrameLayout(drawingW: number, drawingH: number): FrameLayout {
  const w = Math.max(1, Math.round(drawingW));
  const h = Math.max(1, Math.round(drawingH));
  const { border, titleH, menuH, statusH } = FRAME;
  const width = w + border * 2;
  const title: Rect = { x: border, y: border, width: w, height: titleH };
  const menu: Rect = { x: border, y: border + titleH, width: w, height: menuH };
  const inner: Rect = { x: border, y: border + titleH + menuH, width: w, height: h };
  const status: Rect = { x: border, y: inner.y + h, width: w, height: statusH };
  return { width, height: status.y + statusH + border, inner, title, menu, status };
}

const FACE = "#c0c0c0";
const HIGHLIGHT = "#ffffff";
const LIGHT = "#dfdfdf";
const SHADOW = "#808080";
const DARK = "#000000";
const NAVY = "#000080";
const BLUE = "#1084d0";

type Ctx = CanvasRenderingContext2D;

/** Raised Win9x bevel: light top/left, dark bottom/right. */
function raised(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = LIGHT;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = HIGHLIGHT;
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillRect(x + 1, y + 1, 1, h - 2);
  ctx.fillStyle = SHADOW;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = DARK;
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
}

/** Sunken Win9x bevel (status bar, buttons pressed look inverted by caller). */
function sunken(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = SHADOW;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = HIGHLIGHT;
  ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}

/** Truncate with an ellipsis so caption text fits `max` pixels. */
function fitText(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

/**
 * Paint everything except `layout.inner` (the caller `drawImage`s the
 * drawing there afterwards).
 */
export function paintFrame(ctx: Ctx, layout: FrameLayout, s: FrameStrings): void {
  const { titleH, menuH, statusH } = FRAME;
  const { title, menu, inner, status } = layout;

  // Window face + raised outer bevel.
  ctx.fillStyle = FACE;
  ctx.fillRect(0, 0, layout.width, layout.height);
  raised(ctx, 0, 0, layout.width, layout.height);

  // Title bar: navy → blue gradient, white caption, three window buttons.
  const grad = ctx.createLinearGradient(title.x, 0, title.x + title.width, 0);
  grad.addColorStop(0, NAVY);
  grad.addColorStop(1, BLUE);
  ctx.fillStyle = grad;
  ctx.fillRect(title.x, title.y, title.width, title.height);
  ctx.fillStyle = HIGHLIGHT;
  ctx.font = "bold 13px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(fitText(ctx, s.title, title.width - 76), title.x + 8, title.y + titleH / 2);
  const glyphs = ["—", "□", "×"];
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < glyphs.length; i++) {
    const bx = title.x + title.width - 4 - 18 - i * 20;
    const by = title.y + Math.round((titleH - 16) / 2);
    raised(ctx, bx, by, 18, 16);
    ctx.fillStyle = DARK;
    ctx.fillText(glyphs[i] ?? "", bx + 9, by + 8);
  }
  ctx.textAlign = "left";

  // Menu strip: labels on the face, closed by a shadow line at the canvas.
  ctx.fillStyle = DARK;
  ctx.font = "12px sans-serif";
  let mx = menu.x + 6;
  for (const label of s.menu) {
    if (mx > menu.x + menu.width - 40) break;
    ctx.fillText(label, mx, menu.y + menuH / 2);
    mx += ctx.measureText(label).width + 16;
  }
  ctx.fillStyle = SHADOW;
  ctx.fillRect(menu.x, menu.y + menuH - 1, menu.width, 1);

  // Canvas gutters: shadow lines hugging the drawing area.
  ctx.fillStyle = SHADOW;
  ctx.fillRect(inner.x - 1, inner.y, 1, inner.height);
  ctx.fillRect(inner.x + inner.width, inner.y, 1, inner.height);

  // Status bar: face with a sunken field and the caption.
  ctx.fillStyle = FACE;
  ctx.fillRect(status.x, status.y, status.width, status.height);
  sunken(ctx, status.x, status.y, status.width, status.height);
  ctx.fillStyle = DARK;
  ctx.font = "12px sans-serif";
  ctx.fillText(
    fitText(ctx, s.status, status.width - 12),
    status.x + 6,
    status.y + statusH / 2,
    status.width - 12,
  );
}
