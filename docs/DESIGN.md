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
- Sitemap/robots/OG tags tied to a Vercel URL (nothing is deployed); Vercel config kept only for CSP header sync.

## Change
| Area | Before | Now |
|---|---|---|
| Windows | one big `App.tsx` with ad-hoc state | one pure reducer (`lib/wm.ts`, unit-tested) behind a `useSyncExternalStore` store; z-order = array order; snap, min/max/restore, persisted layout |
| Apps | hard-wired | plugin table `apps/registry.ts` `{id,title,icon,component,size,singleton}` drives desktop icons, Start menu, taskbar, window content; each app is a lazy chunk |
| Files | flat key-encoded records | index + body records: folders, rename, move, trash with undo, properties, per-drawing version history (pure `lib/fs.ts`) |
| Clippy | two engines | one framework-free `ClippyEngine` with injected scheduler/renderer so choppy rules are testable with fake clocks, plus a thin React wrapper |
| Settings | scattered localStorage keys | one validated `Settings` store + Control Panel + whole-profile JSON backup/restore |
| i18n | none | typed `en`/`nl` dictionaries; `nl` must cover every `en` key (test + tsc) |
| Zustand | – | not added: `useSyncExternalStore` is ~20 lines |

## Known platform limits (by design)
- Browsers/OS usually swallow **Alt+Tab** and sometimes the **Win key**; the switcher also answers **Alt+\`**, and Start also opens from the taskbar button.
- Old My Drawings data lives under the old origin/profile; no cross-app migration is attempted (use Export → Import of `.excalidraw` files).
