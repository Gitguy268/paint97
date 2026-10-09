// Unit tests for src/lib/clock.ts — hand geometry and the zero-padded
// readouts the Clock desk app renders.

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClockDate, formatDigital, handAngles } from "../../src/lib/clock.ts";

const at = (h: number, m: number, s: number): Date => new Date(2026, 0, 5, h, m, s);

test("handAngles points at the classic positions", () => {
  assert.deepEqual(handAngles(at(0, 0, 0)), { hour: 0, minute: 0, second: 0 });
  assert.deepEqual(handAngles(at(12, 0, 0)), { hour: 0, minute: 0, second: 0 });
  assert.deepEqual(handAngles(at(3, 0, 0)), { hour: 90, minute: 0, second: 0 });
  assert.deepEqual(handAngles(at(6, 0, 30)), { hour: 180, minute: 3, second: 180 });
  assert.deepEqual(handAngles(at(9, 0, 0)), { hour: 270, minute: 0, second: 0 });
});

test("the hour hand rides the minutes and the minute hand rides the seconds", () => {
  assert.deepEqual(handAngles(at(3, 30, 0)), { hour: 105, minute: 180, second: 0 });
  assert.deepEqual(handAngles(at(3, 15, 20)), { hour: 97.5, minute: 92, second: 120 });
  assert.deepEqual(handAngles(at(11, 59, 59)), { hour: 359.5, minute: 359.9, second: 354 });
});

test("formatDigital zero-pads a 24-hour clock", () => {
  assert.equal(formatDigital(at(7, 5, 9)), "07:05:09");
  assert.equal(formatDigital(at(23, 59, 59)), "23:59:59");
  assert.equal(formatDigital(at(0, 0, 0)), "00:00:00");
});

test("formatClockDate renders a stable date line", () => {
  // 8 Oct 2026 is a Thursday.
  assert.equal(formatClockDate(new Date(2026, 9, 8, 13, 45, 0)), "Thu 08 Oct 2026");
  assert.equal(formatClockDate(new Date(2026, 0, 5, 0, 0, 0)), "Mon 05 Jan 2026");
  assert.equal(formatClockDate(new Date(2025, 11, 31, 23, 59, 59)), "Wed 31 Dec 2025");
});
