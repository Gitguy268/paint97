// Unit tests for src/lib/idb.ts — the open/operation timeouts exist so a
// wedged browser storage can never pin the boot overlay, and a missing
// IndexedDB (Node) must degrade to null instead of throwing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openSceneStore, withTimeout } from "../../src/lib/idb.ts";

test("withTimeout resolves when the promise settles in time", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 100), "ok");
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 100), /boom/);
});

test("withTimeout rejects instead of waiting forever on a hung operation", async () => {
  const hung = new Promise<never>(() => { /* deliberately never settles */ });
  await assert.rejects(withTimeout(hung, 10), /storage timeout/);
});

test("openSceneStore resolves null where IndexedDB does not exist", async () => {
  assert.equal(await openSceneStore(), null);
});
