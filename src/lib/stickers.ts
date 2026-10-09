// Sticker palette for Paint97 — emoji placed on the canvas as Excalidraw
// text elements. Emoji glyphs render from the OS emoji font, so the palette
// needs no image files, no font downloads and no CSP surface.

export type Sticker = { glyph: string; name: string };

export const STICKERS: readonly Sticker[] = [
  { glyph: "⭐", name: "Star" },
  { glyph: "🌈", name: "Rainbow" },
  { glyph: "🔥", name: "Flame" },
  { glyph: "💡", name: "Idea" },
  { glyph: "🎯", name: "Target" },
  { glyph: "🎉", name: "Party" },
  { glyph: "💎", name: "Gem" },
  { glyph: "🚀", name: "Rocket" },
  { glyph: "🌻", name: "Sunflower" },
  { glyph: "☕", name: "Coffee" },
  { glyph: "🎈", name: "Balloon" },
  { glyph: "❤️", name: "Heart" },
];
