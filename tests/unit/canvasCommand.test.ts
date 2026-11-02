// Unit tests for the <canvas> command path in src/lib/localAi/chat.ts — the
// block arrives as raw model output, so the validator must fail closed on
// floods, junk types, off-palette colours and prototype-pollution shapes,
// and clamp anything numeric instead of trusting it.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commandToSkeleton,
  describeCommand,
  splitCanvasCommand,
  validateCanvasCommand,
} from "../../src/lib/localAi/chat.ts";

const rectJson = (over: object = {}): string =>
  JSON.stringify({
    tool: "rectangle",
    x: 100,
    y: 80,
    w: 300,
    h: 200,
    stroke: "#1e1e1e",
    fill: "#a5d8ff",
    text: "",
    ...over,
  });

const rectCmd = () => validateCanvasCommand(JSON.parse(rectJson()));

test("splitCanvasCommand extracts one valid block and keeps the prose", () => {
  const { text, command } = splitCanvasCommand(`Sure thing! <canvas>${rectJson()}</canvas> Done.`);
  assert.equal(text, "Sure thing! Done.");
  assert.deepEqual(command, {
    tool: "rectangle",
    x: 100,
    y: 80,
    w: 300,
    h: 200,
    stroke: "#1e1e1e",
    fill: "#a5d8ff",
    text: "",
  });
});

test("a circle is accepted as an ellipse; other unknown tools are refused", () => {
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ tool: "circle" })))?.tool, "ellipse");
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ tool: "star" }))), null);
});

test("replies without a block pass through untouched", () => {
  const { text, command } = splitCanvasCommand("Just a normal reply.");
  assert.equal(text, "Just a normal reply.");
  assert.equal(command, null);
});

test("more than one block is a flood: every block drops, no command", () => {
  const { text, command } = splitCanvasCommand(
    `<canvas>${rectJson()}</canvas> and <canvas>${rectJson({ tool: "ellipse" })}</canvas>`,
  );
  assert.equal(command, null);
  assert.equal(text, "and", "both blocks stripped from the display");
});

test("an unclosed block (truncated reply) is cut from the display", () => {
  const { text, command } = splitCanvasCommand('Look: <canvas>{"tool":"rect');
  assert.equal(command, null);
  assert.equal(text, "Look:", "no raw JSON leaks into the transcript");
});

test("malformed JSON inside a well-formed block drops the command", () => {
  const { text, command } = splitCanvasCommand("<canvas>{not json}</canvas>");
  assert.equal(command, null);
  assert.equal(text, "");
});

test("a block longer than the payload cap is rejected before parsing", () => {
  const huge = rectJson({ text: "x".repeat(600) });
  assert.ok(huge.length > 500);
  const { command } = splitCanvasCommand(`<canvas>${huge}</canvas>`);
  assert.equal(command, null);
});

test("unknown tools are rejected", () => {
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ tool: "freedraw" }))), null);
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ tool: "image" }))), null);
});

test("unknown keys fail closed — including __proto__ and constructor", () => {
  const evil = JSON.parse(
    `${rectJson().slice(0, -1)},"__proto__":{"polluted":true}}`,
  );
  assert.equal(validateCanvasCommand(evil), null);
  // JSON.parse installs __proto__ as an ordinary own key (that is exactly
  // why the own-key check above can see it and reject it).
  assert.equal(Object.keys(evil).includes("__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  const ctor = JSON.parse(
    `${rectJson().slice(0, -1)},"constructor":{"prototype":{"polluted":1}}}`,
  );
  assert.equal(validateCanvasCommand(ctor), null);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("non-finite coordinates are rejected", () => {
  // 1e999 overflows the JSON number range to Infinity.
  const raw = JSON.parse(rectJson().replace('"x":100', '"x":1e999'));
  assert.equal(validateCanvasCommand(raw), null);
});

test("coordinates outside sane bounds are clamped, not trusted", () => {
  const cmd = validateCanvasCommand(JSON.parse(rectJson({ x: 99999999, y: -88888888 })));
  assert.equal(cmd?.x, 50000);
  assert.equal(cmd?.y, -50000);
});

test("sizes clamp into range, keep their sign and never hit zero", () => {
  const neg = validateCanvasCommand(JSON.parse(rectJson({ w: -320, h: 0 })));
  assert.equal(neg?.w, -320, "negative width keeps its direction");
  assert.equal(neg?.h, 1, "zero height floors at 1");
  const huge = validateCanvasCommand(JSON.parse(rectJson({ w: 999999, h: -999999 })));
  assert.equal(huge?.w, 5000);
  assert.equal(huge?.h, -5000);
});

test("off-palette colours are rejected (case-sensitively)", () => {
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ stroke: "#ff0000" }))), null);
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ fill: "blue" }))), null);
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ stroke: "#1E1E1E" }))), null);
});

test("text rules: only for tool text, non-empty, capped at 200 chars", () => {
  assert.equal(
    validateCanvasCommand(JSON.parse(rectJson({ tool: "text", text: "" }))),
    null,
    "text tool needs a label",
  );
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ text: "hi" }))), null, "rect stays label-free");
  assert.equal(
    validateCanvasCommand(JSON.parse(rectJson({ text: "x".repeat(201) }))),
    null,
    "label cap",
  );
  const ok = validateCanvasCommand(JSON.parse(rectJson({ tool: "text", text: "Hi there" })));
  assert.equal(ok?.text, "Hi there");
});

test("non-object payloads and wrong value types are rejected", () => {
  assert.equal(validateCanvasCommand(null), null);
  assert.equal(validateCanvasCommand("rectangle"), null);
  assert.equal(validateCanvasCommand([]), null);
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ x: "100" }))), null, "no numeric strings");
  assert.equal(validateCanvasCommand(JSON.parse(rectJson({ tool: 42 }))), null);
});

test("commandToSkeleton builds a bounding-box shape for closed tools", () => {
  assert.deepEqual(commandToSkeleton(rectCmd()!), {
    type: "rectangle",
    x: 100,
    y: 80,
    width: 300,
    height: 200,
    strokeColor: "#1e1e1e",
    backgroundColor: "#a5d8ff",
  });
});

test("commandToSkeleton builds a signed segment for linear tools", () => {
  const line = validateCanvasCommand(
    JSON.parse(rectJson({ tool: "line", w: -320, h: 120, fill: "transparent" })),
  )!;
  assert.deepEqual(commandToSkeleton(line), {
    type: "line",
    x: 100,
    y: 80,
    width: 320,
    height: 120,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    points: [[0, 0], [-320, 120]],
  });
});

test("commandToSkeleton builds a labelled text element", () => {
  const text = validateCanvasCommand(
    JSON.parse(rectJson({ tool: "text", text: "Hi!", stroke: "#e03131" })),
  )!;
  assert.deepEqual(commandToSkeleton(text), {
    type: "text",
    x: 100,
    y: 80,
    text: "Hi!",
    strokeColor: "#e03131",
    fontSize: 24,
  });
});

test("describeCommand phrases the confirm dialog for each shape family", () => {
  assert.equal(
    describeCommand(rectCmd()!),
    "Clippy wants to draw a rectangle at 100, 80 (300×200).",
  );
  const arrow = validateCanvasCommand(JSON.parse(rectJson({ tool: "arrow", w: -50, h: 60 })))!;
  assert.equal(describeCommand(arrow), "Clippy wants to draw an arrow at 100, 80.");
  const label = validateCanvasCommand(
    JSON.parse(rectJson({ tool: "text", text: "Hello" })),
  )!;
  assert.equal(describeCommand(label), 'Clippy wants to add the text "Hello" at 100, 80.');
});
