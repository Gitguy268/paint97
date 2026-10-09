// Unit tests for src/lib/frameExport.ts — the frame layout is a hard
// contract (the e2e suite derives its PNG-size assertions from FRAME) and
// the painter must drive a Canvas2D-compatible context without touching
// the DOM, which keeps it testable in Node.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAME, computeFrameLayout, paintFrame } from "../../src/lib/frameExport.ts";

test("layout wraps the drawing with bevel, title, menu and status", () => {
  const l = computeFrameLayout(640, 360);
  assert.equal(l.width, 640 + FRAME.border * 2);
  assert.equal(l.height, FRAME.border + FRAME.titleH + FRAME.menuH + 360 + FRAME.statusH + FRAME.border);
  assert.deepEqual(l.inner, {
    x: FRAME.border,
    y: FRAME.border + FRAME.titleH + FRAME.menuH,
    width: 640,
    height: 360,
  });
  // Panels stack without overlap and stay inside the canvas.
  for (const r of [l.title, l.menu, l.inner, l.status]) {
    assert.ok(r.x >= 0 && r.y >= 0, JSON.stringify(r));
    assert.ok(r.x + r.width <= l.width && r.y + r.height <= l.height, JSON.stringify(r));
  }
  assert.equal(l.title.y + l.title.height, l.menu.y, "menu must follow the title bar");
  assert.equal(l.menu.y + l.menu.height, l.inner.y, "canvas must follow the menu strip");
  assert.equal(l.inner.y + l.inner.height, l.status.y, "status must follow the canvas");
  assert.equal(l.status.y + l.status.height + FRAME.border, l.height, "bevel closes at the bottom");
});

test("tiny or wonky drawing sizes clamp to at least one pixel", () => {
  const tiny = computeFrameLayout(0.4, -10);
  assert.equal(tiny.inner.width, 1);
  assert.equal(tiny.inner.height, 1);
  assert.equal(tiny.width, 1 + FRAME.border * 2);
  const rounded = computeFrameLayout(640.6, 360.4);
  assert.equal(rounded.inner.width, 641);
  assert.equal(rounded.inner.height, 360);
});

type Call = { op: string; args: unknown[] };

function stubCtx() {
  const calls: Call[] = [];
  const rec = (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    fillStyle: "",
    font: "",
    textBaseline: "",
    textAlign: "",
    fillRect: rec("fillRect"),
    fillText: rec("fillText"),
    measureText: (t: string) => ({ width: [...t].length * 7 }),
    createLinearGradient: (_x0: number, _y0: number, _x1: number, _y1: number) => {
      calls.push({ op: "gradient", args: [] });
      return {
        addColorStop: (offset: number, color: string) => {
          calls.push({ op: "stop", args: [offset, color] });
        },
      };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

test("paintFrame draws the chrome in bounds with all captions", () => {
  const l = computeFrameLayout(400, 300);
  const { ctx, calls } = stubCtx();
  paintFrame(ctx, l, {
    title: "Paint97 — untitled.excalidraw",
    status: "2 objects · Paint97",
    menu: ["File", "Edit", "Stickers", "View", "Help"],
  });

  const fills = calls.filter((c) => c.op === "fillRect");
  assert.ok(fills.length > 20, `expected bevel painting, got ${fills.length} fillRects`);
  for (const c of fills) {
    const [x, y, w, h] = c.args as [number, number, number, number];
    assert.ok(
      x >= 0 && y >= 0 && w >= 0 && h >= 0 && x + w <= l.width && y + h <= l.height,
      `out-of-bounds rect ${x},${y},${w},${h} in ${l.width}×${l.height}`,
    );
  }

  const texts = calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
  assert.ok(texts.includes("Paint97 — untitled.excalidraw"), "title caption missing");
  assert.ok(texts.includes("2 objects · Paint97"), "status caption missing");
  for (const label of ["File", "Edit", "Stickers", "View", "Help"]) {
    assert.ok(texts.includes(label), `menu label ${label} missing`);
  }
  const buttons = texts.filter((t) => ["—", "□", "×"].includes(t));
  assert.equal(buttons.length, 3, `window buttons missing: ${JSON.stringify(texts)}`);

  assert.equal(calls.filter((c) => c.op === "gradient").length, 1, "title bar needs its gradient");
  assert.equal(calls.filter((c) => c.op === "stop").length, 2, "gradient needs both colour stops");
});

test("paintFrame ellipsises a caption that cannot fit", () => {
  const l = computeFrameLayout(60, 40);
  const { ctx, calls } = stubCtx();
  paintFrame(ctx, l, {
    title: "A very very long window caption that will never fit into sixty pixels of title bar",
    status: "Also far too long for the tiny status field of a sixty pixel wide frame",
    menu: ["File"],
  });
  const texts = calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
  assert.ok(texts.some((t) => t.endsWith("…")), `no ellipsis in ${JSON.stringify(texts)}`);
  for (const t of texts) assert.ok(t.includes("…") || t.length <= 12, `untruncated caption: ${t}`);
});
