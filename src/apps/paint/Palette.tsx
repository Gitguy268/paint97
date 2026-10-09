// The classic 28-colour Win98 palette. Click = stroke, Shift+click (or right-click) = fill.
import { useT } from "../../i18n/index.ts";

const PALETTE = [
  "#000000", "#808080", "#800000", "#808000", "#008000", "#008080", "#000080", "#800080", "#808040", "#004040", "#0080ff", "#004080", "#8000ff", "#804000",
  "#ffffff", "#c0c0c0", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffff80", "#00ff80", "#80ffff", "#8080ff", "#ff0080", "#ff8040",
] as const;

export function Palette({ stroke, fill, onStroke, onFill }: { stroke: string; fill: string; onStroke: (c: string) => void; onFill: (c: string) => void }) {
  const t = useT();
  return (
    <div className="palette-bar" role="group" aria-label={t("paint.palette")}>
      <div className="swatch-current" aria-hidden="true">
        <span className="bg" style={{ background: fill === "transparent" ? "#fff" : fill }} />
        <span className="fg" style={{ background: stroke }} />
      </div>
      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ background: c }}
            aria-label={`${c} — ${t("paint.paletteHint")}`}
            aria-pressed={stroke.toLowerCase() === c}
            onClick={(e) => (e.shiftKey ? onFill(c) : onStroke(c))}
            onContextMenu={(e) => { e.preventDefault(); onFill(c); }}
          />
        ))}
      </div>
    </div>
  );
}
