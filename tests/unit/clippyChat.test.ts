// Unit tests for src/lib/localAi/chat.ts — the scene snapshot fed to the
// model, prompt assembly, history trimming (strict chat templates require
// user/assistant alternation) and streamed-reply cleanup.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATION,
  buildSystemPrompt,
  cleanReply,
  DIAGRAM_GENERATION,
  extractMermaid,
  messagesForRequest,
  summarizeScene,
  trimHistory,
  type ChatMsg,
} from "../../src/lib/localAi/chat.ts";

const turns = (n: number, chars = 0): ChatMsg[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: i % 2 === 0 ? `q${i}${"x".repeat(chars)}` : `a${i}${"x".repeat(chars)}`,
  }));

test("summarizeScene is null for an empty canvas", () => {
  assert.equal(summarizeScene([]), null);
});

test("summarizeScene counts by kind, most frequent first", () => {
  const els = [
    { type: "rectangle" },
    { type: "rectangle" },
    { type: "arrow" },
    { type: "text" },
    { type: "freedraw" },
  ];
  assert.equal(summarizeScene(els), "5 objects: 2 rectangles, 1 arrow, 1 text label, 1 pen stroke");
});

test("summarizeScene handles singular, unknown and missing types", () => {
  assert.equal(summarizeScene([{ type: "ellipse" }]), "1 object: 1 ellipse");
  assert.equal(summarizeScene([{ type: "zigzag" }]), "1 object: 1 zigzag");
  assert.equal(summarizeScene([{ type: "zigzag" }, { type: "zigzag" }]), "2 objects: 2 zigzags");
  assert.equal(summarizeScene([{}]), "1 object: 1 object");
});

test("buildSystemPrompt states the persona and adds drawing context", () => {
  const plain = buildSystemPrompt();
  assert.match(plain, /^You are Clippy/);
  assert.ok(!plain.includes("Current drawing"));
  const withScene = buildSystemPrompt("3 objects: 3 rectangles");
  assert.match(withScene, /^You are Clippy/);
  assert.match(withScene, /Current drawing on the canvas: 3 objects: 3 rectangles\./);
});

test("buildSystemPrompt teaches the strict canvas block", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /exactly one block/);
  assert.match(prompt, /<canvas>/);
  assert.match(prompt, /when the user asks you to draw/);
  // The prompt's promises are the validator's contract.
  assert.match(prompt, /-50000…50000/);
  assert.match(prompt, /#1e1e1e \(black\)/);
});

test("trimHistory keeps the newest turns and never breaks alternation", () => {
  const trimmed = trimHistory(turns(10));
  assert.equal(trimmed.length, 8);
  assert.equal(trimmed[0]?.role, "user");
  assert.equal(trimmed.at(-1)?.content, "a9");

  const chatty = trimHistory(turns(10, 2000));
  assert.ok(chatty.length < 8);
  assert.equal(chatty.length % 2, 0, "pairs only");
  assert.equal(isAlternating(chatty), true);

  // Unaligned input (starts with an assistant turn) is left untouched
  // rather than sliced into something the template would reject.
  const unaligned = turns(3).slice(1);
  assert.deepEqual(trimHistory(unaligned), unaligned);
});

// A strict chat template raises when a conversation doesn't start with a user
// turn (after the system prompt) or two same-role turns sit adjacent.
function isAlternating(msgs: ChatMsg[]): boolean {
  if (msgs[0]?.role !== "user") return false;
  return msgs.every((m, i) => m.role === (i % 2 === 0 ? "user" : "assistant"));
}

test("messagesForRequest always ends on a user turn", () => {
  const done = [turns(2)[0]!, turns(2)[1]!, { role: "user" as const, content: "next" }];
  assert.equal(messagesForRequest(done).length, 3);
  assert.equal(messagesForRequest(done).at(-1)?.role, "user");

  // An in-progress assistant placeholder (or an empty draft) is never a
  // prompt — it and anything after the last question is dropped.
  const streaming = [...turns(2), { role: "assistant" as const, content: "" }];
  const out = messagesForRequest(streaming);
  assert.equal(out.length, 1, "placeholder and the answered turn removed");
  assert.equal(out.at(-1)?.role, "user");
});

test("cleanReply cuts at the next template marker and trims edges", () => {
  assert.equal(cleanReply("  Hello there.\n\n"), "Hello there.");
  assert.equal(
    cleanReply("Short answer.<start_of_turn>user\nWhy?"),
    "Short answer.",
  );
  assert.equal(cleanReply("<start_of_turn>user\njunk"), "");
});

test("generation stays within the tiny-model budget", () => {
  assert.ok(GENERATION.max_tokens > 0 && GENERATION.max_tokens <= 200);
  assert.ok(GENERATION.temperature > 0 && GENERATION.temperature <= 1);
});

test("extractMermaid takes a fenced block first, else the code from its first diagram line", () => {
  assert.equal(extractMermaid("Sure!\n```mermaid\nflowchart TD\n  A --> B\n```\nDone."), "flowchart TD\n  A --> B");
  assert.equal(extractMermaid("Here you go:\nsequenceDiagram\n  A->>B: hi"), "sequenceDiagram\n  A->>B: hi");
  // An unclosed fence (a reply cut at max_tokens) still yields what arrived.
  assert.equal(extractMermaid("```\ngraph LR\n  A --> B"), "graph LR\n  A --> B");
  // A misspelt info string is still a fence, so its closing ``` never reaches the parser.
  assert.equal(extractMermaid("```merymaid\npie\n  \"a\" : 1\n```"), 'pie\n  "a" : 1');
  assert.equal(extractMermaid("I cannot draw that."), null);
  assert.equal(extractMermaid("a flowchart is a kind of diagram"), null, "the keyword must open a line");
});

test("extractMermaid caps what reaches the parser", () => {
  const long = "flowchart TD\n" + Array.from({ length: 500 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n");
  const code = extractMermaid(long)!;
  assert.equal(code.split("\n").length, 200);
  assert.ok(extractMermaid("flowchart TD\n" + "A".repeat(10_000))!.length <= 4000);
});

test("diagrams are greedy and get room for a long answer", () => {
  assert.equal(DIAGRAM_GENERATION.temperature, 0);
  assert.ok(DIAGRAM_GENERATION.max_tokens >= 1024);
  assert.ok(DIAGRAM_GENERATION.max_tokens > GENERATION.max_tokens);
});
