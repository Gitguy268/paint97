#!/usr/bin/env node
// One-shot publisher for the on-device Clippy model — no dependencies.
// Usage:
//   node scripts/prepare-model.mjs           download, split, hash, write models/manifest.json
//   node scripts/prepare-model.mjs --verify  re-hash the parts on disk against the manifest
//
// Why this exists: GitHub rejects files over 100 MB, and the 4-bit (Q4_K_M)
// Gemma-3 270M GGUF is 253 MB. This script splits it into 6 parts of ~42 MB
// (under GitHub's 50 MB soft-warning threshold too) and records each part's
// size and SHA-256 in models/manifest.json. The app bundles that manifest,
// downloads the parts from raw.githubusercontent.com, verifies every hash,
// and only then hands the reassembled model to the browser runtime.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// The upstream artifact and its properties, pinned from the Hugging Face
// repo's LFS metadata — the download is refused unless it hashes to this.
const SOURCE =
  "https://huggingface.co/lm-kit/gemma-3-270m-instruct-gguf/resolve/main/gemma-3-270M-it-Q4_K_M.gguf";
const FILE = "gemma-3-270M-it-Q4_K_M.gguf";
const TOTAL_BYTES = 253_114_976;
const SHA256 = "e28b323bc75925d6edc8d3f030268830bf53c59c296d77278ac24653403d9d47";

// Where the app will fetch the parts from (must match src/lib/localAi/model.ts).
const REPO = "gitguy268/win97-excalidraw";
const REF = "main";
// Each part stays under GitHub's 100 MB hard limit (and its 50 MB warning).
const CHUNK_BYTES = 45_000_000;

const MODELS_DIR = path.join(process.cwd(), "models");
const MANIFEST = path.join(MODELS_DIR, "manifest.json");
const partName = (i, n) => `${FILE}-${String(i + 1).padStart(5, "0")}-of-${String(n).padStart(5, "0")}.part`;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function hashFile(file) {
  const hash = createHash("sha256");
  const fd = await fs.open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(4 << 20);
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fd.close();
  }
  return hash.digest("hex");
}

/** True when every part on disk matches the committed manifest. */
async function verify(manifest) {
  let ok = true;
  for (const part of manifest.parts) {
    const file = path.join(MODELS_DIR, part.file);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      console.error(`MISSING ${part.file}`);
      ok = false;
      continue;
    }
    if (stat.size !== part.bytes) {
      console.error(`SIZE MISMATCH ${part.file}: ${stat.size} != ${part.bytes}`);
      ok = false;
      continue;
    }
    const got = await hashFile(file);
    if (got !== part.sha256) {
      console.error(`HASH MISMATCH ${part.file}: ${got} != ${part.sha256}`);
      ok = false;
      continue;
    }
    console.log(`ok ${part.file}`);
  }
  return ok;
}

async function download(tmp) {
  console.log(`Downloading ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const expected = Number(res.headers.get("content-length")) || TOTAL_BYTES;
  const hash = createHash("sha256");
  let seen = 0;
  let lastPct = -1;
  const meter = async function* () {
    for await (const chunk of res.body) {
      seen += chunk.length;
      hash.update(chunk);
      const pct = Math.floor((seen / expected) * 20) * 5;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\r  ${pct}% — ${(seen / 1e6).toFixed(0)} MB`);
      }
      yield chunk;
    }
  };
  await pipeline(Readable.from(meter()), createWriteStream(tmp));
  process.stdout.write("\n");
  const got = hash.digest("hex");
  if (got !== SHA256) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error(`upstream file changed: sha256 ${got} != pinned ${SHA256}`);
  }
}

async function main() {
  await fs.mkdir(MODELS_DIR, { recursive: true });
  const verifyOnly = process.argv.includes("--verify");

  let manifest = null;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  } catch {
    /* no manifest yet */
  }

  if (verifyOnly) {
    if (!manifest) throw new Error("models/manifest.json not found — run without --verify first");
    const good = await verify(manifest);
    console.log(good ? "All parts match the manifest." : "Verification FAILED.");
    process.exit(good ? 0 : 1);
  }

  if (manifest && (await verify(manifest))) {
    console.log("Parts already on disk and matching the manifest — nothing to do.");
    return;
  }

  const tmp = path.join(os.tmpdir(), FILE);
  await download(tmp);

  // Balanced split: n parts of ceil(total / n) bytes each.
  const count = Math.ceil(TOTAL_BYTES / CHUNK_BYTES);
  const partSize = Math.ceil(TOTAL_BYTES / count);
  const parts = [];
  const fd = await fs.open(tmp, "r");
  try {
    const buf = Buffer.allocUnsafe(partSize);
    for (let i = 0; i < count; i++) {
      const { bytesRead } = await fd.read(buf, 0, partSize, i * partSize);
      const slice = buf.subarray(0, bytesRead);
      const file = partName(i, count);
      await fs.writeFile(path.join(MODELS_DIR, file), slice);
      parts.push({ file, bytes: bytesRead, sha256: sha256(slice) });
      console.log(`wrote ${file} (${(bytesRead / 1e6).toFixed(1)} MB)`);
    }
  } finally {
    await fd.close();
  }
  await fs.unlink(tmp);

  const out = {
    model: "Gemma 3 270M IT",
    quant: "Q4_K_M",
    file: FILE,
    source: "https://huggingface.co/lm-kit/gemma-3-270m-instruct-gguf",
    license: "Gemma Terms of Use (Google) — credited in NOTICE",
    repo: REPO,
    ref: REF,
    totalBytes: TOTAL_BYTES,
    sha256: SHA256,
    parts,
  };
  await fs.writeFile(MANIFEST, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${path.relative(process.cwd(), MANIFEST)} — ${count} parts. ` +
      "Commit models/ to the public repo (raw.githubusercontent.com serves it), " +
      "or update manifest.repo/ref if the remote differs.",
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
