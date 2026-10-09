// Clock maths for the Clock desk app — hand angles and zero-padded
// readouts, all derived from a Date so they unit-test in Node without a
// DOM, a timer, or locale surprises.

export type HandAngles = { hour: number; minute: number; second: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Degrees clockwise from 12 o'clock. The hour hand rides the minutes
 * (3:30 → 105°, not 90°) like a real movement. */
export function handAngles(d: Date): HandAngles {
  const s = d.getSeconds();
  const m = d.getMinutes();
  const h = d.getHours() % 12;
  return { hour: h * 30 + m * 0.5, minute: m * 6 + s * 0.1, second: s * 6 };
}

/** 24-hour "HH:MM:SS", deterministic across locales. */
export function formatDigital(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** "Thu 08 Oct 2026" — manual assembly keeps tests locale-independent. */
export function formatClockDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
