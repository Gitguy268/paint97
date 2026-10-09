#!/usr/bin/env node
// Bundle-size budget — no dependencies (Node >= 20).
// Usage: node scripts/check-budget.mjs        (run after `npm run build`)
//
// Measures what users actually download, gzip-compressed:
//   initial = index.html + linked stylesheets + entry script's static
//             import graph (first paint)
//   session = initial + the lazy chunks boot pulls anyway (Excalidraw
//             stage + @excalidraw/excalidraw/prod, which restore() loads)
// The session graph is walked by parsing literal dynamic imports and the
// Vite __vite__mapDeps preload list in the entry chunk; deeper lazy chunks
// (mermaid/katex/cytoscape, loaded only when used) are intentionally out
// of scope. Exceeding a budget fails CI, so dependency or code-splitting
// regressions surface before release.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Budgets in KiB (1024 B), set ~15% above the measured baseline so real
// regressions fail while healthy churn passes.
const BUDGET_KIB = {
  initialJs: 105, // baseline ~91 KiB gz (entry + rolldown runtime)
  css: 50, // baseline ~40 KiB gz (post font-strip)
  sessionJs: 500, // baseline ~429 KiB gz (stage + prod static graphs)
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
  ["session JS", sum(session), BUDGET_KIB.sessionJs, `${session.size} chunks`],
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
