#!/usr/bin/env node
// Builds public/v86/freedos.img from copy.sh's FreeDOS boot floppy — no dependencies (Node >= 20).
// Usage: node scripts/make-freedos.mjs path/to/freedos722.img
//        (download it from https://i.copy.sh/freedos722.img)
//
// The upstream floppy also carries games, demos and tools whose licences are
// unknown or not free (among them a 1983 commercial Rogue). This keeps only the
// FreeDOS kernel and FreeCOM (both GPL-2.0) and the distribution README,
// rewrites the two config files, and zeroes every other byte of the data area
// so nothing else is redistributed. The programs themselves are not modified.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const SRC_SHA256 = "8ecc7604d4c17c16e136d219a92e64747196d9ae044690e90be9ca0468b1ff12";
const OUT = "public/v86/freedos.img";
// 8.3 names as stored on disk (11 bytes, space padded).
const KEEP = new Set(["KERNEL  SYS", "COMMAND COM", "README     "]);
const REWRITE = {
  "AUTOEXECBAT": "@echo off\r\nECHO.\r\nECHO Welcome to FreeDOS (http://www.freedos.org)!\r\nECHO.\r\n",
  // IDLEHALT=1: the kernel halts the CPU at the prompt instead of spinning.
  "CONFIG  SYS": "SWITCHES=/N\r\nFILES=20\r\nBUFFERS=20\r\nSHELL=A:\\COMMAND.COM /E:512 /MSG /P\r\nIDLEHALT=1\r\n",
};

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/make-freedos.mjs path/to/freedos722.img");
  process.exit(1);
}
const img = fs.readFileSync(src);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
assert.equal(sha(img), SRC_SHA256, "unexpected source image");

// FAT12 BIOS parameter block.
const bps = img.readUInt16LE(11), spc = img[13], rsv = img.readUInt16LE(14), fats = img[16];
const rootEntries = img.readUInt16LE(17), spf = img.readUInt16LE(22);
const fatOff = rsv * bps, rootOff = fatOff + fats * spf * bps, dataOff = rootOff + rootEntries * 32;
const clusterBytes = spc * bps;
const clusters = Math.floor((img.length - dataOff) / clusterBytes) + 2;
const clusterOff = (c) => dataOff + (c - 2) * clusterBytes;
const EOC = 0xfff;

const fatGet = (c) => {
  const v = img.readUInt16LE(fatOff + Math.floor((c * 3) / 2));
  return c & 1 ? v >> 4 : v & 0xfff;
};
const fatSet = (c, val) => {
  const o = fatOff + Math.floor((c * 3) / 2);
  const v = img.readUInt16LE(o);
  img.writeUInt16LE(c & 1 ? (v & 0x000f) | (val << 4) : (v & 0xf000) | val, o);
};

const kept = new Set(); // clusters that stay allocated
const root = []; // surviving 32-byte directory entries
for (let i = 0; i < rootEntries; i++) {
  const e = img.subarray(rootOff + i * 32, rootOff + i * 32 + 32);
  if (e[0] === 0) break;
  const attr = e[11];
  const name = e.toString("latin1", 0, 11);
  if (e[0] === 0xe5 || attr === 0x0f) continue; // deleted, long-name fragment
  if (attr & 0x08) { root.push(Buffer.from(e)); continue; } // volume label
  const first = e.readUInt16LE(26);
  if (KEEP.has(name)) {
    for (let c = first; c >= 2 && c < 0xff0; c = fatGet(c)) kept.add(c);
    root.push(Buffer.from(e));
  } else if (name in REWRITE) {
    const text = Buffer.from(REWRITE[name], "latin1");
    assert.ok(text.length <= clusterBytes, `${name} must fit one cluster`);
    img.fill(0, clusterOff(first), clusterOff(first) + clusterBytes);
    text.copy(img, clusterOff(first));
    const copy = Buffer.from(e);
    copy.writeUInt32LE(text.length, 28);
    kept.add(first);
    fatSet(first, EOC);
    root.push(copy);
  }
}

for (let c = 2; c < clusters; c++) {
  if (kept.has(c)) continue;
  fatSet(c, 0);
  img.fill(0, clusterOff(c), clusterOff(c) + clusterBytes);
}
img.copy(img, fatOff + spf * bps, fatOff, fatOff + spf * bps); // second FAT mirrors the first
img.fill(0, rootOff, dataOff);
root.forEach((e, i) => e.copy(img, rootOff + i * 32));

// Self-check: read the result back the way DOS would.
const listing = [];
for (let i = 0; img[rootOff + i * 32] !== 0; i++) {
  const o = rootOff + i * 32;
  if (img[o + 11] & 0x08) continue;
  let n = 0;
  for (let c = img.readUInt16LE(o + 26); c >= 2 && c < 0xff0; c = fatGet(c)) n++;
  const size = img.readUInt32LE(o + 28);
  assert.equal(n, Math.ceil(size / clusterBytes), "cluster chain matches file size");
  listing.push(`${img.toString("latin1", o, o + 11)} ${size}`);
}
assert.deepEqual(listing, ["KERNEL  SYS 45450", "COMMAND COM 66090", `AUTOEXECBAT ${REWRITE.AUTOEXECBAT.length}`, `CONFIG  SYS ${REWRITE["CONFIG  SYS"].length}`, "README      1546"]);

fs.mkdirSync("public/v86", { recursive: true });
fs.writeFileSync(OUT, img);
console.log(`  wrote ${OUT} — ${listing.length} files, sha256 ${sha(img)}`);
