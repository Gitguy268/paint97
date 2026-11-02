import assert from "node:assert/strict";
import { test } from "node:test";
import bfs from "browserfs";
import { createNoteStore, parseNote, NOTE_TEXT_KEY } from "../../src/lib/noteStore.ts";
import { exportBackup, importBackup, resetAll } from "../../src/lib/backup.ts";
import { MemoryStorage } from "./helpers.ts";

const memory = async () => {
  await new Promise<void>((resolve, reject) => { bfs.configure({ fs: "InMemory", options: {} }, (e) => e ? reject(e) : resolve()); });
  const fs = bfs.BFSRequire("fs");
  return { fs, notes: createNoteStore(fs) };
};

test("BrowserFS saves serialize, retain Unicode and filename, and clear after pending writes", async () => {
  const { notes } = await memory();
  assert.equal(await notes.load(), null);
  await Promise.all([notes.save({ text: "first", name: "one.txt" }), notes.save({ text: "你好 🐈\nlast", name: "two.txt" })]);
  assert.deepEqual(await notes.load(), { text: "你好 🐈\nlast", name: "two.txt" });
  const writing = notes.save({ text: "pending", name: "three.txt" });
  await notes.clear();
  await writing;
  assert.equal(await notes.load(), null);
});

test("a failed temporary write leaves the previous note readable and does not poison future saves", async () => {
  const { fs, notes } = await memory();
  await notes.save({ text: "keep this", name: "notes.txt" });
  const original = fs.writeFile;
  fs.writeFile = ((_path: unknown, _data: unknown, _encoding: unknown, cb: (e: Error) => void) => cb(new Error("quota"))) as typeof fs.writeFile;
  await assert.rejects(notes.save({ text: "lost write", name: "notes.txt" }), /quota/);
  assert.equal((await notes.load())?.text, "keep this");
  fs.writeFile = original;
  await notes.save({ text: "next", name: "notes.txt" });
  assert.equal((await notes.load())?.text, "next");
});

test("backup exports BrowserFS notes in v1, respects a newer fallback, and reset/import clear stale files", async () => {
  const { notes } = await memory();
  const ls = new MemoryStorage();
  await notes.save({ text: "stored", name: "notes.txt" });
  const backup = await exportBackup(ls, null, new Date(0), notes);
  assert.equal(backup.local[NOTE_TEXT_KEY], "stored");
  ls.setItem(NOTE_TEXT_KEY, "newer fallback");
  assert.equal((await exportBackup(ls, null, new Date(0), notes)).local[NOTE_TEXT_KEY], "newer fallback");
  await resetAll(ls, null, notes);
  assert.equal(await notes.load(), null);
  assert.equal(ls.getItem(NOTE_TEXT_KEY), null);
  await notes.save({ text: "must disappear", name: "old.txt" });
  await importBackup(backup, ls, null, notes);
  assert.deepEqual(await notes.load(), { text: "stored", name: "notes.txt" });
  assert.equal(ls.getItem(NOTE_TEXT_KEY), null);
});

test("stored notes validate shape and size before use", () => {
  for (const raw of ['null', '{}', '{"text":5,"name":"x"}', '{"text":"x","name":[]}']) assert.throws(() => parseNote(raw));
  assert.throws(() => parseNote(JSON.stringify({ text: "x".repeat(5 * 1024 * 1024 + 1), name: "x" })));
});

test("restoring BrowserFS notes does not need localStorage space", async () => {
  const { notes } = await memory();
  const ls = new MemoryStorage();
  ls.setItem = () => { throw new Error("localStorage quota"); };
  await importBackup({ app: "paint97", version: 1, exportedAt: "", kv: {}, local: { "paint97.notepad.v1": "restored directly", "paint97.notepad.name.v1": "large.txt" } }, ls, null, notes);
  assert.deepEqual(await notes.load(), { text: "restored directly", name: "large.txt" });
});
