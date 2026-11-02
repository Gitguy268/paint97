#!/usr/bin/env node
// Post-build service-worker generator — no dependencies (Node >= 20).
// Usage: node scripts/gen-sw.mjs        (run after `vite build`, needs dist/)
//
// Emits dist/sw.js from the build's hashed asset list. Strategy:
//   - install:   precache the shell (index.html, manifest, icons, favicon,
//                stylesheet and the entry's boot session graph), then
//                skipWaiting
//   - activate:  drop caches from previous builds (name is content-derived),
//                then clients.claim so offline works from the next reload
//   - fetch:     cross-origin requests pass straight through (no
//                respondWith): the Ask Clippy model comes from Hugging Face
//                and lives in its own Cache Storage bucket, so it is
//                never duplicated here
//   - navigations: network-first with the precached index.html as offline
//                fallback (an offline reload re-renders the shell). Only for
//                the shell's own URL: JS Paint's page, framed or opened in a
//                tab, is a navigation too, and must neither replace the
//                cached shell nor be answered with it
//   - everything else same-origin: cache-first, filled on first use —
//                hashed assets are immutable, so this is safe
//
// The cache name embeds a hash of the precache list: a new build gets a
// fresh cache, an unchanged build re-issues byte-identical service code
// (so the browser's byte-diff update check sees no change).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DIST = "dist";
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

// Vite's hashed output lives at the root of dist/assets/; directories under
// it (assets/clippy/) are public/ files the app serves itself.
//
// What counts as "the shell" uses the same walk as check-budget.mjs (kept
// local so this script stays self-contained): the entry script's static
// import closure plus the literal dynamic imports it boots with (Excalidraw
// stage + prod), the stylesheet and index.html. Deeper lazy chunks
// (mermaid/katex/cytoscape — fetched only when used) fill the cache on
// first use instead of being dragged into every install — dist/assets is
// ~19 MB in total, far too much to precache.
const STATIC_DEP = /\b(?:from|import)\s*["']\.\/([^"']+\.js)["']/g;
const DYNAMIC = /import\(\s*["'`]\.\/([^"'`]+\.js)["'`]/g;

const read = (rel) => fs.readFileSync(path.join(DIST, rel), "utf8");

const closure = (startRel) => {
  const seen = new Set();
  const queue = [startRel];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel) || !fs.existsSync(path.join(DIST, rel))) continue;
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
const entry = /src="(?:\/[^"]*?\/|\.?\/)?(assets\/[^"]+\.js)"/.exec(html)?.[1];
if (!entry) {
  console.error("no entry <script> found in dist/index.html");
  process.exit(1);
}
const css = [...html.matchAll(/href="(?:\/[^"]*?\/|\.?\/)?(assets\/[^"]+\.css)"/g)].map((m) => m[1]);

const session = closure(entry);
for (const m of read(entry).matchAll(DYNAMIC)) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry), m[1]));
  if (fs.existsSync(path.join(DIST, target))) {
    for (const f of closure(target)) session.add(f);
  }
}

for (const rel of [...session]) {
  for (const m of read(rel).matchAll(DYNAMIC)) {
    if (m[1].startsWith("browserfs-")) {
      for (const f of closure(path.posix.join(path.posix.dirname(rel), m[1]))) session.add(f);
    }
  }
}

// Vite names lazy-app CSS in the entry's dependency table; keep its shell styles and fonts too.
const shellCss = [...new Set([...css, ...[...read(entry).matchAll(/["'](assets\/[^"']+\.css)["']/g)].map((m) => m[1])])];
const shellFonts = [...new Set(shellCss.flatMap((rel) =>
  [...read(rel).matchAll(/url\(["']?\/(assets\/[^"')]+\.woff2?)["']?\)/g)].map((m) => m[1]),
))];

const icons = fs.existsSync(path.join(DIST, "icons"))
  ? fs
      .readdirSync(path.join(DIST, "icons"))
      .filter((f) => f.endsWith(".png"))
      .map((f) => `icons/${f}`)
      .sort()
  : [];
const classicIcons = ["win98", "retrobar"].flatMap((dir) =>
  fs.readdirSync(path.join(DIST, "icons", dir)).filter((f) => f.endsWith(".png")).sort().map((f) => `icons/${dir}/${f}`),
);
const shell = [
  "index.html",
  "manifest.json",
  "pc-icon.png",
  ...icons,
  ...classicIcons,
  ...shellCss,
  ...shellFonts,
  "assets/clippy/agent.json",
  "assets/clippy/sounds.json",
  "assets/clippy/map.png",
  ...[...session].sort(),
];
const precache = shell.map((rel) => `./${rel}`);

// JS Paint's files are not hashed, so its pinned commit names the cache too:
// a new pin must not be served the previous one's cache-first copies.
const hash = crypto
  .createHash("sha256")
  .update(precache.join("\n"))
  .update(fs.readFileSync(path.join(DIST, "jspaint/VERSION")))
  .update(classicIcons.map((rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(DIST, rel))).digest("hex")).join("\n"))
  .digest("hex")
  .slice(0, 12);
const cache = `paint97-shell-${hash}`;

const sw = `/* Generated by scripts/gen-sw.mjs — do not edit (dist/sw.js). */
const CACHE = ${JSON.stringify(cache)};
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const PRECACHED_URLS = new Set(PRECACHE.map((rel) => new URL(rel, self.location.href).href));
const SHELL = new URL("./", self.location.href).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("paint97-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Pass-through (no respondWith): cross-origin bytes, the model among them. Never cached here.
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && (url.pathname === SHELL || url.pathname === SHELL + "index.html")) {
    // Network-first so deploys land immediately; the precached shell is
    // what makes an offline reload still render the app.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Cache-first: hashed assets are immutable; the rest of the shell fills
  // in on first use.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      // Static precache bytes are identical across Origin variants; Vite serves Vary: Origin.
      cache.match(req, { ignoreVary: PRECACHED_URLS.has(url.href) }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    ),
  );
});
`;

fs.writeFileSync(path.join(DIST, "sw.js"), sw);
console.log(
  `  wrote dist/sw.js — ${cache}, ${precache.length} precache entries`,
);
