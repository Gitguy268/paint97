// Unit tests for src/lib/storage.ts — filename slugging and scene
// validation are security-relevant (path traversal, oversized/hostile files)
// and must hold without a browser; the scene store covers the IndexedDB
// path, the legacy localStorage fallback and the migration between them.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MemoryKv, installStorage } from "./helpers.ts";
import { LS_KEY, clearScene, loadLocal, loadScene, readSceneFile, saveScene, slugFilename } from "../../src/lib/storage.ts";

let store: ReturnType<typeof installStorage>;
beforeEach(() => {
  store = installStorage();
});

const fileOf = (text: string): File => new File([text], "scene.excalidraw");
const legacyRecord = (elements: object[], appState: object = {}) =>
  store.setItem(LS_KEY, JSON.stringify({ elements, appState }));

test("slugFilename keeps names safe and sane", () => {
  assert.equal(slugFilename("My Drawing", ".excalidraw"), "My Drawing.excalidraw");
  assert.equal(slugFilename("art.excalidraw", ".excalidraw"), "art.excalidraw"); // no double suffix
  assert.equal(slugFilename("ART.EXCALIDRAW", ".excalidraw"), "ART.excalidraw"); // case-insensitive strip
  assert.equal(slugFilename("notes.txt", ".txt"), "notes.txt"); // legacy .txt strip + re-add
  assert.equal(slugFilename("", ".excalidraw"), "untitled.excalidraw");
  assert.equal(slugFilename("   ", ".excalidraw"), "untitled.excalidraw");
  assert.equal(slugFilename("..", ".excalidraw"), "untitled.excalidraw");
});

test("slugFilename removes path separators and control characters", () => {
  const isUnsafe = (s: string) =>
    [...s].some((ch) => ch === "\\" || ch === "/" || ch.charCodeAt(0) < 32);
  for (const nasty of ["../../etc/passwd", "..\\..\\windows\\system32", "C:\\evil\\name", "a\u0000b\u001fc"]) {
    const out = slugFilename(nasty, ".excalidraw");
    assert.ok(!isUnsafe(out), `unsafe characters in ${JSON.stringify(out)}`);
    assert.ok(out.endsWith(".excalidraw"));
  }
});

test("slugFilename truncates the base to 100 characters", () => {
  assert.equal(slugFilename("x".repeat(300), ".excalidraw"), "x".repeat(100) + ".excalidraw");
});

test("loadLocal returns null for missing or corrupt data", () => {
  assert.equal(loadLocal(), null); // nothing stored
  store.setItem(LS_KEY, "{not json");
  assert.equal(loadLocal(), null); // corrupt JSON
  store.setItem(LS_KEY, "[1,2,3]");
  assert.equal(loadLocal(), null); // array, not a record
  store.setItem(LS_KEY, JSON.stringify({ appState: {} }));
  assert.equal(loadLocal(), null); // missing elements
  store.setItem(LS_KEY, JSON.stringify({ elements: [1] }));
  assert.equal(loadLocal(), null); // primitive elements
  store.setItem(LS_KEY, JSON.stringify({ elements: [], appState: null }));
  assert.equal(loadLocal(), null); // null appState
  store.fail = true;
  assert.equal(loadLocal(), null); // blocked storage
});

test("loadLocal accepts a well-formed record and defaults appState", () => {
  store.setItem(LS_KEY, JSON.stringify({ elements: [{ id: "a" }] }));
  assert.deepEqual(loadLocal(), { elements: [{ id: "a" }], appState: {} });
  store.setItem(LS_KEY, JSON.stringify({ elements: [], appState: { theme: "dark" } }));
  assert.deepEqual(loadLocal(), { elements: [], appState: { theme: "dark" } });
});

test("saveScene round-trips through the KV store and strips collaborators", async () => {
  const kv = new MemoryKv();
  await saveScene([{ id: "a" }], { theme: "dark", collaborators: { me: true } }, kv);
  const rec = await loadScene(kv);
  assert.deepEqual(rec, { elements: [{ id: "a" }], appState: { theme: "dark" } });
  assert.ok(!("collaborators" in rec!.appState));
  assert.equal(loadLocal(), null); // the legacy record stays out of it
});

test("saveScene falls back to localStorage when IndexedDB is unavailable", async () => {
  await saveScene([{ id: "b" }], {}, null);
  assert.deepEqual(await loadScene(null), { elements: [{ id: "b" }], appState: {} });
});

test("saveScene surfaces full/blocked storage instead of swallowing it", async () => {
  const kv = new MemoryKv();
  kv.fail = true;
  await assert.rejects(saveScene([], {}, kv), /kv blocked/);
  store.fail = true; // legacy path: localStorage.setItem throws
  await assert.rejects(saveScene([], {}, null), /storage blocked/);
});

test("clearScene empties both stores", async () => {
  const kv = new MemoryKv();
  await saveScene([{ id: "a" }], {}, kv);
  legacyRecord([{ id: "legacy" }]);
  await clearScene(kv);
  assert.equal(await kv.get("scene"), null);
  assert.equal(loadLocal(), null);
});

test("clearScene keeps the localStorage copy when the KV clear fails", async () => {
  const kv = new MemoryKv();
  await kv.set("scene", "{}");
  kv.fail = true;
  legacyRecord([{ id: "legacy" }]);
  await assert.rejects(clearScene(kv), /kv blocked/);
  assert.notEqual(loadLocal(), null); // the only surviving copy is untouched
});

test("loadScene prefers the KV record and drops a stale localStorage leftover", async () => {
  const kv = new MemoryKv();
  await saveScene([{ id: "idb" }], {}, kv);
  legacyRecord([{ id: "legacy" }]);
  const rec = await loadScene(kv);
  assert.deepEqual(rec, { elements: [{ id: "idb" }], appState: {} });
  assert.equal(loadLocal(), null); // stale copy removed once IDB answered
});

test("loadScene migrates a legacy localStorage record into the KV store", async () => {
  const kv = new MemoryKv();
  legacyRecord([{ id: "legacy" }], { theme: "dark" });
  const rec = await loadScene(kv);
  assert.deepEqual(rec, { elements: [{ id: "legacy" }], appState: { theme: "dark" } });
  assert.equal(loadLocal(), null); // removed only after the copy landed
  assert.deepEqual(await loadScene(kv), rec); // IDB is now the source of truth
});

test("failed migration keeps the legacy record alive", async () => {
  const kv = new MemoryKv();
  kv.fail = true; // read fails → legacy path → migration write fails
  legacyRecord([{ id: "legacy" }]);
  const rec = await loadScene(kv);
  assert.deepEqual(rec, { elements: [{ id: "legacy" }], appState: {} });
  assert.notEqual(loadLocal(), null); // never drop the only copy
});

test("a corrupt KV record falls back to the legacy record", async () => {
  const kv = new MemoryKv();
  await kv.set("scene", "{not json");
  legacyRecord([{ id: "legacy" }]);
  const rec = await loadScene(kv);
  assert.deepEqual(rec, { elements: [{ id: "legacy" }], appState: {} });
  assert.equal(loadLocal(), null); // migrated over the corrupt record
});

test("writes are serialised: an older save never lands after a newer one", async () => {
  const kv = new MemoryKv();
  kv.delayMs = 15;
  await Promise.all([
    saveScene([{ id: "first" }], {}, kv),
    saveScene([{ id: "second" }], {}, kv),
    clearScene(kv),
  ]);
  assert.equal(await loadScene(kv), null); // the clear ran last, not between the saves
  await saveScene([{ id: "last" }], {}, kv);
  assert.deepEqual(await loadScene(kv), { elements: [{ id: "last" }], appState: {} });
});

test("without an injected store the default path degrades to localStorage", async () => {
  legacyRecord([{ id: "legacy" }]);
  assert.deepEqual(await loadScene(), { elements: [{ id: "legacy" }], appState: {} });
  await saveScene([{ id: "x" }], {});
  assert.deepEqual(await loadScene(), { elements: [{ id: "x" }], appState: {} });
  await clearScene();
  assert.equal(await loadScene(), null);
});

test("readSceneFile accepts object scenes, bare element arrays and defaults appState", async () => {
  const obj = await readSceneFile(
    fileOf(JSON.stringify({ type: "excalidraw", elements: [{ id: "a" }], appState: { theme: "dark" } })),
  );
  assert.deepEqual(obj, { elements: [{ id: "a" }], appState: { theme: "dark" } });

  const arr = await readSceneFile(fileOf(JSON.stringify([{ id: "a" }])));
  assert.deepEqual(arr, { elements: [{ id: "a" }], appState: {} });

  const bare = await readSceneFile(fileOf(JSON.stringify({ elements: [] })));
  assert.deepEqual(bare, { elements: [], appState: {} });
});

test("readSceneFile rejects malformed and hostile input", async () => {
  await assert.rejects(readSceneFile(fileOf("not json")), SyntaxError);
  await assert.rejects(readSceneFile(fileOf(JSON.stringify(null))), /not a scene/);
  await assert.rejects(readSceneFile(fileOf(JSON.stringify({ elements: "x" }))), /bad elements/);
  await assert.rejects(readSceneFile(fileOf(JSON.stringify({ elements: [1] }))), /bad elements/);
  await assert.rejects(readSceneFile(fileOf(JSON.stringify({ elements: [{}], appState: "x" }))), /bad appState/);

  const tooBig = { size: 25 * 1024 * 1024 + 1, text: () => Promise.resolve("") } as unknown as File;
  await assert.rejects(readSceneFile(tooBig), /file too large/);

  const tooMany = {
    size: 1024,
    text: () => Promise.resolve(JSON.stringify({ elements: new Array(100_001).fill(0) })),
  };
  await assert.rejects(readSceneFile(tooMany), /too many elements/);
});
