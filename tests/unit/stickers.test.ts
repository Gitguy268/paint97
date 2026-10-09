// Unit tests for src/lib/stickers.ts — the palette is display-only data
// (emoji + labels rendered into the Stickers menu), so the contract is:
// tidy, unique entries that render as predictable menu labels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STICKERS } from "../../src/lib/stickers.ts";

test("the palette is stocked with unique glyphs and names", () => {
  const glyphs = STICKERS.map((s) => s.glyph);
  const names = STICKERS.map((s) => s.name);
  assert.ok(STICKERS.length >= 8, "palette should offer at least eight stickers");
  assert.equal(new Set(glyphs).size, glyphs.length, "duplicate glyphs");
  assert.equal(new Set(names).size, names.length, "duplicate names");
});

test("sticker entries are tidy and safe as menu labels", () => {
  for (const s of STICKERS) {
    assert.ok(s.glyph.length > 0 && s.glyph.length <= 8, `odd glyph length for ${s.name}`);
    assert.ok(!/\s/.test(s.glyph), `glyph contains whitespace: ${s.glyph}`);
    assert.equal(s.name, s.name.trim(), `untrimmed name: ${s.name}`);
    assert.ok(s.name.length > 0 && s.name.length <= 20, `odd name length: ${s.name}`);
    assert.ok(!/[<>]/.test(s.name), `markup in name: ${s.name}`);
  }
});
