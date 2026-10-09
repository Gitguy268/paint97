// Tip copy for Clippy: original text in three interchangeable personalities.
// Every pack has the same shape, so the assistant swaps voices without touching the engine.
// The copy is English only; UI chrome is translated, the assistant's voice is not (see docs/DESIGN.md).
import type { ClippyEvent } from "./bus.ts";

export type TipContext = "save" | "export" | "help" | "empty" | "error" | "idle";
export type TipPackId = "classic" | "concise" | "hype";

export type TipPack = {
  id: TipPackId;
  greeting: string;
  /** Click-for-a-tip rotation; also the tip-of-the-day pool. */
  tips: readonly string[];
  context: Readonly<Record<TipContext, readonly string[]>>;
  /** Said the first time a tool is picked up, keyed by Excalidraw tool id. */
  tools: Readonly<Record<string, string>>;
};

const CLASSIC: TipPack = {
  id: "classic",
  greeting: "Hi! I'm Clippy, your Paint97 assistant. Click me any time for a drawing tip!",
  tips: [
    "It looks like you're drawing a diagram. Rectangles love arrows: drag an arrow from one shape to another to connect them!",
    "Double-click any shape to type text inside it. Shapes with labels look 40% more professional. Probably.",
    "Pan with space-drag or the hand tool. Zoom with Ctrl+wheel; the status bar shows the zoom level. The canvas is infinite. I checked.",
    "Press Ctrl+Z to undo. Even assistants make mistakes. Not me, though.",
    "Ctrl+S saves into My Drawings, and every save keeps a previous version you can go back to.",
    "Pick the eraser, or select any object and press Delete. Poof. Gone. Very satisfying.",
    "Export PNG for sharing, SVG for infinite sharpness. SVG never gets pixelated, unlike yours truly, who is pixelated on purpose.",
    "Alt+Tab switches windows, just like the real thing. If your browser eats it, Alt+` works too.",
    "File → Copy share link packs the whole drawing into a URL. No server involved; I'd know.",
    "Working late? The Control Panel has a Midnight wallpaper for your drawing eyes.",
  ],
  context: {
    save: ["Nice save! It's in My Drawings, with a previous version kept just in case.", "Saved! Future historians will thank you."],
    export: ["Exported! PNG is perfect for documents. Need razor-sharp lines? Try SVG.", "Fresh export, hot off the canvas! I supervised the pixels personally."],
    help: ["Help lists every shortcut. My personal favourite is Ctrl+Z, the 'pretend that never happened' button.", "Reading the manual? Bold move."],
    empty: ["A blank canvas! It looks like you're about to draw something. Start with a rectangle; they're very forgiving.", "All clean. Ctrl+Z brings it back if that was a mistake."],
    error: ["Uh-oh. That didn't work. Your drawing is still here; try once more, or save it as a file to be safe.", "Something went wrong, and for once it wasn't me."],
    idle: ["Still there? I've been practising my eyebrow raise.", "It looks like you're thinking. Take your time; I'll hold the paperclips."],
  },
  tools: {
    freedraw: "The pencil! Draw freely. Hold Shift for straighter confidence.",
    arrow: "Arrows snap onto shapes. Start on one, end on another, and they stay attached when you move things.",
    text: "Click anywhere and type. Double-clicking a shape puts the text inside it instead.",
    eraser: "The eraser removes whole objects, not pixels. Drag across anything you regret.",
    rectangle: "Rectangles: the backbone of every flowchart. Hold Shift for a perfect square.",
    ellipse: "Hold Shift while dragging for a perfect circle.",
    diamond: "Diamonds mean decisions. Yes goes one way, No goes the other.",
    line: "Click, click, click for a multi-point line. Press Escape to finish.",
  },
};

const CONCISE: TipPack = {
  id: "concise",
  greeting: "Clippy here. Click me for a tip.",
  tips: [
    "Ctrl+Z undoes. Ctrl+Y redoes.",
    "Double-click a shape to add text.",
    "Space-drag pans. Ctrl+wheel zooms.",
    "Ctrl+S saves to My Drawings and keeps a version.",
    "PNG to share, SVG to scale.",
    "Select an object and press Delete to remove it.",
    "Alt+Tab or Alt+` switches windows.",
    "File → Copy share link: the drawing in a URL.",
  ],
  context: {
    save: ["Saved to My Drawings.", "Saved. Previous version kept."],
    export: ["Exported.", "PNG for documents, SVG for print."],
    help: ["Shortcuts are in Help.", "Arrow tool plus double-click labels covers most diagrams."],
    empty: ["Canvas cleared. Ctrl+Z undoes.", "Empty canvas."],
    error: ["That failed. Your drawing is intact.", "Error. Try again or save a file copy."],
    idle: ["Idle.", "Still here."],
  },
  tools: {
    freedraw: "Pencil. Shift straightens.",
    arrow: "Arrows bind to shapes.",
    text: "Click and type.",
    eraser: "Erases whole objects.",
    rectangle: "Shift for a square.",
    ellipse: "Shift for a circle.",
  },
};

const HYPE: TipPack = {
  id: "hype",
  greeting: "YES. Paint97. You're about to make something INCREDIBLE and I'm going to watch the whole time!",
  tips: [
    "That's a GREAT rectangle. The world needs more rectangles!",
    "Ctrl+Z? I call it Ctrl+UNLEASH! Undo fearlessly!",
    "Ctrl+wheel to zoom. Precision! Vision! This is why you're the artist!",
    "Ctrl+S that drawing! Future you is going to be SO grateful!",
    "An infinite canvas for infinite ambition. LET'S GO!",
    "Export PNG or SVG? Either way that's going in the group chat!",
    "Share links! Your whole drawing in ONE URL! Unreal!",
    "Alt+Tab like a PRO. Windows everywhere. You're running this desktop!",
  ],
  context: {
    save: ["SAVED! That's a keeper! Frame it! Print it! Ship it!", "Saved AND versioned, because greatness deserves a backup!"],
    export: ["EXPORTED! Paste it EVERYWHERE it deserves to be!", "PNG or SVG, either way: professional-grade!"],
    help: ["Reading Help? Ambition AND diligence. You're unstoppable!", "Shortcuts! Ctrl+Z alone is worth the trip!"],
    empty: ["A FRESH canvas! Pure potential! Go go go!", "Clean slate! The next one's going to be even BETTER!"],
    error: ["A setback! Champions get those! Your drawing is safe, try again!", "That didn't work, but YOU still do!"],
    idle: ["Taking a moment? Legends plan before they draw!", "I believe in whatever you're about to do!"],
  },
  tools: {
    freedraw: "The PENCIL! Raw talent, straight onto the canvas!",
    arrow: "ARROWS! Direction! Purpose! Momentum!",
    text: "WORDS! Tell them what it all means!",
    eraser: "The eraser! Editing is a SUPERPOWER!",
    rectangle: "RECTANGLE TIME! The foundation of every great diagram!",
  },
};

export const TIP_PACKS: readonly TipPack[] = [CLASSIC, CONCISE, HYPE];
/** Unknown ids fall back to the classic pack. */
export const tipPackById = (id: string): TipPack => TIP_PACKS.find((p) => p.id === id) ?? CLASSIC;

// ---- which tip, when (pure: the caller supplies the clock and the dice) ----
/** Minimum quiet time between unprompted tips, so tool-switching never turns into a lecture. */
export const TIP_COOLDOWN_MS = 20_000;
export const LONG_IDLE_MS = 90_000;
export type TipState = { lastAt: number; seenTools: readonly string[]; next: number };
export const TIP_STATE0: TipState = { lastAt: -Infinity, seenTools: [], next: 0 };
export type Tip = { text: string; anim: string };

const ANIM: Record<TipContext | "tool" | "click", readonly string[]> = {
  save: ["Save", "Congratulate"], export: ["Print", "SendMail", "GetArtsy"], help: ["Explain", "Searching"],
  empty: ["GetArtsy", "LookDown"], error: ["Alert", "GetAttention"], idle: ["IdleSnooze", "Thinking"],
  tool: ["GestureLeft", "GetTechy", "CheckingSomething"], click: ["GetAttention", "Wave", "GetWizardy", "Explain", "GestureUp"],
};
const pickOf = <T,>(list: readonly T[], rnd: number): T | undefined => list[Math.min(list.length - 1, Math.floor(rnd * list.length))];

/**
 * Decide whether an app event deserves a balloon. Explicit actions (save, export,
 * help, errors) always get one; ambient ones (tool, empty, idle) respect the cooldown,
 * and each tool is explained once.
 */
export function tipFor(pack: TipPack, e: ClippyEvent, state: TipState, now: number, rnd: number): { tip: Tip; state: TipState } | null {
  const ambient = e.kind === "tool" || e.kind === "empty" || e.kind === "idle";
  if (ambient && now - state.lastAt < TIP_COOLDOWN_MS) return null;
  let text: string | undefined;
  let seenTools = state.seenTools;
  if (e.kind === "tool") {
    if (seenTools.includes(e.tool)) return null;
    text = pack.tools[e.tool];
    if (text) seenTools = [...seenTools, e.tool];
  } else text = pickOf(pack.context[e.kind], rnd);
  if (!text) return null;
  return { tip: { text, anim: pickOf(ANIM[e.kind], rnd) ?? "GetAttention" }, state: { ...state, lastAt: now, seenTools } };
}

/** Clicking Clippy walks the tip list in order. */
export function nextTip(pack: TipPack, state: TipState, now: number): { tip: Tip; state: TipState } {
  const text = pack.tips[state.next % pack.tips.length] ?? pack.greeting;
  return { tip: { text, anim: ANIM.click[state.next % ANIM.click.length] ?? "Wave" }, state: { ...state, next: state.next + 1, lastAt: now } };
}

const DAY_MS = 86_400_000;
export const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
/** Same tip all day, a different one tomorrow. */
export function tipOfTheDay(pack: TipPack, d: Date): string {
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  return pack.tips[day % pack.tips.length] ?? pack.greeting;
}
