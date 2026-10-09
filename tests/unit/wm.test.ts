import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_WM, close, focus, focusedId, minimize, move, mruOrder, open, parseWm, resize, snap, snapZone, taskbarClick, toggleMax } from "../../src/lib/wm.ts";

const area = { x: 0, y: 0, w: 1000, h: 700 };
const spec = (appId: string, singleton = false) => ({ appId, size: { w: 400, h: 300 }, singleton });

test("open stacks windows, cascades, and focuses the newest", () => {
  let wm = open(EMPTY_WM, spec("a"), {}, area);
  wm = open(wm, spec("b"), {}, area);
  assert.equal(wm.wins.length, 2);
  assert.equal(focusedId(wm), "b#2");
  assert.notDeepEqual(wm.wins[0]!.rect, wm.wins[1]!.rect);
});

test("singleton apps reuse their window and merge props", () => {
  let wm = open(EMPTY_WM, spec("n", true), {}, area);
  wm = open(wm, spec("x"), {}, area);
  wm = open(wm, spec("n", true), { file: "1" }, area);
  assert.equal(wm.wins.length, 2);
  assert.equal(focusedId(wm), "n#1");
  assert.equal(wm.wins.at(-1)!.props.file, "1");
});

test("minimise hands focus to the next window; focus restores", () => {
  let wm = open(open(EMPTY_WM, spec("a"), {}, area), spec("b"), {}, area);
  wm = minimize(wm, "b#2");
  assert.equal(focusedId(wm), "a#1");
  wm = focus(wm, "b#2");
  assert.equal(focusedId(wm), "b#2");
  assert.equal(wm.wins.at(-1)!.mode, "normal");
});

test("taskbar click toggles minimise on the focused window", () => {
  let wm = open(EMPTY_WM, spec("a"), {}, area);
  wm = taskbarClick(wm, "a#1");
  assert.equal(wm.wins[0]!.mode, "min");
  wm = taskbarClick(wm, "a#1");
  assert.equal(wm.wins[0]!.mode, "normal");
});

test("maximise/restore round-trips the rect; a maximised window minimises back to maximised", () => {
  let wm = open(EMPTY_WM, spec("a"), {}, area);
  const before = wm.wins[0]!.rect;
  wm = toggleMax(wm, "a#1", area);
  assert.deepEqual(wm.wins[0]!.rect, area);
  wm = minimize(wm, "a#1");
  wm = focus(wm, "a#1");
  assert.equal(wm.wins[0]!.mode, "max");
  wm = toggleMax(wm, "a#1", area);
  assert.deepEqual(wm.wins[0]!.rect, before);
});

test("move keeps a grab strip on screen; resize enforces a minimum", () => {
  let wm = open(EMPTY_WM, spec("a"), {}, area);
  wm = move(wm, "a#1", -5000, -5000, area);
  assert.ok(wm.wins[0]!.rect.x + wm.wins[0]!.rect.w >= 80);
  assert.equal(wm.wins[0]!.rect.y, 0);
  wm = resize(wm, "a#1", { x: 0, y: 0, w: 5, h: 5 });
  assert.ok(wm.wins[0]!.rect.w >= 220 && wm.wins[0]!.rect.h >= 120);
});

test("snap zones and snapping", () => {
  assert.equal(snapZone(0, 300, area), "left");
  assert.equal(snapZone(999, 300, area), "right");
  assert.equal(snapZone(500, 0, area), "max");
  assert.equal(snapZone(500, 300, area), null);
  let wm = open(EMPTY_WM, spec("a"), {}, area);
  wm = snap(wm, "a#1", "right", area);
  assert.deepEqual(wm.wins[0]!.rect, { x: 500, y: 0, w: 500, h: 700 });
});

test("mruOrder is topmost first; close removes", () => {
  let wm = open(open(EMPTY_WM, spec("a"), {}, area), spec("b"), {}, area);
  assert.deepEqual(mruOrder(wm), ["b#2", "a#1"]);
  wm = close(wm, "b#2");
  assert.deepEqual(mruOrder(wm), ["a#1"]);
});

test("parseWm drops unknown apps and garbage", () => {
  const raw = { seq: 2, wins: [{ id: "a#1", appId: "a", rect: { x: 1, y: 2, w: 3, h: 4 }, mode: "max" }, { id: "z#2", appId: "z", rect: { x: 1, y: 2, w: 3, h: 4 } }, { id: 5 }] };
  const wm = parseWm(raw, (id) => id === "a");
  assert.equal(wm.wins.length, 1);
  assert.equal(wm.wins[0]!.mode, "max");
  assert.deepEqual(parseWm("nope", () => true), EMPTY_WM);
});
