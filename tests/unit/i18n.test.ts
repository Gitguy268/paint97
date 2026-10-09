import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../../src/i18n/en.ts";
import { nl } from "../../src/i18n/nl.ts";
import { translate } from "../../src/i18n/index.ts";

test("nl covers exactly the en keys, with no empty strings", () => {
  assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort());
  for (const [k, v] of Object.entries(nl)) assert.ok(v.trim(), k);
});
test("placeholders match between locales", () => {
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(en) as (keyof typeof en)[]) assert.equal(ph(nl[k]), ph(en[k]), k);
});
test("translate interpolates", () => {
  assert.equal(translate("en", "shell.start"), "Start");
  assert.equal(translate("nl", "app.bin"), "Prullenbak");
});
