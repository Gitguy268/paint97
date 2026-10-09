import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../../src/lib/settings.ts";

test("garbage falls back to defaults", () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings([1]), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ locale: "fr", volume: "loud", clippyScale: 9, wallpaper: "nope" }), DEFAULT_SETTINGS);
});
test("valid values survive; volume clamps; unknown keys drop", () => {
  const s = sanitizeSettings({ locale: "nl", volume: 7, clippyScale: 3, glass: true, extra: 1 });
  assert.equal(s.locale, "nl");
  assert.equal(s.volume, 1);
  assert.equal(s.clippyScale, 3);
  assert.equal(s.glass, true);
  assert.ok(!("extra" in s));
});
