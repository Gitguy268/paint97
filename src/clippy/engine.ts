// ClippyEngine: the framework-free core of the assistant. It owns timing, the
// animation queue and position maths; a Renderer does the pixels and a Clock
// does the waiting, so every rule below is testable with fake timers.
//
// CHOPPY RULES (Win98 feel) are constants, not options:
//  1. Frame stepping only, on a timer clamped to 8-12 fps. Never a tween.
//  2. No CSS transitions anywhere (the renderer pins `transition: none`).
//  3. Integer pixel scale, 1-4, drawn pixelated.
//  4. moveTo is 5 teleport jumps plus an 80 ms freeze. Never a slide.
//  5. Blink is 2 frames, every 3-6 s, only while idle. No fade.
//  6. The balloon appears and disappears instantly. No opacity.
export const RULES = {
  FPS_MIN: 8, FPS_MAX: 12,
  SCALE_MIN: 1, SCALE_MAX: 4,
  MOVE_JUMPS: 5, MOVE_GAP_MS: 140, MOVE_FREEZE_MS: 80,
  BLINK_FRAMES: 2, BLINK_FRAME_MS: 60, BLINK_MIN_MS: 3000, BLINK_MAX_MS: 6000,
  IDLE_MIN_MS: 4500, IDLE_MAX_MS: 9000,
  EDGE_MARGIN: 5,
} as const;

/** Agent data ships no blink animation: these two eyes-narrowed cells stand in. */
const BLINK_CELLS: readonly Cell[] = [[1116, 186], [1240, 186]];
const REST_CELL: Cell = [0, 0];

export type Cell = readonly [x: number, y: number];
export type AgentFrame = {
  duration?: number;
  images?: readonly Cell[];
  sound?: string;
  exitBranch?: number;
  branching?: { branches: readonly { frameIndex: number; weight: number }[] };
};
export type AgentData = { framesize: readonly [w: number, h: number]; animations: Readonly<Record<string, { frames: readonly AgentFrame[] }>> };

export interface Renderer {
  /** Show one sprite cell (sheet coordinates, unscaled). */
  draw(cell: Cell): void;
  /** Teleport to a viewport position. */
  place(x: number, y: number): void;
  setScale(scale: number): void;
  /** Visible balloon text; null hides it. Always instant. */
  balloon(text: string | null): void;
  /** Whole message, once, for assistive tech (the visible reveal is word-by-word). */
  announce(text: string): void;
  sound(id: string): void;
  viewport(): { w: number; h: number };
}
export interface Clock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  random(): number;
}

export type Task =
  | { kind: "play"; name: string; timeoutMs: number }
  | { kind: "speak"; text: string; hold: boolean }
  | { kind: "move"; x: number; y: number };
/** `done` resolves true when the task ran to completion, false when cancelled or impossible. */
export type TaskHandle = { done: Promise<boolean>; cancel(): void };
type Job = { task: Task; finish: (ok: boolean) => void; idle: boolean };

export const clampFps = (fps: number) => Math.max(RULES.FPS_MIN, Math.min(RULES.FPS_MAX, Math.round(fps)));
export const clampScale = (s: number) => Math.max(RULES.SCALE_MIN, Math.min(RULES.SCALE_MAX, Math.round(s)));

export class ClippyEngine {
  #data: AgentData;
  #r: Renderer;
  #clock: Clock;
  #fps: number;
  #scale: number;
  #x = 0;
  #y = 0;
  #queue: Job[] = [];
  #running: Job | null = null;
  #exiting = false;
  /** The running task's single pending step; kept so pause() can re-arm it. */
  #step: { id: number; fn: () => void } | null = null;
  #blinkTimer = 0;
  #idleTimer = 0;
  #balloonTimer = 0;
  #killTimer = 0;
  #paused = false;
  #hidden = false;
  #reduced = false;
  #disposed = false;
  #drag: { ox: number; oy: number } | null = null;

  constructor(data: AgentData, renderer: Renderer, clock: Clock, opts: { fps?: number; scale?: number; x?: number; y?: number; reducedMotion?: boolean } = {}) {
    this.#data = data;
    this.#r = renderer;
    this.#clock = clock;
    this.#fps = clampFps(opts.fps ?? 10);
    this.#scale = clampScale(opts.scale ?? 1);
    this.#reduced = opts.reducedMotion ?? false;
    renderer.setScale(this.#scale);
    const vp = renderer.viewport();
    const { w, h } = this.size;
    this.snapTo(opts.x ?? vp.w - w - 24, opts.y ?? vp.h - h - 24);
    renderer.draw(REST_CELL);
    this.#armBlink();
    this.#armIdle();
  }

  // ---- read-only state ----
  get fps() { return this.#fps; }
  get scale() { return this.#scale; }
  get frameMs() { return Math.round(1000 / this.#fps); }
  get position() { return { x: this.#x, y: this.#y }; }
  get size() { return { w: this.#data.framesize[0] * this.#scale, h: this.#data.framesize[1] * this.#scale }; }
  get busy() { return this.#running !== null; }
  get pending() { return this.#queue.length; }
  hasAnimation(name: string) { return name in this.#data.animations; }
  animations() { return Object.keys(this.#data.animations); }

  // ---- settings ----
  setFps(fps: number) { this.#fps = clampFps(fps); }
  setScale(scale: number) {
    this.#scale = clampScale(scale);
    this.#r.setScale(this.#scale);
    this.snapTo(this.#x, this.#y); // a bigger sprite may now overhang the edge
  }
  /** Reduced motion: no idle life, no blink, animations collapse to their last frame, moves are one snap. */
  setReducedMotion(on: boolean) {
    this.#reduced = on;
    this.#armBlink();
    this.#armIdle();
  }

  // ---- queue ----
  play(name: string, timeoutMs = 5000): TaskHandle { return this.#enqueue({ kind: "play", name, timeoutMs }); }
  speak(text: string, opts: { hold?: boolean } = {}): TaskHandle { return this.#enqueue({ kind: "speak", text, hold: opts.hold ?? false }); }
  moveTo(x: number, y: number): TaskHandle { return this.#enqueue({ kind: "move", x, y }); }

  /** Cancel everything queued and running; the sprite returns to rest. */
  stop() {
    const jobs = [...this.#queue];
    this.#queue = [];
    for (const j of jobs) j.finish(false);
    this.#cancelRunning();
    this.closeBalloon();
  }
  /** Let the running animation take its exit branch and finish early. */
  exitAnimation() { this.#exiting = true; }
  closeBalloon() {
    this.#clock.clearTimeout(this.#balloonTimer);
    this.#r.balloon(null);
  }

  #enqueue(task: Task, idle = false): TaskHandle {
    let settle: (ok: boolean) => void = () => undefined;
    const done = new Promise<boolean>((res) => { settle = res; });
    if (this.#disposed) { settle(false); return { done, cancel: () => undefined }; }
    let settled = false;
    const job: Job = { task, idle, finish: (ok) => { if (!settled) { settled = true; settle(ok); } } };
    // Anything the user asked for beats ambient idle life.
    if (!idle && this.#running?.idle) this.#cancelRunning();
    this.#queue.push(job);
    this.#clock.clearTimeout(this.#idleTimer);
    this.#pump();
    return {
      done,
      cancel: () => {
        if (this.#running === job) this.#cancelRunning();
        else { this.#queue = this.#queue.filter((j) => j !== job); job.finish(false); }
      },
    };
  }

  #pump() {
    if (this.#running || this.#disposed) return;
    const job = this.#queue.shift();
    if (!job) { this.#armIdle(); return; }
    this.#running = job;
    this.#exiting = false;
    const end = (ok: boolean) => {
      if (this.#running !== job) return;
      this.#clearStep();
      this.#clock.clearTimeout(this.#killTimer);
      this.#running = null;
      job.finish(ok);
      this.#pump();
    };
    const t = job.task;
    if (t.kind === "play") this.#runPlay(t.name, t.timeoutMs, end);
    else if (t.kind === "speak") this.#runSpeak(t.text, t.hold, end);
    else this.#runMove(t.x, t.y, end);
  }

  #cancelRunning() {
    const job = this.#running;
    if (!job) return;
    this.#clearStep();
    this.#clock.clearTimeout(this.#killTimer);
    this.#running = null;
    this.#r.draw(REST_CELL);
    job.finish(false);
    this.#pump();
  }

  /** Schedule the running task's next step. One at a time, so pause/cancel are exact. */
  #after(ms: number, fn: () => void) {
    const step = { id: 0, fn };
    step.id = this.#clock.setTimeout(() => { if (this.#step === step) { this.#step = null; fn(); } }, ms);
    this.#step = step;
  }
  #clearStep() {
    if (this.#step) this.#clock.clearTimeout(this.#step.id);
    this.#step = null;
  }

  // ---- tasks ----
  #runPlay(name: string, timeoutMs: number, end: (ok: boolean) => void) {
    const frames = this.#data.animations[name]?.frames;
    if (!frames?.length) { end(false); return; }
    const last = frames.length - 1;
    if (this.#reduced) { this.#drawFrame(frames[last]); end(true); return; }
    if (timeoutMs > 0) this.#killTimer = this.#clock.setTimeout(() => { this.#exiting = true; }, timeoutMs);
    // Looping branches could spin forever once the exit flag is ignored by a frame without an exit branch.
    let budget = frames.length * 40;
    const show = (idx: number) => {
      const frame = frames[idx];
      this.#drawFrame(frame);
      if (frame?.sound) this.#r.sound(frame.sound);
      if (idx >= last || budget-- <= 0) { end(true); return; }
      // Rule 1: never faster than the clamped frame clock.
      this.#after(Math.max(frame?.duration ?? 100, this.frameMs), () => show(Math.min(this.#next(idx, frame), last)));
    };
    show(0);
  }
  #drawFrame(frame: AgentFrame | undefined) {
    const cell = frame?.images?.[0];
    if (cell) this.#r.draw(cell);
  }
  #next(idx: number, frame: AgentFrame | undefined): number {
    if (this.#exiting && frame?.exitBranch !== undefined) return frame.exitBranch;
    let rnd = this.#clock.random() * 100;
    for (const b of frame?.branching?.branches ?? []) {
      if (rnd <= b.weight) return b.frameIndex;
      rnd -= b.weight;
    }
    return idx + 1;
  }

  #runSpeak(text: string, hold: boolean, end: (ok: boolean) => void) {
    this.#clock.clearTimeout(this.#balloonTimer);
    const words = text.split(/(\s+)/);
    this.#r.announce(text);
    const finish = () => {
      if (!hold) this.#balloonTimer = this.#clock.setTimeout(() => this.#r.balloon(null), 3000 + text.length * 40);
      end(true);
    };
    if (this.#reduced) { this.#r.balloon(text); finish(); return; }
    // Rule 6: the balloon is on screen from the first tick; words then snap in on the frame clock.
    const tick = (i: number) => {
      this.#r.balloon(words.slice(0, i).join(""));
      if (i < words.length) this.#after(this.frameMs, () => tick(i + 1));
      else finish();
    };
    tick(1);
  }

  #runMove(x: number, y: number, end: (ok: boolean) => void) {
    const target = this.clamp(x, y);
    const from = { x: this.#x, y: this.#y };
    if (this.#reduced) { this.snapTo(target.x, target.y); end(true); return; }
    // Rule 4: exactly MOVE_JUMPS discrete positions, then a short freeze so the arrival reads as a snap.
    const jump = (i: number) => {
      const k = i / RULES.MOVE_JUMPS;
      this.#set(Math.round(from.x + (target.x - from.x) * k), Math.round(from.y + (target.y - from.y) * k));
      if (i < RULES.MOVE_JUMPS) this.#after(RULES.MOVE_GAP_MS, () => jump(i + 1));
      else this.#after(RULES.MOVE_FREEZE_MS, () => end(true));
    };
    jump(1);
  }

  // ---- position ----
  clamp(x: number, y: number): { x: number; y: number } {
    const vp = this.#r.viewport();
    const { w, h } = this.size;
    const m = RULES.EDGE_MARGIN;
    return { x: Math.round(Math.max(m, Math.min(x, vp.w - w - m))), y: Math.round(Math.max(m, Math.min(y, vp.h - h - m))) };
  }
  #set(x: number, y: number) { this.#x = x; this.#y = y; this.#r.place(x, y); }
  /** Instant reposition (viewport resize, restored position). Not queued. */
  snapTo(x: number, y: number) { const c = this.clamp(x, y); this.#set(c.x, c.y); }

  // Drag: pointer coordinates in, edge-clamped teleports out.
  dragStart(px: number, py: number) { this.#drag = { ox: px - this.#x, oy: py - this.#y }; this.closeBalloon(); }
  dragMove(px: number, py: number) { if (this.#drag) this.snapTo(px - this.#drag.ox, py - this.#drag.oy); }
  dragEnd() { this.#drag = null; }
  get dragging() { return this.#drag !== null; }

  // ---- ambient life ----
  #quiet() { return this.#disposed || this.#paused || this.#hidden || this.#reduced; }
  #armBlink() {
    this.#clock.clearTimeout(this.#blinkTimer);
    if (this.#quiet()) return;
    const wait = RULES.BLINK_MIN_MS + this.#clock.random() * (RULES.BLINK_MAX_MS - RULES.BLINK_MIN_MS);
    this.#blinkTimer = this.#clock.setTimeout(() => this.#blink(0), wait);
  }
  #blink(i: number) {
    // Only while idle: a blink must never stomp a running animation or a drag.
    if (this.#quiet() || this.#running || this.#drag) { this.#armBlink(); return; }
    const cell = BLINK_CELLS[i];
    if (!cell || i >= RULES.BLINK_FRAMES) { this.#r.draw(REST_CELL); this.#armBlink(); return; }
    this.#r.draw(cell);
    this.#blinkTimer = this.#clock.setTimeout(() => this.#blink(i + 1), RULES.BLINK_FRAME_MS);
  }
  #armIdle() {
    this.#clock.clearTimeout(this.#idleTimer);
    if (this.#quiet()) return;
    const wait = RULES.IDLE_MIN_MS + this.#clock.random() * (RULES.IDLE_MAX_MS - RULES.IDLE_MIN_MS);
    this.#idleTimer = this.#clock.setTimeout(() => {
      const idles = this.animations().filter((a) => a.startsWith("Idle"));
      const pick = idles[Math.floor(this.#clock.random() * idles.length)];
      if (!pick || this.#running || this.#drag) { this.#armIdle(); return; }
      this.#enqueue({ kind: "play", name: pick, timeoutMs: 8000 }, true);
    }, wait);
  }

  // ---- lifecycle ----
  /** Tab hidden: every timer stops; the running task keeps its place. */
  pause() {
    if (this.#paused) return;
    this.#paused = true;
    this.#clock.clearTimeout(this.#blinkTimer);
    this.#clock.clearTimeout(this.#idleTimer);
    if (this.#step) this.#clock.clearTimeout(this.#step.id);
  }
  resume() {
    if (!this.#paused || this.#disposed) return;
    this.#paused = false;
    const step = this.#step;
    if (step) step.id = this.#clock.setTimeout(() => { if (this.#step === step) { this.#step = null; step.fn(); } }, this.frameMs);
    this.#armBlink();
    if (!this.#running) this.#armIdle();
  }
  get paused() { return this.#paused; }
  setHidden(hidden: boolean) {
    this.#hidden = hidden;
    if (hidden) { this.stop(); this.#clock.clearTimeout(this.#blinkTimer); this.#clock.clearTimeout(this.#idleTimer); }
    else { this.#armBlink(); this.#armIdle(); }
  }
  dispose() {
    this.stop();
    this.#disposed = true;
    for (const id of [this.#blinkTimer, this.#idleTimer, this.#balloonTimer, this.#killTimer]) this.#clock.clearTimeout(id);
  }
}
