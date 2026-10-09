// Tip copy for the Clippy assistant — original text in the voice of a
// certain 90s office helper, shipped as interchangeable personality packs.
// Idle tips rotate on click; context tips fire when the user saves,
// exports, or opens Help. Every pack keeps the same shape (greeting +
// rotation pools) so Clippy can hot-swap voices without touching the engine.

export type TipContext = "save" | "export" | "help";
export type TipPackId = "classic" | "concise" | "hype";

export type TipPack = {
  id: TipPackId;
  label: string;
  blurb: string;
  greeting: string;
  idle: string[];
  context: Record<TipContext, string[]>;
};

const CLASSIC: TipPack = {
  id: "classic",
  label: "Classic office helper",
  blurb: "The original 90s office voice.",
  greeting:
    "Hi! I'm Clippy, your Paint97 assistant. I'll be down here if you need drawing tips — just click me!",
  idle: [
    "It looks like you're drawing a diagram. Rectangles love arrows — grab the arrow tool and drag from one shape to another to connect them!",
    "Double-click any shape to type text inside it. Shapes with labels look 40% more professional. Probably.",
    "Pan with space-drag or middle-mouse. Zoom with Ctrl+wheel. The canvas is infinite — I checked.",
    "Press Ctrl+Z to undo. Even assistants make mistakes. Not me, though.",
    "File → Save As… stores your drawing as .excalidraw JSON. It also autosaves in this browser every few keystrokes.",
    "Pick the eraser, or select any object and press Delete. Poof. Gone. Very satisfying.",
    "Export PNG for sharing, SVG for infinite sharpness. SVG never gets pixelated — unlike yours truly, who is pixelated on purpose.",
    "Working late? The Start menu has 🌙 Midnight mode for your drawing eyes.",
  ],
  context: {
    save: [
      "Nice save! That .excalidraw file holds every object — reopen it anytime with File → Open…",
      "Saved! Your masterpiece is now a JSON file. Future historians will thank you.",
    ],
    export: [
      "Exported! PNG is perfect for pasting into documents. Need razor-sharp lines? Try the SVG tab instead.",
      "Fresh export, hot off the canvas! I supervised the pixels personally.",
    ],
    help: [
      "Help Topics lists every shortcut. My personal favorite is Ctrl+Z — the 'pretend that never happened' button.",
      "Reading the manual? Bold move. The arrow tool plus double-click-to-label covers 90% of diagramming.",
    ],
  },
};

const CONCISE: TipPack = {
  id: "concise",
  label: "No-nonsense",
  blurb: "Short, direct, no fluff.",
  greeting: "Clippy here. Click me for a tip.",
  idle: [
    "Ctrl+Z undoes. Ctrl+Y redoes. That's most of it.",
    "Double-click a shape to add text — faster than a label tool.",
    "Space-drag pans. Ctrl+wheel zooms.",
    "File → Save As… exports .excalidraw. It also autosaves locally.",
    "PNG to share, SVG to scale.",
    "Select an object and press Delete to remove it.",
    "The Start menu has Midnight mode if the white hurts.",
  ],
  context: {
    save: ["Saved. It's in your downloads folder.", "Done — .excalidraw JSON, reopen anytime."],
    export: ["Exported.", "PNG for documents, SVG for print."],
    help: ["Every shortcut is in Help Topics.", "Arrow tool plus double-click labels covers most diagrams."],
  },
};

const HYPE: TipPack = {
  id: "hype",
  label: "Hype mode",
  blurb: "Relentless encouragement.",
  greeting: "YES. Paint97. You're about to make something INCREDIBLE and I'm going to watch the whole time!",
  idle: [
    "That's a GREAT rectangle. The world needs more rectangles!",
    "Ctrl+Z? I call it Ctrl+UNLEASH! Undo fearlessly!",
    "You just zoomed. Precision! Vision! This is why you're the artist!",
    "Save that drawing — future you is going to be SO grateful!",
    "An infinite canvas for infinite ambition. LET'S GO!",
    "Export PNG or SVG? Either way that's going in the group chat!",
    "Midnight mode for late sessions? Discipline AND talent!",
  ],
  context: {
    save: [
      "SAVED! That's a keeper! Frame it! Print it! Ship it!",
      "Autosave is on too, because greatness shouldn't be lost to a closed tab!",
    ],
    export: ["EXPORTED! Paste it EVERYWHERE it deserves to be!", "PNG or SVG — either way, professional-grade!"],
    help: ["Reading Help? Ambition AND diligence. You're unstoppable!", "Shortcuts in Help Topics — Ctrl+Z alone is worth the trip!"],
  },
};

export const TIP_PACKS: readonly TipPack[] = [CLASSIC, CONCISE, HYPE];
export const DEFAULT_TIP_PACK = CLASSIC;

/** Unknown ids fall back to the classic pack. */
export const tipPackById = (id: string): TipPack =>
  TIP_PACKS.find((p) => p.id === id) ?? DEFAULT_TIP_PACK;

const LS_KEY = "paint97.tipspack";

export function loadTipPack(): TipPackId {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw !== null && TIP_PACKS.some((p) => p.id === raw) ? (raw as TipPackId) : "classic";
  } catch {
    return "classic";
  }
}

export function saveTipPack(id: TipPackId): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* storage full/blocked — non-fatal */
  }
}
