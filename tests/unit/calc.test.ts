// Unit tests for src/lib/calc.ts — the Calculator must never eval(), so
// its grammar is the only thing between keypad input and the display:
// precedence, unary signs, paren balance, division by zero, the float
// noise cleanup and the keypad state machine are all contract.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALC_INITIAL,
  ERR_DIV_ZERO,
  ERR_INPUT,
  ERR_OVERFLOW,
  MAX_EXPR,
  evaluateExpr,
  formatValue,
  pressKey,
  tokenize,
} from "../../src/lib/calc.ts";

const value = (src: string): number => {
  const r = evaluateExpr(src);
  assert.equal(r.ok, true, `${JSON.stringify(src)} should evaluate`);
  return r.ok ? r.value : NaN;
};

const err = (src: string): string => {
  const r = evaluateExpr(src);
  assert.equal(r.ok, false, `${JSON.stringify(src)} should fail`);
  return r.ok ? "" : r.error;
};

test("tokenizer accepts the keypad's operators and rejects strangers", () => {
  assert.deepEqual(tokenize("2+3×4÷(5−6)"), [
    { t: "num", v: 2 },
    { t: "op", v: "+" },
    { t: "num", v: 3 },
    { t: "op", v: "*" },
    { t: "num", v: 4 },
    { t: "op", v: "/" },
    { t: "lp" },
    { t: "num", v: 5 },
    { t: "op", v: "-" },
    { t: "num", v: 6 },
    { t: "rp" },
  ]);
  assert.equal(tokenize("2$3"), null); // shell-ish input never parses
  assert.equal(tokenize("alert(1)"), null);
  assert.equal(tokenize("1.2.3"), null);
  assert.equal(tokenize("9".repeat(MAX_EXPR + 1)), null); // length cap
});

test("precedence: multiply/divide bind tighter than add/subtract", () => {
  assert.equal(value("2+3×4"), 14);
  assert.equal(value("2×3+4"), 10);
  assert.equal(value("10−6÷2"), 7);
  assert.equal(value("2×3×4"), 24);
  assert.equal(value("100−5−4"), 91); // left associativity
});

test("parentheses regroup and nest", () => {
  assert.equal(value("(2+3)×4"), 20);
  assert.equal(value("2×(3+(4−1))"), 12);
  assert.equal(value("((((7))))"), 7);
  assert.equal(value("10÷(2×(1+1))"), 2.5);
});

test("unary signs prefix numbers and follow operators", () => {
  assert.equal(value("−5+3"), -2);
  assert.equal(value("2×−3"), -6);
  assert.equal(value("(−4)×(−5)"), 20);
  assert.equal(value("+5"), 5);
  assert.equal(value("−(2+3)"), -5);
  assert.equal(value("−−5"), 5);
});

test("division by zero reports the Win9x wording", () => {
  assert.equal(err("10÷0"), ERR_DIV_ZERO);
  assert.equal(err("5÷(3−3)"), ERR_DIV_ZERO);
  assert.equal(err("0÷0"), ERR_DIV_ZERO);
});

test("malformed input reports Invalid input", () => {
  for (const bad of ["", "2+", "+", "()", "(2", "2)", "1 2", "2..3", "..", "abc", "2 3×4", "×", "(1)2"]) {
    assert.equal(err(bad), ERR_INPUT, JSON.stringify(bad));
  }
});

test("runaway multiplication reports Overflow instead of Infinity", () => {
  // 999999999^35 ≈ 10^315 — past the double range, inside MAX_EXPR.
  const factors = Array.from({ length: 35 }, () => "999999999").join("×");
  assert.ok(factors.length <= MAX_EXPR);
  assert.equal(err(factors), ERR_OVERFLOW);
});

test("formatValue hides binary-float noise", () => {
  assert.equal(value("0.1+0.2"), 0.30000000000000004); // raw double survives…
  assert.equal(formatValue(value("0.1+0.2")), "0.3"); // …the display hides it
  assert.equal(formatValue(14), "14");
  assert.equal(formatValue(2.5), "2.5");
  assert.equal(formatValue(-0), "0");
  assert.equal(formatValue(0.9999999999999999), "1");
});

// ---- keypad state machine ------------------------------------------------

const type = (keys: string[], from = CALC_INITIAL): string =>
  keys.reduce((s, k) => pressKey(s, k), from).expr;

test("keypad: digits accumulate, one decimal per number", () => {
  assert.equal(type(["1", "2", ".", "5"]), "12.5");
  assert.equal(type(["1", ".", "2", ".", "3"]), "1.23"); // second dot ignored inside the number
  assert.equal(type(["2", "+", "1", ".", "5"]), "2+1.5");
  assert.equal(type(["."]), "0."); // lone dot becomes a bare fraction
  assert.equal(type(["5", "+", "."]), "5+.");
});

test("keypad: Enter computes, then a digit starts over", () => {
  let s = CALC_INITIAL;
  for (const k of ["2", "+", "3", "×", "4", "="]) s = pressKey(s, k);
  assert.deepEqual(s, { expr: "14", err: null, fresh: true });
  s = pressKey(s, "5");
  assert.equal(s.expr, "5"); // fresh result → new sum, not "145"
  s = pressKey(s, "+"); // …but an operator continues from it
  assert.equal(s.expr, "5+");
});

test("keypad: operators stack-check and unary minus slips through", () => {
  assert.equal(type(["2", "+", "+", "3"]), "2+3"); // stacked "+" ignored
  assert.equal(type(["2", "×", "÷", "4"]), "2×4"); // stacked "×" ignored
  assert.equal(type(["×", "7"]), "7"); // leading operator ignored, digit starts the sum
  assert.equal(type(["2", "×", "−", "3"]), "2×−3"); // unary after operator
  assert.equal(type(["−"]), "−"); // bare unary minus at the start
  assert.equal(type(["−", "5"]), "−5");
});

test("keypad: parens open only where the grammar allows", () => {
  assert.equal(type(["(", "1", "+", "2", ")"]), "(1+2)");
  assert.equal(type(["1", "("]), "1"); // no implicit multiplication
  assert.equal(type(["2", "+", "(", ")"]), "2+("); // closer ignored with nothing inside
  assert.equal(type(["(", "(", "1", ")", ")"]), "((1))");
  assert.equal(type(["(", "1", ")", ")"]), "(1)"); // closer with nothing open
  assert.equal(type(["1", "+", "2", ")"]), "1+2"); // never closed → no closer
});

test("keypad: errors surface, then the next digit clears them", () => {
  let s = CALC_INITIAL;
  for (const k of ["2", "+", "="]) s = pressKey(s, k);
  assert.equal(s.err, ERR_INPUT);
  s = pressKey(s, "3");
  assert.equal(s.err, null);
  assert.equal(s.expr, "3");

  s = pressKey(CALC_INITIAL, "C");
  assert.deepEqual(s, CALC_INITIAL);
});

test("keypad: Backspace edits and reveals a failed expression", () => {
  assert.equal(type(["1", "2", "3", "⌫"]), "12");
  assert.equal(type(["⌫"]), ""); // empty stays empty (no state churn)
  let s = pressKey(CALC_INITIAL, "1");
  s = pressKey({ ...s, err: ERR_INPUT }, "⌫");
  assert.equal(s.err, null);
  assert.equal(s.expr, "1"); // the bad expression stays for editing
});
