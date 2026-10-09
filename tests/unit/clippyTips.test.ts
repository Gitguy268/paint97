import assert from "node:assert/strict";
import { test } from "node:test";
import { TIP_COOLDOWN_MS, TIP_PACKS, TIP_STATE0, dayKey, nextTip, tipFor, tipOfTheDay, tipPackById } from "../../src/clippy/tips.ts";

const classic = tipPackById("classic");

test("every personality has the same, non-empty shape", () => {
  assert.deepEqual(TIP_PACKS.map((p) => p.id), ["classic", "concise", "hype"]);
  for (const p of TIP_PACKS) {
    assert.ok(p.greeting && p.tips.length >= 5, p.id);
    for (const [ctx, pool] of Object.entries(p.context)) assert.ok(pool.length > 0 && pool.every((s) => s.trim()), `${p.id}.${ctx}`);
  }
  assert.equal(tipPackById("nope").id, "classic");
});

test("explicit events always get a tip; ambient ones respect the cooldown", () => {
  const first = tipFor(classic, { kind: "empty" }, TIP_STATE0, 1000, 0);
  assert.ok(first);
  assert.equal(tipFor(classic, { kind: "idle" }, first.state, 1000 + TIP_COOLDOWN_MS - 1, 0), null);
  assert.ok(tipFor(classic, { kind: "idle" }, first.state, 1000 + TIP_COOLDOWN_MS, 0));
  assert.ok(tipFor(classic, { kind: "save" }, first.state, 1001, 0), "save ignores the cooldown");
  assert.equal(tipFor(classic, { kind: "error", message: "x" }, first.state, 1001, 0)?.tip.anim, "Alert");
});

test("each tool is explained once, and unknown tools stay silent", () => {
  const a = tipFor(classic, { kind: "tool", tool: "arrow" }, TIP_STATE0, 0, 0);
  assert.match(a?.tip.text ?? "", /Arrows/);
  assert.equal(tipFor(classic, { kind: "tool", tool: "arrow" }, a!.state, 10 * TIP_COOLDOWN_MS, 0), null);
  assert.equal(tipFor(classic, { kind: "tool", tool: "laser" }, TIP_STATE0, 0, 0), null);
});

test("clicking walks the list in order and wraps", () => {
  let state = TIP_STATE0;
  const seen: string[] = [];
  for (let i = 0; i < classic.tips.length + 1; i++) { const r = nextTip(classic, state, i); seen.push(r.tip.text); state = r.state; }
  assert.deepEqual(seen.slice(0, -1), [...classic.tips]);
  assert.equal(seen.at(-1), classic.tips[0]);
});

test("tip of the day is stable within a day and changes the next", () => {
  const am = new Date(2026, 9, 9, 8), pm = new Date(2026, 9, 9, 23), next = new Date(2026, 9, 10, 8);
  assert.equal(tipOfTheDay(classic, am), tipOfTheDay(classic, pm));
  assert.notEqual(tipOfTheDay(classic, am), tipOfTheDay(classic, next));
  assert.equal(dayKey(am), dayKey(pm));
  assert.notEqual(dayKey(am), dayKey(next));
});
