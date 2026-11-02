#!/usr/bin/env node
// Self-host JS Paint (public/jspaint, gitignored) — no dependencies (Node >= 20, git).
// Fetches https://github.com/1j01/jspaint at a pinned commit, copies what the app loads at
// runtime and removes the requests it would make to other origins.
// To update: change SHA, run `npm run check && npm run test:e2e`, and review NOTICE.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SHA = "53be67ab8c47cc0d2168899e7481bc04839c4c81";
const SRC = "node_modules/.cache/jspaint";
const OUT = "public/jspaint";

const KEEP = ["index.html", "favicon.ico", "manifest.webmanifest", "LICENSE.txt", "src", "styles", "lib", "images", "help", "localization", "audio"];
// Sources, tooling and the Electron/Discord builds; the upstream homepage's stylesheet and images;
// the MS Paint screenshots behind a developer-only overlay;
// the Windows resource files localization/*/localizations.js was generated from;
// multi-user sessions (Firebase), pdf.js's viewer, and the head tracker's models,
// which need the camera this app's Permissions-Policy turns off.
const DROP = new RegExp([
  String.raw`\.(map|psd|blend|pdf|md|patch|d\.ts)$`,
  String.raw`(^|/)(package(-lock)?\.json|cspell\.json|eslint\.config\.m?js)$`,
  String.raw`^localization/([^/]+\.(js|sh)$|[^/]+/(?!localizations\.js$))`,
  String.raw`^src/(electron-|discord-)`,
  String.raw`^styles/about\.css$`,
  String.raw`^images/(88x31(/|$)|mspaint-win98-reference)`,
  String.raw`^lib/(discord-|firebase\.js$)`,
  String.raw`^lib/pdf\.js/web(/|$)`,
  String.raw`^lib/tracky-mouse/(desktop-app|website|core/lib)(/|$)`,
  String.raw`^lib/tracky-mouse/images/(?!tracky-mouse-logo-512\.png$)`,
].join("|"));

const git = (...args) => execFileSync("git", ["-C", SRC, ...args], { encoding: "utf8" }).trim();
// A commit id is a hash of the content, so fetching by id is the integrity check.
if (!fs.existsSync(path.join(SRC, ".git")) || git("rev-parse", "HEAD") !== SHA) {
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(SRC, { recursive: true });
  git("init", "-q");
  git("fetch", "-q", "--depth", "1", "https://github.com/1j01/jspaint.git", SHA);
  git("checkout", "-q", "FETCH_HEAD");
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const name of KEEP) {
  fs.cpSync(path.join(SRC, name), path.join(OUT, name), {
    recursive: true,
    filter: (src) => !DROP.test(path.relative(SRC, src).replaceAll(path.sep, "/")),
  });
}

const edit = (file, pattern, replacement) => {
  const p = path.join(OUT, file);
  const before = fs.readFileSync(p, "utf8");
  const after = before.replace(pattern, replacement);
  assert.notEqual(after, before, `${file}: ${pattern} matched nothing. Upstream changed; review this patch.`);
  fs.writeFileSync(p, after);
};
// The news screenshots sit in a hidden block, and hidden <img>s still load: every open would fetch them from other sites.
edit("index.html", /<img\b[^>]*\bsrc="https?:\/\/[^"]+"[^>]*>/g, "");
// The upstream homepage and privacy policy describe jspaint.app, so they are linked rather than shipped.
edit("index.html", /href="(about|privacy)\.html"/g, 'href="https://jspaint.app/$1.html"');
edit("src/error-handling-basic.js", /href="about\.html"/g, 'href="https://jspaint.app/about.html"');
// What cannot work here is greyed out in the menus rather than left to fail with an error: it needs another host
// (any URL, Imgur, Firebase), the camera or the microphone, and this app's CSP and Permissions-Policy refuse all of them.
for (const label of ["&Load From URL", "&Upload To Imgur", "&Multi-User", "Head Tracker"]) {
  edit("src/menus.js", `label: localize("${label}")`, `enabled: false, label: localize("${label}")`);
}
edit("src/menus.js", "enabled: () => speech_recognition_available,", "enabled: false,");
// The winter theme pulls two display faces from Google Fonts; without them it falls back to the system font.
edit("styles/themes/winter.css", /^@import url\("https:[^\n]*\n/m, "");

const remote = [];
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(p);
    else if (/\.(html|css)$/.test(entry.name) && /\bsrc="https?:|@import\s+(url\()?["']?https?:|url\(["']?https?:/.test(fs.readFileSync(p, "utf8"))) remote.push(p);
  }
};
scan(OUT);
assert.deepEqual(remote, [], "JS Paint would load from another origin; patch it out above");

fs.writeFileSync(path.join(OUT, "VERSION"), `${SHA}\n`);
console.log(`  copied JS Paint ${SHA.slice(0, 7)} to ${OUT}`);
