# Design: win97-excalidraw (rebuild)

A from-scratch rebuild of `win97-excalidraw` ("Paint97") and `clippy-choppy`. Originals untouched.

## Keep
- **Stack**: React 19, TS, Vite, `@excalidraw/excalidraw`, 98.css; same pinned versions (known-good on Node ≥ 20.19).
- **Pure modules, ported with their tests**: calculator tokenizer/parser (no `eval`), minesweeper, clock maths, share codec (`#scene=`, deflate + base64url, 32 KB cap), scene validation/size caps, frame export, wallpapers, stickers, KV wrapper over IndexedDB, and the `localAi` prompt and canvas-command logic.
- **Build scripts**: CSP-in-`<meta>` plugin + `check-csp-sync`, `check-budget`, `check-assets`, `gen-sw`.
- **Assets**: Clippy `map.png/agent.json/sounds.json` (identical in both repos), `NOTICE` carried forward.

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
| Ask Clippy | phases as component state, GitHub-only download | model lifecycle is a pure reducer (`modelState.ts`) with pause/resume; wllama runs MiniCPM-V 4.7 1B from Hugging Face, on WebGPU when it can |
| Service worker | precached Excalidraw too | precaches the shell and app chunks only; Excalidraw fills the cache on first use; cross-origin requests, the model among them, pass through |
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
- **Backup** covers localStorage keys under `paint97.` and the app's IndexedDB records. The 1.6 GB model is not user data and is left out; Reset leaves it installed.
- **Clippy** defaults to scale 2 and sits above the taskbar; his position is remembered. Tip copy is English in all three personalities; the UI around it is translated.
- **CSP**: the brief asks for `script-src 'self'` + `wasm-unsafe-eval` and also for a version-pinned CDN fallback. The fallback needs one extra `script-src` entry, restricted to the exact package version path.
- **Ask Clippy runs MiniCPM-V 4.7 1B on wllama** again, after a spell on WebLLM with Qwen2.5 1.5B. MiniCPM-V reads images, which is what "Look at my drawing" needs, and it scores about as well as Qwen3.5 2B while running three times faster. WebLLM cannot run it: its language model is the hybrid linear-attention `qwen35` architecture. wllama's WebGPU backend does run it, and it falls back to the CPU where there is no GPU, so no browser is turned away. The npm release (3.8.1) cannot load this model, so a `master` build is vendored under `public/vendor/wllama/`. The model comes from Hugging Face at a pinned revision, in 64 MiB byte ranges that are each checked against a SHA-256 before they are cached, which brings back the per-part check WebLLM had lost and makes pause and resume exact. `connect-src` keeps `huggingface.co` and `*.hf.co` and drops `raw.githubusercontent.com`. Without cross-origin isolation the engine runs single-threaded in its worker. "Diagram" asks under the system prompt the planned mermaid fine-tune (`~/minimind-mermaid`) is trained behind, so a tuned GGUF can replace the base one without app changes.
- **PC Emulator** (v86) runs with the speaker off: its audio worklet loads from a `blob:` URL, which `script-src` refuses, and the policy is not loosened for it. v86 listens for keys on `window`, so they are forwarded only while the emulated screen has focus. The guest needs Tab and Escape, so Ctrl+Alt is the keyboard way out of the screen. The machine is paused whenever its window is not the active one. It has no network device, so `connect-src` is unchanged. Start menu only, no desktop icon.
- **JS Paint** is the upstream app, unmodified apart from what `scripts/copy-jspaint.mjs` strips, in a same-origin `<iframe>`. Self-hosting it (rather than embedding jspaint.app) keeps the no-third-party and offline promises, and same origin is what lets the host give it window behaviour: a click inside activates the window and closes an open Start menu, the shell's shortcuts (Alt+Tab, Alt+\`, the Win key) are repeated to the host window, File > Exit closes it, and the last session id is remembered so the picture comes back. Windows are stacked by `z-index` and keep opening order in the DOM for its sake: moving an `<iframe>`'s ancestor reloads it. It is fetched at build time, pinned by commit, and not committed. `/jspaint/` has its own response headers because the main ones forbid all framing. It is not sandboxed: it needs scripts and same-origin storage, and a frame with both can lift a sandbox. Its pictures live in localStorage under its own keys; they are outside the backup, and Reset removes them. Start menu only.
- **Tests are typechecked** (`tsconfig.tests.json`), so "strict, no any" covers them too.
- **Restoring a version** first snapshots the current state if it changed since the last snapshot, so autosaved work is never overwritten without a way back.
- **Drag and drop** carries the node id on the drag event, so a drawing can be dragged between two My Drawings windows as well as onto a folder row.

## Known gaps
- English only: Clippy's tip copy, the description in the "Clippy wants to draw" dialog, and model install error messages (they come from framework-free modules that return text).
- The Clippy CDN fallback is unit-tested with a fake loader, not exercised in a real browser.
- No e2e coverage for the Win key, the zoom indicator or copy-to-clipboard.
- macOS visual baselines are local and gitignored; CI writes and owns the Linux set.
