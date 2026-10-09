// Rendering and clicks only: every rule lives in lib/minesweeper.ts.
import { useEffect, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { LEVELS, createGame, formatCounter, mineCounter, reveal, toggleFlag, type Game, type Level } from "../../lib/minesweeper.ts";
import { actions } from "../../shell/wmStore.ts";
import type { AppProps } from "../registry.ts";

const CELL = 16;
const LEVEL_ORDER: readonly Level[] = ["beginner", "intermediate", "expert"];
const NUM_COLOR = ["", "#0000ff", "#008000", "#ff0000", "#000080", "#800000", "#008080", "#000000", "#808080"];
const fresh = (l: Level): Game => createGame(LEVELS[l].cols, LEVELS[l].rows, LEVELS[l].mines);

export default function Minesweeper({ winId }: AppProps) {
  const t = useT();
  const [level, setLevel] = useState<Level>("beginner");
  const [game, setGame] = useState<Game>(() => fresh("beginner"));
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (game.status !== "playing") return;
    const id = setInterval(() => setSeconds((s) => Math.min(999, s + 1)), 1000);
    return () => clearInterval(id);
  }, [game.status]);
  // The window hugs the board.
  useEffect(() => { actions.setSize(winId, Math.max(250, LEVELS[level].cols * CELL + 40), LEVELS[level].rows * CELL + 150); }, [winId, level]);

  const start = (l: Level) => { setLevel(l); setGame(fresh(l)); setSeconds(0); };
  const over = game.status === "won" || game.status === "lost";
  return (
    <div className="mine-app">
      <div className="mine-levels" role="group" aria-label={t("mines.difficulty")}>
        {LEVEL_ORDER.map((l) => (
          <button key={l} aria-pressed={level === l} aria-label={t("mines.levelDesc", { level: t(`mines.${l}`), cols: LEVELS[l].cols, rows: LEVELS[l].rows, mines: LEVELS[l].mines })} onClick={() => start(l)}>{t(`mines.${l}`)}</button>
        ))}
      </div>
      <div className="mine-panel">
        <div className="mine-strip">
          <span className="mine-led" role="img" aria-label={t("mines.left", { n: mineCounter(game) })}>{formatCounter(mineCounter(game))}</span>
          <button className="mine-face" aria-label={t("mines.new")} onClick={() => start(level)}>{game.status === "won" ? "😎" : game.status === "lost" ? "😵" : "😊"}</button>
          <span className="mine-led" role="img" aria-label={t("mines.elapsed", { n: seconds })}>{formatCounter(seconds)}</span>
        </div>
        <div className="mine-grid" style={{ gridTemplateColumns: `repeat(${game.cols}, ${CELL}px)` }}>
          {game.grid.map((row, y) => row.map((cell, x) => {
            const content = game.status === "lost" && cell.flagged && !cell.mine ? "❌" : cell.flagged ? "🚩" : cell.revealed && cell.mine ? "💣" : cell.revealed && cell.adj > 0 ? String(cell.adj) : "";
            const state = cell.flagged ? t("mines.flagged") : !cell.revealed ? t("mines.hidden") : cell.mine ? t("mines.mine") : cell.adj > 0 ? t("mines.adjacent", { n: cell.adj }) : t("mines.empty");
            return (
              <button
                key={`${x},${y}`}
                className={`mine-cell ${cell.revealed ? "open" : ""}`}
                style={cell.revealed && cell.adj > 0 ? { color: NUM_COLOR[cell.adj] } : undefined}
                aria-label={t("mines.cell", { row: y + 1, col: x + 1, state })}
                disabled={cell.revealed || over}
                onClick={() => setGame((g) => reveal(g, x, y))}
                // Keyboard players flag with F; right-click for the mouse.
                onKeyDown={(e) => { if (e.key.toLowerCase() === "f") setGame((g) => toggleFlag(g, x, y)); }}
                onContextMenu={(e) => { e.preventDefault(); setGame((g) => toggleFlag(g, x, y)); }}
              >
                {content}
              </button>
            );
          }))}
        </div>
      </div>
      <p className="sr-only" role="status">{game.status === "won" ? t("mines.won") : game.status === "lost" ? t("mines.lost") : ""}</p>
    </div>
  );
}
