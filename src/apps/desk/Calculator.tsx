// Layout + key binding only: the arithmetic is the tokenizer/parser in lib/calc.ts (never eval).
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { CALC_INITIAL, pressKey, type CalcState } from "../../lib/calc.ts";
import type { MsgKey } from "../../i18n/en.ts";

const KEYS: readonly { k: string; aria?: MsgKey }[] = [
  { k: "C", aria: "calc.clear" }, { k: "⌫", aria: "calc.backspace" }, { k: "(" }, { k: ")" },
  { k: "7" }, { k: "8" }, { k: "9" }, { k: "÷", aria: "calc.divide" },
  { k: "4" }, { k: "5" }, { k: "6" }, { k: "×", aria: "calc.multiply" },
  { k: "1" }, { k: "2" }, { k: "3" }, { k: "−", aria: "calc.minus" },
  { k: "0" }, { k: "." }, { k: "=", aria: "calc.equals" }, { k: "+", aria: "calc.plus" },
];
const KEYMAP: Record<string, string> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  ".": ".", "+": "+", "-": "−", "*": "×", "/": "÷", "(": "(", ")": ")",
  Enter: "=", "=": "=", Backspace: "⌫", Delete: "C", Escape: "C",
};

export default function Calculator() {
  const t = useT();
  const [s, setS] = useState<CalcState>(CALC_INITIAL);
  const press = (k: string) => setS((cur) => pressKey(cur, k));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []); // type straight away
  return (
    <div
      ref={root}
      className="calc" role="group" aria-label={t("app.calc")} tabIndex={0}
      onKeyDown={(e) => {
        const k = KEYMAP[e.key];
        if (k === undefined || e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts pass through
        e.preventDefault();
        press(k);
      }}
    >
      <div className="calc-display" role="status">{s.err ?? (s.expr || "0")}</div>
      <div className="calc-keys">
        {KEYS.map(({ k, aria }) => <button key={k} tabIndex={-1} aria-label={aria ? t(aria) : k} onClick={() => press(k)}>{k}</button>)}
      </div>
    </div>
  );
}
