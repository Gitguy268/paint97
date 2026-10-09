// One test per choppy rule, on a fake clock: the rules are timing contracts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CDN_PKG, loadClippyAssets, safeAssetUrl, type AssetIo } from "../../src/clippy/assets.ts";
import { ClippyEngine, RULES, clampFps, clampScale, type AgentData, type Cell, type Clock, type Renderer } from "../../src/clippy/engine.ts";

class FakeClock implements Clock {
  now = 0;
  rnd = 0.5;
  #seq = 0;
  #timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number) { this.#timers.set(++this.#seq, { at: this.now + ms, fn }); return this.#seq; }
  clearTimeout(id: number) { this.#timers.delete(id); }
  random() { return this.rnd; }
  get armed() { return this.#timers.size; }
  /** Advance time, firing timers in order (including ones they schedule). */
  tick(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.#timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.#timers.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
    }
    this.now = end;
  }
}

type Log = { t: number; what: string };
function rig(opts: ConstructorParameters<typeof ClippyEngine>[3] = {}, vp = { w: 800, h: 600 }) {
  const clock = new FakeClock();
  const log: Log[] = [];
  const say = (what: string) => log.push({ t: clock.now, what });
  const r: Renderer = {
    draw: (c: Cell) => say(`draw ${c[0]},${c[1]}`),
    place: (x, y) => say(`place ${x},${y}`),
    setScale: (s) => say(`scale ${s}`),
    balloon: (text) => say(text === null ? "balloon off" : `balloon ${text}`),
    announce: (text) => say(`announce ${text}`),
    sound: (id) => say(`sound ${id}`),
    viewport: () => vp,
  };
  const frames = (n: number, duration: number) => Array.from({ length: n }, (_, i) => ({ duration, images: [[i * 10, 0] as const] }));
  const data: AgentData = {
    framesize: [100, 50],
    animations: { Fast: { frames: frames(4, 10) }, Slow: { frames: frames(3, 300) }, IdleNap: { frames: frames(2, 100) }, Beep: { frames: [{ duration: 100, images: [[5, 5]], sound: "7" }, { duration: 100, images: [[6, 6]] }] } },
  };
  const engine = new ClippyEngine(data, r, clock, { x: 100, y: 100, ...opts });
  log.length = 0;
  const of = (prefix: string) => log.filter((l) => l.what.startsWith(prefix));
  return { clock, log, engine, of };
}

test("rule 1: fps is clamped to 8-12 and frames never step faster than the frame clock", async () => {
  assert.deepEqual([1, 8, 10, 12, 60].map(clampFps), [8, 8, 10, 12, 12]);
  const { clock, engine, of } = rig({ fps: 60 });
  assert.equal(engine.fps, 12);
  assert.equal(engine.frameMs, 83);
  const h = engine.play("Fast"); // frames ask for 10 ms each
  clock.tick(1000);
  assert.equal(await h.done, true);
  assert.deepEqual(of("draw").map((l) => l.t), [0, 83, 166, 249]);
});

test("rule 1: slower frame durations from the agent data are honoured", () => {
  const { clock, engine, of } = rig({ fps: 10 });
  engine.play("Slow");
  clock.tick(1000);
  assert.deepEqual(of("draw").map((l) => l.t), [0, 300, 600]);
});

test("rule 2: the stylesheet has no transitions, keyframes or opacity fades", () => {
  const css = readFileSync(new URL("../../src/clippy/clippy.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /@keyframes|opacity/);
  for (const decl of css.match(/(transition|animation)\s*:[^;}]+/g) ?? []) assert.match(decl, /:\s*none\b/, decl);
  for (const sel of [".clippy ", ".clippy-sprite ", ".clippy-balloon "]) assert.match(css, new RegExp(`${sel.replace(".", "\\.")}\\{[^}]*transition: none !important`));
});

test("rule 3: scale is an integer from 1 to 4, and the sprite is pixelated", () => {
  assert.deepEqual([0, 1, 2.4, 2.6, 9].map(clampScale), [1, 1, 2, 3, 4]);
  const { engine, of } = rig();
  engine.setScale(2.7);
  assert.equal(engine.scale, 3);
  assert.deepEqual(engine.size, { w: 300, h: 150 });
  assert.equal(of("scale").at(-1)?.what, "scale 3");
  assert.match(readFileSync(new URL("../../src/clippy/clippy.css", import.meta.url), "utf8"), /image-rendering: pixelated/);
});

test("rule 4: moveTo is exactly 5 teleport jumps, then an 80 ms freeze", async () => {
  const { clock, engine, of } = rig();
  const h = engine.moveTo(600, 400);
  let done = false;
  void h.done.then(() => { done = true; });
  clock.tick(RULES.MOVE_GAP_MS * 4 + RULES.MOVE_FREEZE_MS - 1);
  await Promise.resolve();
  assert.equal(done, false, "still frozen");
  clock.tick(1);
  assert.equal(await h.done, true);
  const places = of("place");
  assert.equal(places.length, RULES.MOVE_JUMPS);
  assert.deepEqual(places.map((l) => l.t), [0, 140, 280, 420, 560]);
  assert.deepEqual(places.map((l) => l.what), ["place 200,160", "place 300,220", "place 400,280", "place 500,340", "place 600,400"]);
  assert.deepEqual(engine.position, { x: 600, y: 400 });
});

test("rule 5: blink is 2 frames, 3-6 s apart, back to rest, and never while busy", () => {
  const armed = (rnd: number) => { const r = rig(); r.clock.rnd = rnd; r.engine.setReducedMotion(false); /* re-arms with this random */ return r; };

  const early = armed(0); // shortest gap
  early.clock.tick(RULES.BLINK_MIN_MS - 1);
  assert.equal(early.of("draw").length, 0, "no blink before 3 s");
  early.clock.tick(1 + RULES.BLINK_FRAME_MS * RULES.BLINK_FRAMES);
  assert.deepEqual(early.of("draw").map((l) => [l.t, l.what]), [[3000, "draw 1116,186"], [3060, "draw 1240,186"], [3120, "draw 0,0"]]);

  const late = armed(1); // longest gap
  late.clock.tick(RULES.BLINK_MAX_MS - 1);
  assert.equal(late.of("draw 1116").length, 0);
  late.clock.tick(1);
  assert.equal(late.of("draw 1116").length, 1, "blinks by 6 s at the latest");

  const busy = armed(0);
  busy.clock.tick(2950);
  busy.engine.play("Slow");
  busy.clock.tick(100);
  assert.equal(busy.of("draw 1116").length, 0, "skipped while an animation runs");
});

test("rule 6: the balloon shows instantly, reveals on the frame clock, hides instantly", async () => {
  const { clock, engine, of } = rig({ fps: 10 });
  const h = engine.speak("one two three");
  assert.equal(of("balloon")[0]?.t, 0, "visible on the very first tick");
  assert.equal(of("announce")[0]?.what, "announce one two three");
  clock.tick(1000);
  assert.equal(await h.done, true);
  assert.deepEqual(of("balloon").map((l) => l.t), [0, 100, 200, 300, 400]);
  assert.equal(of("balloon").at(-1)?.what, "balloon one two three");
  clock.tick(3000 + 13 * 40);
  assert.equal(of("balloon").at(-1)?.what, "balloon off");
});

test("queue: tasks run in order, queued and running tasks can be cancelled", async () => {
  const { clock, engine } = rig();
  const a = engine.play("Slow");
  const b = engine.play("Fast");
  const c = engine.speak("hi");
  assert.equal(engine.pending, 2);
  b.cancel();
  assert.equal(await b.done, false);
  assert.equal(engine.pending, 1);
  clock.tick(100);
  a.cancel(); // mid-animation
  assert.equal(await a.done, false);
  clock.tick(500);
  assert.equal(await c.done, true);
  assert.equal(engine.busy, false);
  assert.equal(await engine.play("Nope").done, false);
});

test("queue: stop() cancels everything and frame sounds are forwarded", async () => {
  const { clock, engine, of } = rig();
  const a = engine.play("Beep");
  const b = engine.moveTo(0, 0);
  assert.equal(of("sound")[0]?.what, "sound 7");
  engine.stop();
  assert.deepEqual([await a.done, await b.done], [false, false]);
  clock.tick(5000);
  assert.equal(of("place").length, 0);
});

test("drag: positions are clamped to the viewport edges", () => {
  const { engine } = rig();
  engine.dragStart(110, 110); // grabbed 10px inside the sprite
  engine.dragMove(-500, -500);
  assert.deepEqual(engine.position, { x: RULES.EDGE_MARGIN, y: RULES.EDGE_MARGIN });
  engine.dragMove(5000, 5000);
  assert.deepEqual(engine.position, { x: 800 - 100 - RULES.EDGE_MARGIN, y: 600 - 50 - RULES.EDGE_MARGIN });
  engine.dragEnd();
  engine.dragMove(300, 300);
  assert.equal(engine.position.x, 695, "no movement after release");
});

test("pause: a hidden tab stops every timer and resume continues the same animation", async () => {
  const { clock, engine, of } = rig({ fps: 10 });
  const h = engine.play("Slow");
  clock.tick(100);
  engine.pause();
  assert.equal(clock.armed, 1, "only the animation's own safety timeout remains");
  clock.tick(60_000);
  assert.equal(of("draw").length, 1, "frozen on frame 0");
  engine.resume();
  clock.tick(1000);
  assert.equal(await h.done, true);
  assert.equal(of("draw").filter((l) => l.what !== "draw 0,0" || l.t < 200).length >= 3, true);
});

test("idle life: an Idle* animation starts after a quiet spell and yields to real work", async () => {
  const { clock, engine, of } = rig();
  clock.rnd = 0;
  engine.setReducedMotion(false);
  clock.tick(RULES.IDLE_MIN_MS);
  assert.equal(engine.busy, true);
  const h = engine.speak("hello");
  clock.tick(500);
  assert.equal(await h.done, true);
  assert.equal(of("balloon")[0]?.t, RULES.IDLE_MIN_MS, "the idle nap was cut short immediately");
});

test("reduced motion: no blink, no idle life, animations and moves collapse to one step", async () => {
  const { clock, engine, of } = rig({ reducedMotion: true });
  clock.tick(60_000);
  assert.equal(of("draw").length, 0);
  assert.equal(await engine.play("Slow").done, true);
  assert.deepEqual(of("draw").map((l) => l.what), ["draw 20,0"]);
  assert.equal(await engine.moveTo(400, 300).done, true);
  assert.equal(of("place").length, 1);
  assert.equal(await engine.speak("a b c").done, true);
  assert.deepEqual(of("balloon").map((l) => l.what), ["balloon a b c"]);
});

test("assets: local first, pinned CDN only as a fallback, unsafe URLs refused", async () => {
  const agent = { framesize: [124, 93], animations: {} };
  const calls: string[] = [];
  const local: AssetIo = {
    fetchJson: (u) => { calls.push(u); return Promise.resolve(u.endsWith("agent.json") ? agent : { "1": "data:audio/mpeg;base64,AA", "2": "https://evil.example/x.mp3" }); },
    importDefault: (u) => { calls.push(u); return Promise.reject(new Error("no network")); },
  };
  const a = await loadClippyAssets(local);
  assert.equal(a.source, "local");
  assert.deepEqual(a.sounds, { "1": "data:audio/mpeg;base64,AA" });
  assert.ok(calls.every((u) => u.startsWith("assets/clippy/")), "the CDN was never touched");

  const cdnCalls: string[] = [];
  const cdn: AssetIo = {
    fetchJson: () => Promise.reject(new Error("404")),
    importDefault: (u) => { cdnCalls.push(u); return Promise.resolve(u.endsWith("agent.mjs") ? agent : u.endsWith("map.mjs") ? "data:image/png;base64,AA" : {}); },
  };
  assert.equal((await loadClippyAssets(cdn)).source, "cdn");
  assert.ok(cdnCalls.every((u) => u.startsWith(`https://cdn.jsdelivr.net/npm/${CDN_PKG}/`)), "version-pinned");
  assert.match(CDN_PKG, /@\d+\.\d+\.\d+$/);
  await assert.rejects(loadClippyAssets({ fetchJson: () => Promise.resolve({}), importDefault: () => Promise.resolve({}) }));

  assert.equal(safeAssetUrl("assets/clippy/map.png"), "assets/clippy/map.png");
  assert.equal(safeAssetUrl(`https://cdn.jsdelivr.net/npm/${CDN_PKG}/dist/x.png`), `https://cdn.jsdelivr.net/npm/${CDN_PKG}/dist/x.png`);
  for (const bad of ["https://cdn.jsdelivr.net/npm/clippyjs@9.9.9/x.png", "https://evil.example/a.png", "//evil.example/a.png", "http://cdn.jsdelivr.net/npm/clippyjs@0.1.0/x", 'a");x', "javascript:alert(1)", "", 5]) assert.equal(safeAssetUrl(bad), null, String(bad));
});
