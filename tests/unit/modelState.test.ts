import assert from "node:assert/strict";
import { test } from "node:test";
import { MODEL_STATE0, modelReducer, percent, type ModelEvent, type ModelState } from "../../src/lib/localAi/modelState.ts";

const run = (events: ModelEvent[], from: ModelState = MODEL_STATE0) => events.reduce(modelReducer, from);
const prog = (loadedBytes: number) => ({ loadedBytes, totalBytes: 600 });

test("probe: cached model warms up, missing model offers the download", () => {
  assert.equal(run([{ type: "probed", cached: true }]).phase, "loading");
  assert.equal(run([{ type: "probed", cached: false }]).phase, "absent");
});

test("download → pause keeps progress → resume → install → ready", () => {
  let s = run([{ type: "probed", cached: false }, { type: "download" }, { type: "progress", progress: prog(150) }]);
  assert.equal(percent(s.progress), 25);
  s = run([{ type: "paused" }], s);
  assert.equal(s.phase, "paused");
  assert.equal(s.progress?.loadedBytes, 150, "the bar stays where it was");
  s = run([{ type: "progress", progress: prog(999) }], s);
  assert.equal(s.progress?.loadedBytes, 150, "late progress from the aborted fetch is ignored");
  s = run([{ type: "download" }, { type: "installed" }, { type: "ready" }], s);
  assert.deepEqual(s, { phase: "ready", progress: null, error: null });
});

test("cancelling before any byte arrived returns to the offer", () => {
  assert.equal(run([{ type: "probed", cached: false }, { type: "download" }, { type: "paused" }]).phase, "absent");
});

test("failures carry their kind so Retry knows what to redo; remove resets", () => {
  const s = run([{ type: "probed", cached: false }, { type: "download" }, { type: "failed", kind: "install", msg: "hash mismatch" }]);
  assert.deepEqual(s.error, { kind: "install", msg: "hash mismatch" });
  assert.equal(run([{ type: "download" }], s).phase, "downloading");
  assert.equal(run([{ type: "download" }], s).error, null);
  assert.equal(run([{ type: "removing" }, { type: "removed" }], s).phase, "absent");
});

test("out-of-order events are ignored", () => {
  assert.equal(run([{ type: "ready" }]).phase, "checking");
  assert.equal(run([{ type: "probed", cached: true }, { type: "download" }]).phase, "loading");
  assert.equal(percent(null), 0);
});
