// Win98 Paint-style tool strip. Drives Excalidraw's active tool; arrow keys rove.
import { useRef, useState } from "react";
import { useT, type MsgKey } from "../../i18n/index.ts";

export const TOOLS = [
  { id: "selection", glyph: "⬚", key: "paint.tool.select" },
  { id: "freedraw", glyph: "✎", key: "paint.tool.pencil" },
  { id: "eraser", glyph: "⌫", key: "paint.tool.eraser" },
  { id: "text", glyph: "A", key: "paint.tool.text" },
  { id: "line", glyph: "╱", key: "paint.tool.line" },
  { id: "arrow", glyph: "→", key: "paint.tool.arrow" },
  { id: "rectangle", glyph: "▭", key: "paint.tool.rect" },
  { id: "diamond", glyph: "◇", key: "paint.tool.diamond" },
  { id: "ellipse", glyph: "◯", key: "paint.tool.ellipse" },
  { id: "hand", glyph: "✋", key: "paint.tool.hand" },
] as const satisfies readonly { id: string; glyph: string; key: MsgKey }[];
export type ToolId = (typeof TOOLS)[number]["id"];

export function ToolStrip({ active, onPick }: { active: string; onPick: (id: ToolId) => void }) {
  const t = useT();
  const [focus, setFocus] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (focus + d + TOOLS.length) % TOOLS.length;
    setFocus(n);
    queueMicrotask(() => ref.current?.querySelectorAll<HTMLElement>("button")[n]?.focus());
  };
  return (
    <div ref={ref} className="tool-strip" role="toolbar" aria-orientation="vertical" aria-label={t("paint.tools")} onKeyDown={onKey}>
      {TOOLS.map((tool, i) => (
        <button key={tool.id} tabIndex={i === focus ? 0 : -1} aria-pressed={active === tool.id} aria-label={t(tool.key)} title={t(tool.key)} onClick={() => { setFocus(i); onPick(tool.id); }}>
          <span aria-hidden="true">{tool.glyph}</span>
        </button>
      ))}
    </div>
  );
}
