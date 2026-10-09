// Unit tests for src/lib/wallpapers.ts — the picker promises pure-CSS
// backgrounds (no assets, no network, no CSP surface) and a localStorage
// choice that degrades safely when storage is blocked or holds junk.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { installStorage } from "./helpers.ts";
import { DEFAULT_WALLPAPER, TEAL_CSS, WALLPAPERS, loadWallpaper, saveWallpaper, wallpaperById } from "../../src/lib/wallpapers.ts";

let store: ReturnType<typeof installStorage>;
beforeEach(() => {
  store = installStorage();
});

test("wallpaper ids are unique and every label is present", () => {
  const ids = WALLPAPERS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate wallpaper ids");
  for (const w of WALLPAPERS) assert.ok(w.label.length > 0, `empty label for ${w.id}`);
});

test("only 'auto' defers to the stylesheet; the rest carry a background", () => {
  for (const w of WALLPAPERS) {
    if (w.id === "auto") assert.equal(w.css, "", "auto must not set an inline background");
    else assert.ok(w.css.trim().length > 0, `${w.id} has no background`);
  }
  assert.equal(DEFAULT_WALLPAPER.id, "auto");
});

test("backgrounds are pure CSS — no url(), no data URIs, no scripts", () => {
  for (const w of WALLPAPERS) {
    const css = w.css.toLowerCase();
    assert.ok(!css.includes("url("), `${w.id} loads an external asset`);
    assert.ok(!css.includes("data:"), `${w.id} embeds a data URI`);
    assert.ok(!css.includes("javascript:"), `${w.id} carries script`);
  }
  assert.ok(TEAL_CSS.includes("#008080"), "teal swatch should be Windows teal");
});

test("wallpaperById resolves known ids and falls back to the default", () => {
  assert.equal(wallpaperById("clouds").id, "clouds");
  assert.equal(wallpaperById("auto").id, "auto");
  assert.equal(wallpaperById("nope").id, "auto");
  assert.equal(wallpaperById("").id, "auto");
});

test("save/load round-trips a wallpaper id", () => {
  saveWallpaper("sunset");
  assert.equal(loadWallpaper(), "sunset");
});

test("missing or invalid stored values load as the default", () => {
  assert.equal(loadWallpaper(), "auto");
  localStorage.setItem("paint97.wallpaper", "1998");
  assert.equal(loadWallpaper(), "auto");
});

test("blocked storage degrades to the default without throwing", () => {
  store.fail = true;
  assert.equal(loadWallpaper(), "auto");
  assert.doesNotThrow(() => saveWallpaper("grid"));
});
