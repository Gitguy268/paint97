// DOM renderer for ClippyEngine: a focusable sprite button, a balloon and a
// polite live region. Positions are whole pixels set from JS; nothing here animates.
import { type Cell, type ClippyEngine, type Clock, type Renderer } from "./engine.ts";
import { safeAssetUrl, type ClippyAssets } from "./assets.ts";
import "./clippy.css";

export const browserClock: Clock = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  random: Math.random,
};

export type DomRenderer = Renderer & {
  /** Wire pointer drag, viewport clamping and tab-visibility pausing to an engine. */
  attach(engine: ClippyEngine, on: { click(): void; moved?(x: number, y: number): void }): void;
  setLabel(label: string): void;
  setVisible(on: boolean): void;
  destroy(): void;
};

export function createDomRenderer(assets: ClippyAssets, opts: { volume: () => number; bottomInset?: number }): DomRenderer {
  const [fw, fh] = assets.data.framesize;
  let scale = 1;
  let sheet = { w: 0, h: 0 };
  const audio = new Map<string, HTMLAudioElement>();
  const cleanup: (() => void)[] = [];

  const root = document.createElement("button");
  root.type = "button";
  root.className = "clippy";
  const sprite = document.createElement("span");
  sprite.className = "clippy-sprite";
  // JSON.stringify escapes quotes/backslashes, so the URL can't break out of url("").
  sprite.style.backgroundImage = `url(${JSON.stringify(safeAssetUrl(assets.mapUrl) ?? "")})`;
  root.append(sprite);
  const balloon = document.createElement("div");
  balloon.className = "clippy-balloon";
  balloon.setAttribute("aria-hidden", "true"); // the live region below carries the text once, whole
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.body.append(root, balloon, live);

  const resize = () => {
    sprite.style.width = `${fw * scale}px`;
    sprite.style.height = `${fh * scale}px`;
    if (sheet.w) sprite.style.backgroundSize = `${sheet.w * scale}px ${sheet.h * scale}px`;
  };
  const img = new Image();
  img.onload = () => { sheet = { w: img.naturalWidth, h: img.naturalHeight }; resize(); };
  img.src = safeAssetUrl(assets.mapUrl) ?? "";

  const placeBalloon = () => {
    if (!balloon.classList.contains("show")) return;
    const r = root.getBoundingClientRect();
    const bw = Math.min(240, window.innerWidth - 16);
    balloon.style.maxWidth = `${bw}px`;
    const left = Math.max(8, Math.min(Math.round(r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 8));
    const above = Math.round(r.top - balloon.offsetHeight - 12);
    balloon.classList.toggle("below", above < 8);
    balloon.style.left = `${left}px`;
    balloon.style.top = `${above < 8 ? Math.round(r.bottom + 12) : above}px`;
  };

  return {
    draw(cell: Cell) { sprite.style.backgroundPosition = `${-cell[0] * scale}px ${-cell[1] * scale}px`; },
    place(x, y) { root.style.left = `${x}px`; root.style.top = `${y}px`; placeBalloon(); },
    setScale(s) { scale = s; resize(); },
    balloon(text) {
      balloon.classList.toggle("show", text !== null);
      if (text !== null) { balloon.textContent = text; placeBalloon(); }
    },
    announce(text) { live.textContent = text; },
    sound(id) {
      const vol = opts.volume();
      const uri = assets.sounds[id];
      if (!uri || vol <= 0) return;
      try {
        let a = audio.get(id);
        if (!a) { a = new Audio(uri); audio.set(id, a); }
        a.volume = vol;
        void a.play().catch(() => undefined); // autoplay policy: silence is fine
      } catch { /* audio must never break the frame loop */ }
    },
    viewport: () => ({ w: window.innerWidth, h: window.innerHeight - (opts.bottomInset ?? 0) }),
    setLabel(label) { root.setAttribute("aria-label", label); },
    setVisible(on) { root.style.display = on ? "" : "none"; if (!on) balloon.classList.remove("show"); },

    attach(engine, on) {
      let moved = false;
      let down: { x: number; y: number } | null = null;
      const listen = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, type: K | "resize" | "visibilitychange", fn: (e: HTMLElementEventMap[K]) => void) => {
        el.addEventListener(type, fn as EventListener);
        cleanup.push(() => el.removeEventListener(type, fn as EventListener));
      };
      listen(root, "pointerdown", (e) => {
        if (e.button !== 0) return;
        down = { x: e.clientX, y: e.clientY }; moved = false;
        engine.dragStart(e.clientX, e.clientY);
        try { root.setPointerCapture(e.pointerId); } catch { /* synthetic events have no capture */ }
      });
      listen(root, "pointermove", (e) => {
        if (!down) return;
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 3) moved = true;
        if (moved) engine.dragMove(e.clientX, e.clientY);
      });
      const up = () => { if (!down) return; down = null; engine.dragEnd(); if (moved) on.moved?.(engine.position.x, engine.position.y); };
      listen(root, "pointerup", up);
      listen(root, "pointercancel", up);
      // A drag must not also count as a click; keyboard activation (Enter/Space) arrives here too.
      listen(root, "click", () => { if (moved) { moved = false; return; } on.click(); });
      // Arrow keys nudge Clippy for people who can't drag.
      listen(root, "keydown", (e) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!d) return;
        e.preventDefault();
        const p = engine.position;
        engine.snapTo(p.x + d[0]! * 16, p.y + d[1]! * 16);
        on.moved?.(engine.position.x, engine.position.y);
      });
      listen(balloon, "click", () => engine.closeBalloon());
      listen(window, "resize", () => engine.snapTo(engine.position.x, engine.position.y));
      listen(document, "visibilitychange", () => (document.hidden ? engine.pause() : engine.resume()));
      if (document.hidden) engine.pause();
    },
    destroy() {
      cleanup.forEach((fn) => fn());
      root.remove(); balloon.remove(); live.remove();
    },
  };
}
