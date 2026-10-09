import assert from "node:assert/strict";
import { test } from "node:test";
import { exportBackup, importBackup, parseBackup, resetAll } from "../../src/lib/backup.ts";
import { MemoryKv, MemoryStorage } from "./helpers.ts";

const seeded = async () => {
  const ls = new MemoryStorage();
  ls.setItem("paint97.settings.v1", '{"locale":"nl"}');
  ls.setItem("paint97.notepad.v1", "hello");
  ls.setItem("other-app", "keep me");
  const kv = new MemoryKv();
  await kv.set("scene", '{"elements":[]}');
  await kv.set("fs:index", '{"nodes":{}}');
  await kv.set("fs:body:abc", "{}");
  await kv.set("fs:ver:abc:123", "{}");
  await kv.set("stranger", "x");
  return { ls, kv };
};

test("export → JSON → import round-trips every Paint97 record and nothing else", async () => {
  const { ls, kv } = await seeded();
  const file = JSON.stringify(await exportBackup(ls, kv, new Date(0)));
  assert.doesNotMatch(file, /other-app|stranger/);
  const ls2 = new MemoryStorage(), kv2 = new MemoryKv();
  ls2.setItem("paint97.stale", "old"); ls2.setItem("other-app", "theirs");
  await kv2.set("fs:body:old", "old");
  await importBackup(parseBackup(JSON.parse(file)), ls2, kv2);
  assert.equal(ls2.getItem("paint97.notepad.v1"), "hello");
  assert.equal(ls2.getItem("paint97.stale"), null, "import replaces, it does not merge");
  assert.equal(ls2.getItem("other-app"), "theirs", "other apps on the origin are untouched");
  assert.deepEqual(await kv2.keys(""), ["fs:body:abc", "fs:index", "fs:ver:abc:123", "scene"]);
});

test("parseBackup refuses foreign files and drops keys it does not own", () => {
  for (const bad of [null, [], "x", {}, { app: "paint97", version: 2, local: {}, kv: {} }, { app: "paint97", version: 1, local: [], kv: {} }]) assert.throws(() => parseBackup(bad));
  const b = parseBackup({ app: "paint97", version: 1, local: { "paint97.a": "1", "evil": "2", "paint97.n": 5 }, kv: { scene: "s", "fs:body:../x": "y", "__proto__": "z" } });
  assert.deepEqual(b.local, { "paint97.a": "1" });
  assert.deepEqual(Object.keys(b.kv), ["scene"]);
});

test("reset clears Paint97 data only; import fails loudly without storage", async () => {
  const { ls, kv } = await seeded();
  await resetAll(ls, kv);
  assert.equal(ls.getItem("paint97.settings.v1"), null);
  assert.equal(ls.getItem("other-app"), "keep me");
  assert.deepEqual(await kv.keys(""), []);
  await assert.rejects(importBackup(parseBackup({ app: "paint97", version: 1, local: {}, kv: { scene: "s" } }), ls, null), /unavailable/);
});
