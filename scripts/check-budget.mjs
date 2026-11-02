#!/usr/bin/env node
// Bundle-size budget — no dependencies (Node >= 20).
// Usage: node scripts/check-budget.mjs        (run after `npm run build`)
//
// Measures what users actually download, gzip-compressed:
//   initial = index.html's stylesheets + the entry script's static import
//             graph: the desktop shell at first paint
//   shell   = initial + every lazy chunk the entry names directly (one per
//             app, plus Clippy). This is also what the service worker precaches.
// Excalidraw, wllama and v86 sit behind a second dynamic import inside their apps,
// so they are in neither number; if one leaks into the shell (a stray static
// import), the budget fails by several hundred KiB.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Budgets in KiB (1024 B), set ~15% above the measured baseline so real
// regressions fail while healthy churn passes.
const BUDGET_KIB = {
  initialJs: 98, // baseline ~85 KiB gz (React + shell)
  css: 12, // baseline ~7.5 KiB gz (98.css + win97.css)
  sessionJs: 140, // baseline ~118 KiB gz (shell + all app chunks, no Excalidraw/wllama/v86)
};

if (!fs.existsSync("dist/index.html")) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

const gz = (file) => zlib.gzipSync(fs.readFileSync(file)).length;
const STATIC_DEP = /\b(?:from|import)\s*["']\.\/([^"']+\.js)["']/g;
const DYNAMIC = /import\(\s*["'`]\.\/([^"'`]+\.js)["'`]/g;

const read = (rel) => fs.readFileSync(path.join("dist", rel), "utf8");

/** Static import closure of one chunk, as dist-relative "assets/x.js" paths. */
const closure = (startRel) => {
  const seen = new Set();
  const queue = [startRel];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel) || !fs.existsSync(path.join("dist", rel))) continue;
    seen.add(rel);
    const src = read(rel);
    const dir = path.posix.dirname(rel);
    for (const m of src.matchAll(STATIC_DEP)) {
      const dep = path.posix.normalize(path.posix.join(dir, m[1]));
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
};

const html = read("index.html");
const entry = /src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
if (!entry) {
  console.error("no entry <script> found in dist/index.html");
  process.exit(1);
}
const cssFiles = [...html.matchAll(/href="\/(assets\/[^"]+\.css)"/g)].map((m) => m[1]);

const initial = closure(entry);
let session = new Set(initial);
for (const m of read(entry).matchAll(DYNAMIC)) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry), m[1]));
  if (fs.existsSync(path.join("dist", target))) {
    for (const f of closure(target)) session.add(f);
  }
}

const sum = (files) => [...files].reduce((n, f) => n + gz(path.join("dist", f)), 0);
const cssBytes = cssFiles.reduce((n, f) => n + gz(path.join("dist", f)), 0);

const kib = (n) => (n / 1024).toFixed(1);
const rows = [
  ["initial JS", sum(initial), BUDGET_KIB.initialJs, `${initial.size} chunks`],
  ["CSS", cssBytes, BUDGET_KIB.css, `${cssFiles.length} file(s)`],
  ["shell JS", sum(session), BUDGET_KIB.sessionJs, `${session.size} chunks`],
];

const failures = [];
for (const [label, bytes, budget, note] of rows) {
  const over = bytes > budget * 1024;
  console.log(
    `  ${over ? "✗" : "✓"} ${label}: ${kib(bytes)} KiB gz / budget ${budget} KiB (${note})`,
  );
  if (over) failures.push(`${label} ${kib(bytes)} KiB exceeds budget ${budget} KiB`);
}

if (failures.length) {
  console.error(`Budget check FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error("If this growth is intentional, update BUDGET_KIB in scripts/check-budget.mjs.");
  process.exit(1);
}
console.log("Budget check OK.");
