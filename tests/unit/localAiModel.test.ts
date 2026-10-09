// Unit tests for src/lib/localAi/model.ts — URL building, manifest
// validation, integrity checks and the resumable install-into-cache flow.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ModelInstallError,
  deleteModel,
  installModel,
  isModelInstalled,
  partUrl,
  readModelBlob,
  sha256Hex,
  validateManifest,
  type ModelManifest,
  type PartCache,
} from "../../src/lib/localAi/model.ts";

const fakeCache = () => {
  const store = new Map<string, Response>();
  return {
    store,
    cache: {
      match(url: string) {
        const hit = store.get(url);
        return Promise.resolve(hit ? hit.clone() : undefined);
      },
      put(url: string, res: Response) {
        store.set(url, res);
        return Promise.resolve();
      },
      delete(url: string) {
        return Promise.resolve(store.delete(url));
      },
    } satisfies PartCache,
  };
};

const bytesOf = (n: number, fill: number) => new Uint8Array(n).fill(fill);

const manifestOf = async (sizes: number[]): Promise<ModelManifest> => {
  const parts: { file: string; bytes: number; sha256: string }[] = [];
  for (const [i, size] of sizes.entries()) {
    const bytes = bytesOf(size, i + 1);
    parts.push({
      file: `fake-${i}.part`,
      bytes: size,
      sha256: await sha256Hex(bytes),
    });
  }
  const totalBytes = sizes.reduce((a, b) => a + b, 0);
  return {
    model: "Fake",
    quant: "Q4_K_M",
    file: "fake.gguf",
    source: "https://example.test",
    license: "test",
    repo: "owner/repo",
    ref: "main",
    totalBytes,
    sha256: "0".repeat(64),
    parts,
  };
};

// Deterministic bytes per part so the fake server can serve them again.
const serveParts = (manifest: ModelManifest) => {
  const bodies = manifest.parts.map((p, i) => bytesOf(p.bytes, i + 1));
  const calls: string[] = [];
  const fetchImpl = (url: string): Promise<Response> => {
    calls.push(url);
    const index = manifest.parts.findIndex(
      (p) => url === partUrl(manifest.repo, manifest.ref, p.file),
    );
    if (index === -1) return Promise.resolve(new Response("nope", { status: 404 }));
    return Promise.resolve(new Response(bodies[index], { status: 200 }));
  };
  return { calls, fetchImpl };
};

test("partUrl targets raw.githubusercontent.com on the pinned ref", () => {
  assert.equal(
    partUrl("gitguy268/win97-excalidraw", "main", "model.part"),
    "https://raw.githubusercontent.com/gitguy268/win97-excalidraw/main/models/model.part",
  );
});

test("sha256Hex matches the known vector for 'abc'", async () => {
  const input = new TextEncoder().encode("abc");
  assert.equal(
    await sha256Hex(input),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("validateManifest accepts a well-formed manifest", async () => {
  assert.equal(validateManifest(await manifestOf([16, 32])), null);
});

test("validateManifest rejects structural problems", async () => {
  const good = await manifestOf([16, 32]);
  assert.match(String(validateManifest({ ...good, parts: [] })), /no parts/);
  assert.match(String(validateManifest({ ...good, totalBytes: 7 })), /sum to 48/);
  assert.match(
    String(validateManifest({ ...good, repo: "" })),
    /missing repo\/ref/,
  );
  assert.match(
    String(validateManifest({ ...good, parts: [{ file: "x", bytes: 48, sha256: "beef" }] })),
    /bad sha256/,
  );
});

test("isModelInstalled is false on an empty cache and true once complete", async () => {
  const manifest = await manifestOf([16, 32]);
  const { cache } = fakeCache();
  assert.equal(await isModelInstalled(cache, manifest), false);
  await installModel({ cache, manifest, fetchImpl: serveParts(manifest).fetchImpl });
  assert.equal(await isModelInstalled(cache, manifest), true);
});

test("installModel downloads each part once, verifies it, and reports progress", async () => {
  const manifest = await manifestOf([16, 32, 48]);
  const { cache } = fakeCache();
  const { calls, fetchImpl } = serveParts(manifest);
  const seen: number[] = [];
  await installModel({
    cache,
    manifest,
    fetchImpl,
    onProgress: (p) => seen.push(p.loadedBytes),
  });
  assert.equal(calls.length, 3);
  assert.equal(seen.at(-1), manifest.totalBytes);
  // Progress is cumulative, never exceeds the total, and touches every
  // part boundary along the way.
  assert.ok(seen.every((n) => n <= manifest.totalBytes));
  let prefix = 0;
  for (const part of manifest.parts) {
    prefix += part.bytes;
    assert.ok(seen.includes(prefix), `no progress event at ${prefix}`);
  }

  // Second run: everything cached → no network at all.
  const rerun = serveParts(manifest);
  await installModel({ cache, manifest, fetchImpl: rerun.fetchImpl });
  assert.equal(rerun.calls.length, 0);
});

test("installModel resumes: cached parts are not re-downloaded", async () => {
  const manifest = await manifestOf([16, 32]);
  const { cache } = fakeCache();
  const first = serveParts(manifest);
  await installModel({
    cache,
    manifest,
    fetchImpl: (url) => {
      if (url.endsWith("fake-1.part")) return Promise.reject(new Error("network down"));
      return first.fetchImpl(url);
    },
  }).then(
    () => assert.fail("install should have failed on part 2"),
    (e: unknown) => assert.match((e as Error).message, /Could not reach GitHub/),
  );
  // Part 1 made it into the cache before the failure…
  assert.equal(await isModelInstalled(cache, manifest), false);
  const resume = serveParts(manifest);
  await installModel({ cache, manifest, fetchImpl: resume.fetchImpl });
  assert.deepEqual(
    resume.calls.map((u) => u.split("/").pop()),
    ["fake-1.part"],
  );
});

test("installModel rejects tampered bytes with an integrity error", async () => {
  const manifest = await manifestOf([16]);
  const { cache } = fakeCache();
  const corrupt: ModelManifest = {
    ...manifest,
    parts: [{ ...manifest.parts[0]!, sha256: "0".repeat(64) }],
  };
  await installModel({
    cache,
    manifest: corrupt,
    fetchImpl: serveParts(manifest).fetchImpl,
  }).then(
    () => assert.fail("install should have failed the hash check"),
    (e: unknown) => {
      assert.ok(e instanceof ModelInstallError);
      assert.match((e as Error).message, /Integrity check failed/);
      assert.equal((e as ModelInstallError).part, 0);
    },
  );
  assert.equal(await isModelInstalled(cache, corrupt), false);
});

test("installModel surfaces a helpful message for unpublished files", async () => {
  const manifest = await manifestOf([16]);
  const { cache } = fakeCache();
  await installModel({
    cache,
    manifest,
    fetchImpl: () => Promise.resolve(new Response("", { status: 404 })),
  }).then(
    () => assert.fail("install should have failed with 404"),
    (e: unknown) => assert.match((e as Error).message, /not published yet/),
  );
});

test("readModelBlob reassembles the parts in manifest order", async () => {
  const manifest = await manifestOf([16, 32, 48]);
  const { cache } = fakeCache();
  await installModel({ cache, manifest, fetchImpl: serveParts(manifest).fetchImpl });
  const blob = await readModelBlob(cache, manifest);
  assert.equal(blob.size, manifest.totalBytes);
  const first = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  assert.ok(first.every((b) => b === 1), "first part should be fill byte 1");
  const last = new Uint8Array(await blob.slice(-48, -32).arrayBuffer());
  assert.ok(last.every((b) => b === 3), "last part should be fill byte 3");
});

test("readModelBlob fails clearly when a part is missing", async () => {
  const manifest = await manifestOf([16, 32]);
  const { cache, store } = fakeCache();
  await installModel({ cache, manifest, fetchImpl: serveParts(manifest).fetchImpl });
  store.clear();
  await assert.rejects(readModelBlob(cache, manifest), /missing from local storage/);
});

test("deleteModel removes every part so the install reads as absent", async () => {
  const manifest = await manifestOf([16, 32, 48]);
  const { cache, store } = fakeCache();
  await installModel({ cache, manifest, fetchImpl: serveParts(manifest).fetchImpl });
  assert.equal(await isModelInstalled(cache, manifest), true);
  await deleteModel({ cache, manifest });
  assert.equal(await isModelInstalled(cache, manifest), false);
  assert.equal(store.size, 0, "the cache bucket should be empty afterwards");
});

test("deleteModel tolerates an already-empty cache", async () => {
  const manifest = await manifestOf([16]);
  const { cache, store } = fakeCache();
  await deleteModel({ cache, manifest });
  assert.equal(store.size, 0);
});

test("deleteModel surfaces cache failures to the caller", async () => {
  const manifest = await manifestOf([16]);
  const failing: PartCache = {
    match: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
    delete: () => Promise.reject(new Error("storage is full")),
  };
  await assert.rejects(deleteModel({ cache: failing, manifest }), /storage is full/);
});
