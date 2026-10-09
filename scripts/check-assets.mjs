#!/usr/bin/env node
// Build-output licence guard — no dependencies (Node >= 20).
// Usage: node scripts/check-assets.mjs        (run after `npm run build`)
//
// Fails if dist/ ships base64-embedded font data (`data:font/…`):
// @react95/core's GlobalStyle used to embed Microsoft Sans Serif
// (© Microsoft, converted by LR Software — no redistribution grant) as
// three @font-face data URIs. vite.config.ts stripEmbeddedFonts removes
// those rules and src/styles/win97.css re-declares the family over the
// MIT 98.css faces; this script keeps the embedded font from coming back.
//
// Scope: CSS and HTML only. dist/*.js is deliberately not scanned —
// @excalidraw/excalidraw embeds its own text-measurement fonts inside its
// package chunks; those are upstream assets attributed in NOTICE and are
// not something this repo can (or should) rewrite.
import fs from "node:fs";
import path from "node:path";

const DIST = "dist";
if (!fs.existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const FONT_DATA = /data:font\//g;
// The alias face that keeps react95's `* { font-family: MS Sans Serif }`
// resolving to the MIT pixel faces after the strip.
const MS_ALIAS = /@font-face\s*\{[^}]*MS Sans Serif/;

const failures = [];
let scanned = 0;

const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(p);
    else if (/\.(css|html)$/.test(entry.name)) {
      scanned++;
      const text = fs.readFileSync(p, "utf8");
      const hits = text.match(FONT_DATA);
      if (hits) failures.push(`${p}: ${hits.length} embedded font data URI(s)`);
    }
  }
};
scan(DIST);

const cssFiles = [];
const collectCss = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectCss(p);
    else if (entry.name.endsWith(".css")) cssFiles.push(p);
  }
};
collectCss(DIST);

if (cssFiles.length === 0) failures.push("no stylesheets found in dist/");
if (!cssFiles.some((f) => MS_ALIAS.test(fs.readFileSync(f, "utf8")))) {
  failures.push(`no @font-face alias for "MS Sans Serif" in dist CSS (win97.css faces missing?)`);
}

if (failures.length) {
  console.error(`Asset check FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `Asset check OK — ${scanned} CSS/HTML files clean, "MS Sans Serif" alias face present.`,
);
