// Unit tests for src/lib/minesweeper.ts — the rules ARE the game, so the
// invariants below are what stands between a player and a cheating board:
// first click never lands on a mine, floods only stop at borders, flags and
// numbers, flags drive the counter, and a finished game freezes.
//
// Layout-sensitive tests pin the shuffle with a tiny LCG so the outcome is
// fixed run after run (seed 1 was chosen because it leaves 9x9/10 at the
// opening corner click mid-game rather than instantly winning).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEVELS,
  createGame,
  formatCounter,
  inBounds,
  mineCounter,
  reveal,
  toggleFlag,
} from "../../src/lib/minesweeper.ts";

/** Deterministic stand-in for Math.random: same seed, same mine layout. */
const lcg = (seed: number): (() => number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

test("createGame builds an empty board of the requested size", () => {
  const g = createGame(9, 9, 10);
  assert.equal(g.grid.length, 9);
  assert.equal(g.grid[0]?.length, 9);
  assert.equal(g.status, "ready");
  assert.equal(g.flags, 0);
  assert.equal(g.revealed, 0);
  for (const row of g.grid) {
    for (const cell of row) {
      assert.deepEqual(cell, { mine: false, revealed: false, flagged: false, adj: 0 });
    }
  }
  const expert = createGame(LEVELS.expert.cols, LEVELS.expert.rows, LEVELS.expert.mines);
  assert.equal(expert.cols, 30);
  assert.equal(expert.rows, 16);
  assert.equal(expert.mines, 99);
});

test("first reveal plants mines outside the clicked 3x3 and starts the game", () => {
  const g = reveal(createGame(9, 9, 10), 0, 0, lcg(1));
  assert.equal(g.status, "playing");
  assert.equal(g.mines, 10);
  assert.ok(g.revealed >= 1, `revealed=${g.revealed}`);

  let planted = 0;
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const cell = g.grid[y]?.[x];
      assert.ok(cell);
      if (cell.mine) planted += 1;
      // nothing inside the clamped 3x3 around the click
      if (x <= 1 && y <= 1) assert.equal(cell.mine, false, `mine at safe cell ${x},${y}`);
      // the flood never opens a mine
      if (cell.revealed) assert.equal(cell.mine, false, `revealed mine at ${x},${y}`);
    }
  }
  assert.equal(planted, g.mines);

  // the revealed counter tracks reality
  let open = 0;
  for (const row of g.grid) for (const cell of row) if (cell.revealed) open += 1;
  assert.equal(g.revealed, open);
});

test("adjacent counts match the planted mines", () => {
  const g = reveal(createGame(16, 16, 40), 0, 0);
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const cell = g.grid[y]?.[x];
      assert.ok(cell);
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (g.grid[y + dy]?.[x + dx]?.mine) neighbors += 1;
        }
      }
      assert.equal(cell.adj, neighbors, `adj at ${x},${y}`);
    }
  }
});

test("flood opens every zero's neighbours unless flagged", () => {
  // park a flag in the middle of the board BEFORE the first click — the
  // flood must respect it and never open the cell underneath
  let g = toggleFlag(createGame(9, 9, 10), 4, 4);
  g = reveal(g, 0, 0, lcg(1));
  assert.equal(g.grid[4]?.[4]?.flagged, true);
  assert.equal(g.grid[4]?.[4]?.revealed, false, "flood must not open a flagged cell");

  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const cell = g.grid[y]?.[x];
      assert.ok(cell);
      if (!cell.revealed || cell.adj !== 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nb = g.grid[y + dy]?.[x + dx];
          if (!nb) continue;
          assert.ok(nb.revealed || nb.flagged, `zero at ${x},${y} left ${x + dx},${y + dy} unopened`);
        }
      }
    }
  }
});

test("flags drive the counter, block reveal, and don't start the clock", () => {
  let g = createGame(9, 9, 10);
  g = toggleFlag(g, 0, 0);
  assert.equal(g.grid[0]?.[0]?.flagged, true);
  assert.equal(g.flags, 1);
  assert.equal(mineCounter(g), 9);
  assert.equal(g.status, "ready");

  // a flagged cell refuses the first reveal — game stays unstarted
  const blocked = reveal(g, 0, 0);
  assert.equal(blocked, g);
  assert.equal(g.status, "ready");
  for (const row of g.grid) for (const cell of row) assert.equal(cell.mine, false);

  g = toggleFlag(g, 0, 0);
  assert.equal(g.flags, 0);
  assert.equal(mineCounter(g), 10);
});

test("revealed cells cannot be flagged", () => {
  const g = reveal(createGame(9, 9, 10), 0, 0, lcg(1));
  let spot: [number, number] | null = null;
  for (let y = 0; y < g.rows && !spot; y++) {
    for (let x = 0; x < g.cols && !spot; x++) {
      if (g.grid[y]?.[x]?.revealed) spot = [x, y];
    }
  }
  assert.ok(spot, "the opening click must reveal something");
  assert.equal(toggleFlag(g, spot[0], spot[1]), g);
});

test("the counter can go negative", () => {
  let g = createGame(9, 9, 10);
  for (let i = 0; i < 11; i++) g = toggleFlag(g, i % 9, Math.floor(i / 9));
  assert.equal(mineCounter(g), -1);
  assert.equal(formatCounter(mineCounter(g)), "-01");
});

test("clicking a mine ends the game and shows every mine", () => {
  const g = reveal(createGame(9, 9, 10), 0, 0, lcg(1));
  assert.equal(g.status, "playing");
  let spot: [number, number] | null = null;
  for (let y = 0; y < g.rows && !spot; y++) {
    for (let x = 0; x < g.cols && !spot; x++) {
      if (g.grid[y]?.[x]?.mine) spot = [x, y];
    }
  }
  assert.ok(spot, "ten mines must be planted");

  const lost = reveal(g, spot[0], spot[1]);
  assert.equal(lost.status, "lost");
  for (const row of lost.grid) {
    for (const cell of row) if (cell.mine) assert.equal(cell.revealed, true);
  }
  // a finished board freezes: every further click is a no-op
  const safe = (() => {
    for (let y = 0; y < lost.rows; y++) {
      for (let x = 0; x < lost.cols; x++) {
        if (!lost.grid[y]?.[x]?.mine) return [x, y] as [number, number];
      }
    }
    return [0, 0] as [number, number];
  })();
  assert.equal(reveal(lost, safe[0], safe[1]), lost);
  assert.equal(toggleFlag(lost, safe[0], safe[1]), lost);
  assert.equal(reveal(lost, -1, -1), lost);
});

test("a safe zone that swallows the board shrinks the mine count and wins", () => {
  // 3x3 with the click at the centre: the clamped 3x3 IS the whole board,
  // so nothing can be planted and the flood opens every cell at once.
  const g = reveal(createGame(3, 3, 5), 1, 1);
  assert.equal(g.mines, 0);
  assert.equal(g.revealed, 9);
  assert.equal(g.status, "won");
  assert.equal(toggleFlag(g, 0, 0), g);
  assert.equal(reveal(g, 0, 0), g);
});

test("out-of-bounds clicks change nothing", () => {
  const g = createGame(9, 9, 10);
  assert.equal(reveal(g, 9, 0), g);
  assert.equal(toggleFlag(g, 0, -1), g);
  assert.equal(inBounds(g, 8, 8), true);
  assert.equal(inBounds(g, 9, 8), false);
});

test("formatCounter renders the classic LED fields", () => {
  assert.equal(formatCounter(0), "000");
  assert.equal(formatCounter(7), "007");
  assert.equal(formatCounter(42), "042");
  assert.equal(formatCounter(100), "100");
  assert.equal(formatCounter(999), "999");
  assert.equal(formatCounter(1000), "999");
  assert.equal(formatCounter(-1), "-01");
  assert.equal(formatCounter(-99), "-99");
  assert.equal(formatCounter(-150), "-99");
});
