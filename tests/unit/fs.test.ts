import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import * as F from "../../src/lib/fs.ts";
import { fsOps, fsState, loadFs } from "../../src/lib/fsStore.ts";
import { MemoryKv } from "./helpers.ts";

const mk = () => {
  let fs = F.addNode(F.EMPTY_FS, { id: "d", kind: "folder", name: "Docs", parent: null, at: 1 });
  fs = F.addNode(fs, { id: "s", kind: "folder", name: "Sub", parent: "d", at: 2 });
  fs = F.addNode(fs, { id: "a", kind: "file", name: "cat", parent: null, at: 3, chars: 10 });
  return fs;
};

test("names are sanitised and made unique per folder", () => {
  assert.equal(F.sanitizeName("../evil<script>.excalidraw"), "..evilscript");
  assert.equal(F.sanitizeName("  "), "untitled");
  const fs = F.addNode(mk(), { id: "b", kind: "file", name: "CAT", parent: null, at: 4 });
  assert.equal(fs.nodes.b!.name, "CAT (2)");
});

test("children lists folders first; an unknown parent falls back to the root", () => {
  const fs = F.addNode(mk(), { id: "z", kind: "file", name: "aaa", parent: "nope", at: 5 });
  assert.deepEqual(F.children(fs, null).map((n) => n.id), ["d", "z", "a"]);
  assert.deepEqual(F.pathOf(fs, "s"), ["Docs", "Sub"]);
});

test("move refuses cycles and non-folders, renames on collision", () => {
  let fs = mk();
  assert.equal(F.move(fs, "d", "s"), fs, "folder into its own subtree");
  assert.equal(F.move(fs, "d", "a"), fs, "into a file");
  fs = F.addNode(fs, { id: "c", kind: "file", name: "cat", parent: "d", at: 6 });
  fs = F.move(fs, "a", "d");
  assert.equal(fs.nodes.a!.parent, "d");
  assert.equal(fs.nodes.a!.name, "cat (2)");
});

test("trash hides, restore returns; a binned parent sends the child to the root", () => {
  let fs = F.addNode(mk(), { id: "c", kind: "file", name: "in-sub", parent: "s", at: 6 });
  fs = F.trash(fs, "c", 100);
  assert.deepEqual(F.trashed(fs).map((n) => n.id), ["c"]);
  assert.equal(F.children(fs, "s").length, 0);
  fs = F.trash(fs, "d", 101);
  assert.equal(F.isLive(fs, "s"), false);
  fs = F.restore(fs, "c");
  assert.equal(fs.nodes.c!.parent, null);
  assert.equal(fs.nodes.c!.trashedAt, null);
});

test("purge removes the whole subtree", () => {
  const fs0 = F.addNode(mk(), { id: "c", kind: "file", name: "deep", parent: "s", at: 6 });
  const { fs, removed } = F.purge(fs0, "d");
  assert.deepEqual(removed.map((n) => n.id).sort(), ["c", "d", "s"]);
  assert.deepEqual(Object.keys(fs.nodes), ["a"]);
});

test("versions: gap-throttled, capped, oldest evicted", () => {
  let fs = mk();
  assert.equal(F.snapshotDue(fs.nodes.a!, 1000), true);
  fs = F.touch(fs, "a", 20, 1000, true).fs;
  assert.equal(F.snapshotDue(fs.nodes.a!, 1000 + F.VERSION_GAP_MS - 1), false);
  assert.equal(F.snapshotDue(fs.nodes.a!, 1000 + F.VERSION_GAP_MS), true);
  let dropped: number[] = [];
  for (let i = 1; i <= F.MAX_VERSIONS; i++) ({ fs, dropped } = F.touch(fs, "a", 20, 1000 + i, true));
  assert.equal(fs.nodes.a!.versions.length, F.MAX_VERSIONS);
  assert.deepEqual(dropped, [1000]);
  assert.equal(F.touch(fs, "a", 99, 5000, false).fs.nodes.a!.versions.length, F.MAX_VERSIONS);
});

test("parseFs drops garbage and re-homes orphans", () => {
  const raw = { nodes: { a: { id: "a", kind: "file", name: "x/y", parent: "gone", createdAt: 1, modifiedAt: 1, versions: [1, "x"] }, b: { id: "zz" }, c: 5 } };
  const fs = F.parseFs(raw);
  assert.deepEqual(Object.keys(fs.nodes), ["a"]);
  assert.equal(fs.nodes.a!.parent, null);
  assert.equal(fs.nodes.a!.name, "xy");
  assert.deepEqual(fs.nodes.a!.versions, [1]);
  assert.deepEqual(F.parseFs("nope"), F.EMPTY_FS);
});

// ---- store (KV-backed) ----
const scene = (n: number) => ({ elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })), appState: { collaborators: {}, zoom: 1 } });
let kv: MemoryKv;
beforeEach(async () => { kv = new MemoryKv(); await loadFs(kv); });

test("create → read round-trips and survives a reload", async () => {
  const id = await fsOps.create("My cat", null, scene(2), kv);
  assert.equal((await fsOps.read(id, kv))?.elements.length, 2);
  await loadFs(kv);
  const node = fsState.get().fs.nodes[id]!;
  assert.equal(node.name, "My cat");
  assert.equal(node.versions.length, 1);
});

test("write keeps a previous version that can be read back", async () => {
  const id = await fsOps.create("v", null, scene(1), kv);
  const first = fsState.get().fs.nodes[id]!.versions[0]!;
  await new Promise<void>((r) => { setTimeout(r, 2); });
  await fsOps.write(id, scene(3), true, kv);
  assert.equal((await fsOps.read(id, kv))?.elements.length, 3);
  assert.equal((await fsOps.readVersion(id, first, kv))?.elements.length, 1);
  assert.equal(fsState.get().fs.nodes[id]!.versions.length, 2);
  await fsOps.write(id, scene(4), false, kv); // autosave inside the gap: no new snapshot
  assert.equal(fsState.get().fs.nodes[id]!.versions.length, 2);
});

test("trash / restore / rename / move are undoable; purge deletes bodies and clears undo", async () => {
  const id = await fsOps.create("doc", null, scene(1), kv);
  await fsOps.newFolder("Folder", null, kv);
  const folder = F.children(fsState.get().fs, null)[0]!.id;
  await fsOps.move(id, folder, kv);
  await fsOps.rename(id, "renamed", kv);
  await fsOps.trash(id, kv);
  assert.equal(F.trashed(fsState.get().fs).length, 1);
  await fsOps.undo(kv);
  assert.equal(F.trashed(fsState.get().fs).length, 0);
  await fsOps.undo(kv);
  assert.equal(fsState.get().fs.nodes[id]!.name, "doc");
  await fsOps.undo(kv);
  assert.equal(fsState.get().fs.nodes[id]!.parent, null);
  await fsOps.trash(id, kv);
  await fsOps.emptyBin(kv);
  assert.equal(fsState.get().undo.length, 0);
  assert.equal(await fsOps.read(id, kv), null);
  assert.deepEqual(await kv.keys("fs:ver:"), []);
});

test("storage failures reject instead of losing data silently", async () => {
  kv.fail = true;
  await assert.rejects(fsOps.create("x", null, scene(1), kv));
  await assert.rejects(fsOps.create("x", null, scene(1), null), /unavailable/);
});
