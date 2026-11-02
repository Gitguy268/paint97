import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FLOPPY, driveFor } from "../../src/lib/vpc.ts";

test("driveFor: .iso is a CD whatever its size, floppy-sized images are floppies, the rest hard disks", () => {
  assert.equal(driveFor("win.ISO", 1000), "cdrom");
  assert.equal(driveFor("freedos.img", 737280), "fda");
  assert.equal(driveFor("big.img", MAX_FLOPPY), "fda");
  assert.equal(driveFor("big.img", MAX_FLOPPY + 1), "hda");
  assert.equal(driveFor("iso.img", 500 * 1024 * 1024), "hda");
});
