// Hand-written arithmetic evaluator for the Calculator desk app.
//
// No eval()/Function() anywhere: the expression is user input and must
// never reach a code path that compiles strings. Two stages — tokenize,
// then recursive descent — so malformed input is rejected by the grammar
// (a clean "Invalid input" instead of a thrown SyntaxError) and the
// keypad's unicode operators (× ÷ −) work beside the typed ASCII ones.

export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

// Messages mirror the Win9x calculator's wording where it had one.
export const ERR_INPUT = "Invalid input";
export const ERR_DIV_ZERO = "Cannot divide by zero";
export const ERR_OVERFLOW = "Overflow";

// Bounding the input bounds the parser's recursion: nesting depth can
// never exceed the token count, so a pathological string of 400 "(" can't
// blow the JS stack. The keypad only ever builds short sums.
export const MAX_EXPR = 400;

type Op = "+" | "-" | "*" | "/";
type Tok = { t: "num"; v: number } | { t: "op"; v: Op } | { t: "lp" } | { t: "rp" };

const OPS: Record<string, Op> = { "+": "+", "-": "-", "*": "*", "/": "/", "×": "*", "÷": "/", "−": "-" };

export function tokenize(src: string): Tok[] | null {
  if (src.length > MAX_EXPR) return null;
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === " ") { i++; continue; }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      while (j < src.length && ((src.charAt(j) >= "0" && src.charAt(j) <= "9") || src.charAt(j) === ".")) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) return null; // "." or "1.2.3" — not a number
      toks.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    const op = OPS[c];
    if (op) { toks.push({ t: "op", v: op }); i++; continue; }
    return null; // anything else the keypad can't type
  }
  return toks;
}

class InputError extends Error {}

export function evaluateExpr(src: string): CalcResult {
  const toks = tokenize(src);
  if (!toks) return { ok: false, error: ERR_INPUT };
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const fail = (msg: string): never => { throw new InputError(msg); };

  // Function declarations (hoisted): the four rules reference each other —
  // parentheses loop back through expr — so declaration order is moot.
  function expr(): number {
    let v = term();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op") break;
      if (t.v !== "+" && t.v !== "-") break;
      p++;
      const r = term();
      v = t.v === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = factor();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op") break;
      if (t.v !== "*" && t.v !== "/") break;
      p++;
      const r = factor();
      if (t.v === "/") {
        if (r === 0) fail(ERR_DIV_ZERO);
        v = v / r;
      } else v = v * r;
    }
    return v;
  }
  function factor(): number {
    const t = peek();
    if (t?.t === "op" && t.v === "-") { p++; return -factor(); }
    if (t?.t === "op" && t.v === "+") { p++; return factor(); }
    return primary();
  }
  function primary(): number {
    const t = peek();
    if (t === undefined) return fail(ERR_INPUT);
    if (t.t === "num") { p++; return t.v; }
    if (t.t === "lp") {
      p++;
      const v = expr();
      if (peek()?.t !== "rp") return fail(ERR_INPUT);
      p++;
      return v;
    }
    return fail(ERR_INPUT);
  }

  try {
    const v = expr();
    if (p !== toks.length) return { ok: false, error: ERR_INPUT }; // trailing operand/junk
    if (!Number.isFinite(v)) return { ok: false, error: ERR_OVERFLOW };
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Shortest sane decimal rendering: kills binary-float noise (0.1 + 0.2 → 0.3). */
export function formatValue(v: number): string {
  return String(parseFloat(v.toPrecision(12)));
}

// ---- keypad state machine ------------------------------------------------
//
// The Calculator window feeds raw key labels in and gets the next display
// state back. It lives here rather than in the component so the tricky
// rules — a digit after "=" starts fresh, one decimal per number, unary
// minus wherever the grammar allows one, operators that can't stack —
// are unit-testable without a DOM.

export type CalcState = { expr: string; err: string | null; fresh: boolean };
export const CALC_INITIAL: CalcState = { expr: "", err: null, fresh: true };

const isDigitKey = (k: string): boolean => (k >= "0" && k <= "9") || k === ".";
const isOpChar = (c: string): boolean => "+−×÷*/-".includes(c);

export function pressKey(s: CalcState, k: string): CalcState {
  if (k === "C") return CALC_INITIAL;

  if (k === "⌫") {
    if (s.err) return { ...s, err: null, fresh: false }; // reveal the bad expression for editing
    if (s.expr === "") return s;
    return { ...s, expr: s.expr.slice(0, -1), fresh: false };
  }

  if (k === "=") {
    if (s.err || s.expr === "") return s;
    const r = evaluateExpr(s.expr);
    return r.ok
      ? { expr: formatValue(r.value), err: null, fresh: true }
      : { ...s, err: r.error };
  }

  if (isDigitKey(k)) {
    // An error clears the slate; a fresh result starts a new sum (the
    // Win9x calculator behaves the same way after Enter).
    if (s.err) return { expr: k === "." ? "0." : k, err: null, fresh: false };
    if (s.fresh) return { expr: k === "." ? "0." : k, err: null, fresh: false };
    if (k === "." && (s.expr.match(/[\d.]+$/)?.[0] ?? "").includes(".")) return s;
    return { ...s, expr: s.expr + k };
  }

  if (k === "(") {
    if (s.err) return s;
    const last = s.expr.slice(-1);
    // Only where the grammar accepts an opening paren: at the start, after
    // an operator, after another "(", or as a brand-new expression.
    const can = s.expr === "" || s.fresh || last === "(" || isOpChar(last);
    if (!can) return s;
    return { expr: s.fresh && s.expr !== "" ? "(" : s.expr + "(", err: null, fresh: false };
  }

  if (k === ")") {
    if (s.err || s.fresh || s.expr === "") return s;
    const opens = (s.expr.match(/\(/g)?.length ?? 0) - (s.expr.match(/\)/g)?.length ?? 0);
    const last = s.expr.slice(-1);
    const afterOperand = !isOpChar(last) && last !== "(";
    if (opens < 1 || !afterOperand) return s;
    return { ...s, expr: s.expr + ")", fresh: false };
  }

  // Operators: never stacked, never leading (except unary minus), but a
  // just-computed result accepts one to continue from.
  if (s.err) return s;
  const last = s.expr.slice(-1);
  if (k === "−") return { expr: s.expr + "−", err: null, fresh: false };
  if (s.expr === "" || isOpChar(last) || last === "(") return s;
  return { expr: s.expr + k, err: null, fresh: false };
}
