// Unit tests for src/lib/share.ts — share links carry scene data through an
// untrusted transport (any URL), so round-trip fidelity, the size cap and
// hostile-input rejection are security-relevant and must hold without a
// browser (Node ships CompressionStream/Blob/Response globals).
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SHARE_LENGTH, SHARE_PREFIX, decodeScene, encodeScene } from "../../src/lib/share.ts";

const scene = (text: string) => ({
  elements: [{ id: "el1", type: "rectangle", x: 1, y: 2, version: 1, text }],
  appState: { viewBackgroundColor: "#fff", gridSize: null },
});

test("round-trips a scene through encode/decode", async () => {
  const hash = await encodeScene(scene("hello").elements, scene("hello").appState);
  assert.ok(hash && hash.startsWith(SHARE_PREFIX));
  const back = await decodeScene(hash);
  assert.ok(back);
  assert.deepEqual(back.elements, scene("hello").elements);
  assert.deepEqual(back.appState, scene("hello").appState);
});

test("encoded hash is URL-safe base64 and under the cap", async () => {
  const hash = await encodeScene(scene("x").elements, scene("x").appState);
  assert.ok(hash);
  const payload = hash.slice(SHARE_PREFIX.length);
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.ok(hash.length <= MAX_SHARE_LENGTH);
});

test("keeps unicode and emoji intact", async () => {
  const elements = [{ id: "u", type: "text", text: "héllo → 🎨 日本語 \"quotes\" \\backslashes" }];
  const hash = await encodeScene(elements, {});
  assert.ok(hash);
  const back = await decodeScene(hash);
  assert.ok(back);
  assert.deepEqual(back.elements, elements);
});

test("empty scene round-trips", async () => {
  const hash = await encodeScene([], {});
  assert.ok(hash);
  const back = await decodeScene(hash);
  assert.deepEqual(back, { elements: [], appState: {} });
});

test("drops collaborators from the shared appState", async () => {
  const hash = await encodeScene([], { collaborators: { evil: 1 }, viewBackgroundColor: "#000" });
  assert.ok(hash);
  const back = await decodeScene(hash);
  assert.ok(back);
  assert.deepEqual(back.appState, { viewBackgroundColor: "#000" });
});

test("refuses scenes whose encoded form exceeds the 32 KB cap", async () => {
  // Incompressible filler: seeded LCG hex so the size overshoot is stable
  // (hex still halves under deflate, hence the generous length).
  let s = 1;
  const rand = () => ((s = (s * 48271) % 2147483647), s.toString(16));
  const noise = Array.from({ length: 12_000 }, rand).join("");
  const hash = await encodeScene([{ id: "big", type: "text", text: noise }], {});
  assert.equal(hash, null);
});

test("refuses to compress oversized payloads", async () => {
  const hash = await encodeScene([{ id: "huge", type: "text", text: "a".repeat(4 * 1024 * 1024) }], {});
  assert.equal(hash, null);
});

test("rejects malformed, truncated and non-URL input", async () => {
  assert.equal(await decodeScene(""), null);
  assert.equal(await decodeScene("#other=abc"), null);
  assert.equal(await decodeScene(SHARE_PREFIX), null);
  assert.equal(await decodeScene(SHARE_PREFIX + "not base64 !!"), null);
  assert.equal(await decodeScene(SHARE_PREFIX + "AAAA"), null); // valid base64, not deflate
  assert.equal(await decodeScene(SHARE_PREFIX + "A".repeat(MAX_SHARE_LENGTH + 1)), null);
});

test("rejects valid archives that are not valid scenes", async () => {
  // Build well-formed #scene= hashes whose *contents* violate parseSceneJson.
  const bad = async (payload: unknown): Promise<string> => {
    const json = JSON.stringify(payload);
    const buf = await new Response(
      new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer();
    let bin = "";
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return SHARE_PREFIX + b64;
  };

  assert.equal(await decodeScene(await bad("not json at all")), null);
  assert.equal(await decodeScene(await bad({ elements: "x" })), null);
  assert.equal(await decodeScene(await bad({ elements: [1, 2, 3] })), null);
  assert.equal(await decodeScene(await bad({ elements: [], appState: "nope" })), null);
  assert.equal(
    await decodeScene(await bad({ elements: Array.from({ length: 100_001 }, () => ({})), appState: {} })),
    null,
  );
});
