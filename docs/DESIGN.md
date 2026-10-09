# Design: win97-excalidraw (rebuild)

A from-scratch rebuild of `win97-excalidraw` ("Paint97") and `clippy-choppy`. Originals untouched.

## Keep
- **Stack**: React 19, TS, Vite, `@excalidraw/excalidraw`, 98.css, `@wllama/wllama`; same pinned versions (known-good on Node ≥ 20.19).
- **Pure modules, ported with their tests**: calculator tokenizer/parser (no `eval`), minesweeper, clock maths, share codec (`#scene=`, deflate + base64url, 32 KB cap), scene validation/size caps, frame export, wallpapers, stickers, KV wrapper over IndexedDB, and the whole `localAi` stack (manifest, per-part SHA-256 verify, Cache Storage, wllama runtime, canvas-command parsing).
- **Build scripts**: CSP-in-`<meta>` plugin + `check-csp-sync`, `check-budget`, `check-assets`, `prepare-model --verify`, `gen-sw`.
- **Assets**: Clippy `map.png/agent.json/sounds.json` (identical in both repos), Gemma-3 270M parts (copied via APFS clone and re-verified against `models/manifest.json`, not re-downloaded), `NOTICE` carried forward.

## Drop
- **`@react95/core`**: it shipped base64 Microsoft Sans Serif and needed a font-stripping plugin; 98.css's MIT pixel faces replace it entirely. Plugin, `check-assets` font guard purpose and ~100 KB of CSS go away.
- **esm.sh in `font-src`**: Excalidraw's fonts are copied into `public/fonts` at build (`scripts/copy-fonts.mjs`) so `font-src` is `'self' data:`.
- **`clippy-choppy.js` as a separate vanilla file and the 640-line `clippyChoppy.ts` copy**: merged (below).
- **`App.tsx` (965 lines)**: split into shell + app plugins.
- Sitemap/robots/OG tags tied to a Vercel URL (nothing is deployed); `vercel.json` kept for the security headers and the CSP sync check.
- The 1,287-line `tests/audit.mjs` script: replaced by Playwright specs in `tests/e2e/` (one runner, per-test isolation, traces on failure).

## Change
| Area | Before | Now |
|---|---|---|
| Windows | one big `App.tsx` with ad-hoc state | one pure reducer (`lib/wm.ts`, unit-tested) behind a `useSyncExternalStore` store; z-order = array order; snap, min/max/restore, persisted layout |
| Apps | hard-wired | plugin table `apps/registry.ts` `{id,title,icon,component,size,singleton}` drives desktop icons, Start menu, taskbar, window content; each app is a lazy chunk |
| Files | flat key-encoded records | index + body records: folders, rename, move, trash with undo, properties, per-drawing version history (pure `lib/fs.ts`) |
| Clippy | two engines | one framework-free `ClippyEngine` (`src/clippy/engine.ts`) with an injected clock and renderer, so each choppy rule is asserted on a fake clock; `dom.ts` renders, `Clippy.tsx` wraps it for React |
| Tips | click or save/export/help only | a pure `tipFor()` decides: explicit actions always get a tip, ambient ones (tool, empty canvas, long idle) respect a 20 s cooldown and each tool is explained once; tip of the day on the first visit each day |
| Ask Clippy | phases as component state, GitHub-only download | model lifecycle is a pure reducer (`modelState.ts`) with pause/resume; parts are fetched from this origin's `/models/` first, then GitHub, hash-verified either way |
| Service worker | precached Excalidraw too | precaches the shell and app chunks only; Excalidraw fills the cache on first use; `/models/` always passes through |
| Settings | scattered localStorage keys | one validated `Settings` store + Control Panel + whole-profile JSON backup/restore |
| i18n | none | typed `en`/`nl` dictionaries; `nl` must cover every `en` key (test + tsc) |
| Zustand | – | not added: `useSyncExternalStore` is ~20 lines |

## Known platform limits (by design)
- Browsers/OS usually swallow **Alt+Tab** and sometimes the **Win key**; the switcher also answers **Alt+\`**, and Start also opens from the taskbar button.
- Old My Drawings data lives under the old origin/profile; no cross-app migration is attempted (use Export → Import of `.excalidraw` files).

## Defaults chosen
- **Port 7891** for dev and preview, so the original app on 7890 can run alongside.
- **Versions**: every explicit save snapshots; autosave snapshots at most every 2 minutes; 10 kept per drawing, oldest dropped.
- **Recycle Bin**: 50 items, oldest evicted. Undo covers rename, move, delete and restore (20 steps, per session). Permanent delete and Empty are not undoable and clear the undo history.
- **Rename and Save As** use a dialog rather than in-place editing: an input inside a listbox option fails WCAG nested-interactive.
- **Moving files** has a keyboard path (Ctrl+X, Ctrl+V) next to drag and drop.
- **Backup** covers localStorage keys under `paint97.` and the app's IndexedDB records. The 253 MB model is not user data and is left out; Reset leaves it installed.
- **Clippy** defaults to scale 2 and sits above the taskbar; his position is remembered. Tip copy is English in all three personalities; the UI around it is translated.
- **CSP**: the brief asks for `script-src 'self'` + `wasm-unsafe-eval` and also for a version-pinned CDN fallback. The fallback needs one extra `script-src` entry, restricted to the exact package version path.
- **Tests are typechecked** (`tsconfig.tests.json`), so "strict, no any" covers them too.
