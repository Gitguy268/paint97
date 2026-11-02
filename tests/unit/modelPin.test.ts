// CI never loads the model: these are what stop a bad manifest or a swapped engine
// build from silently breaking Ask Clippy.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { planRanges, sha256Hex, type ModelManifest } from "../../src/lib/localAi/modelFiles.ts";

const manifest = JSON.parse(fs.readFileSync("src/lib/localAi/minicpm-v.json", "utf8")) as ModelManifest;

test("the model is pinned to a commit and its ranges tile each file exactly", () => {
  assert.match(manifest.revision, /^[0-9a-f]{40}$/, "a commit, not a branch");
  const ranges = planRanges(manifest);
  assert.deepEqual(new Set(ranges.map((r) => r.key)).size, ranges.length, "every range has its own cache key");
  for (const [i, [name, file]] of Object.entries(manifest.files).entries()) {
    const own = ranges.filter((r) => r.file === i);
    let at = 0;
    for (const r of own) {
      assert.equal(r.start, at, `${name}: ranges are contiguous`);
      assert.equal(r.url, `https://huggingface.co/${manifest.repo}/resolve/${manifest.revision}/${name}`);
      assert.match(r.sha256, /^[0-9a-f]{64}$/);
      at += r.size;
    }
    assert.equal(at, file.totalSize, `${name}: the ranges add up to the file`);
  }
  // The language model first, then the image projector: the order wllama is handed them in.
  assert.deepEqual(Object.keys(manifest.files), ["MiniCPM-V-4_7-1B-Q4_K_M.gguf", "mmproj-model-f16-4x.gguf"]);
});

test("sha256Hex is the standard digest", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the vendored engine is a build that can load MiniCPM-V 4.7", () => {
  // The 3.8.1 release lacks this projector type; only a master build after llama.cpp #29416 has it.
  for (const file of ["wllama.wasm", "wllama-compat.wasm"]) {
    const bytes = fs.readFileSync(`public/vendor/wllama/${file}`);
    assert.ok(bytes.includes("minicpmv4_7"), `${file} knows minicpmv4_7`);
  }
});
