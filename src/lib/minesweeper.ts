// Minesweeper rules — pure, DOM-free board maths: first-click-safe mine
// placement, flood reveal, flags and win/lose. The component only renders
// what this module returns, so every rule is unit-testable in Node.
//
// Placement runs on the FIRST reveal (not at createGame), excluding the
// clicked 3×3 — the classic guarantee that the opening click is never a
// mine and usually opens a pocket.

export type Cell = { mine: boolean; revealed: boolean; flagged: boolean; adj: number };
export type GameStatus = "ready" | "playing" | "won" | "lost";
export type Level = "beginner" | "intermediate" | "expert";
export type LevelSpec = { cols: number; rows: number; mines: number };

export type Game = {
  cols: number;
  rows: number;
  mines: number;
  grid: Cell[][]; // grid[y][x]
  status: GameStatus;
  flags: number;
  revealed: number;
};

export const LEVELS: Record<Level, LevelSpec> = {
  beginner: { cols: 9, rows: 9, mines: 10 },
  intermediate: { cols: 16, rows: 16, mines: 40 },
  expert: { cols: 30, rows: 16, mines: 99 },
};

const newCell = (): Cell => ({ mine: false, revealed: false, flagged: false, adj: 0 });

export function createGame(cols: number, rows: number, mines: number): Game {
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  return {
    cols: c,
    rows: r,
    mines: Math.max(0, Math.round(mines)),
    grid: Array.from({ length: r }, () => Array.from({ length: c }, newCell)),
    status: "ready",
    flags: 0,
    revealed: 0,
  };
}

export const inBounds = (g: Game, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows;

function forEachNeighbor(g: Game, x: number, y: number, fn: (cell: Cell) => void): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const row = g.grid[y + dy];
      if (!row) continue;
      const cell = row[x + dx];
      if (cell) fn(cell);
    }
  }
}

function computeAdj(g: Game): void {
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const cell = g.grid[y]?.[x];
      if (!cell) continue;
      let n = 0;
      forEachNeighbor(g, x, y, (nb) => { if (nb.mine) n += 1; });
      cell.adj = n;
    }
  }
}

/** Plant on first reveal: mines go anywhere except the clamped 3×3 around
 * the click. If the board is too small for that, the safe zone shrinks and
 * `mines` drops to whatever actually fits so the win maths stays honest.
 * `rng` feeds the shuffle (injectable so tests can pin a layout). */
function plant(g: Game, safeX: number, safeY: number, rng: () => number): void {
  const forbidden = new Set<string>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = safeX + dx;
      const y = safeY + dy;
      if (inBounds(g, x, y)) forbidden.add(`${x},${y}`);
    }
  }
  const candidates: [number, number][] = [];
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      if (!forbidden.has(`${x},${y}`)) candidates.push([x, y]);
    }
  }
  const take = Math.min(g.mines, candidates.length);
  // Partial Fisher–Yates: the first `take` picks become the mines.
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (candidates.length - i));
    const tmp = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = tmp;
  }
  for (let i = 0; i < take; i++) {
    const spot = candidates[i]!;
    const cell = g.grid[spot[1]]?.[spot[0]];
    if (cell) cell.mine = true;
  }
  g.mines = take;
  computeAdj(g);
}

/** Reveal a flood of zero-adjacent cells; flagged cells block the spread
 * (the classic behaviour — an incorrectly placed flag can drown a pocket). */
function flood(g: Game, startX: number, startY: number): void {
  const stack: [number, number][] = [[startX, startY]];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    const [x, y] = cur;
    const cell = g.grid[y]?.[x];
    if (!cell || cell.revealed || cell.flagged || cell.mine) continue;
    cell.revealed = true;
    g.revealed += 1;
    if (cell.adj === 0) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (g.grid[y + dy]?.[x + dx]) stack.push([x + dx, y + dy]);
        }
      }
    }
  }
}

function revealAllMines(g: Game): void {
  for (const row of g.grid) {
    for (const cell of row) if (cell.mine) cell.revealed = true;
  }
}

function flagAllMines(g: Game): void {
  for (const row of g.grid) {
    for (const cell of row) if (cell.mine && !cell.flagged) { cell.flagged = true; g.flags += 1; }
  }
}

/** Reveal one cell. Returns the same reference when nothing can change.
 * `rng` only matters on the first click (mine placement); tests pass a
 * seeded generator there to pin the layout. */
export function reveal(g: Game, x: number, y: number, rng: () => number = Math.random): Game {
  if (g.status === "won" || g.status === "lost" || !inBounds(g, x, y)) return g;
  const cell = g.grid[y]?.[x];
  if (!cell || cell.revealed || cell.flagged) return g;

  const next: Game = structuredClone(g);
  if (next.status === "ready") {
    plant(next, x, y, rng);
    next.status = "playing";
  }
  const target = next.grid[y]?.[x];
  if (!target) return g;
  if (target.mine) {
    revealAllMines(next);
    next.status = "lost";
    return next;
  }
  flood(next, x, y);
  if (next.revealed === next.cols * next.rows - next.mines) {
    next.status = "won";
    flagAllMines(next);
  }
  return next;
}

/** Toggle a flag on an unrevealed cell. Returns the same reference when
 * nothing can change (finished game, revealed cell, out of bounds). */
export function toggleFlag(g: Game, x: number, y: number): Game {
  if (g.status === "won" || g.status === "lost" || !inBounds(g, x, y)) return g;
  const cell = g.grid[y]?.[x];
  if (!cell || cell.revealed) return g;
  const next: Game = structuredClone(g);
  const target = next.grid[y]?.[x];
  if (!target) return g;
  target.flagged = !target.flagged;
  next.flags += target.flagged ? 1 : -1;
  return next;
}

/** Mines left on the counter — can go negative, like the original. */
export const mineCounter = (g: Game): number => g.mines - g.flags;

/** Three-digit LED field: "007", "100", "-01" — clamped to -99..999. */
export function formatCounter(n: number): string {
  const v = Math.max(-99, Math.min(999, Math.round(n)));
  if (v < 0) return `-${String(-v).padStart(2, "0")}`;
  return String(v).padStart(3, "0");
}
