# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Paint97: **File → Send to a device** and **Receive from a device** send the open drawing to Paint97 on another device on the same Wi-Fi over WebRTC, with no server. Pairing is by QR code, scanned with the camera (`BarcodeDetector`, or jsQR) or pasted, and the receiver accepts before anything is sent. A `#rtc=` link opens Receive. Ideas from LocalSend and qrcp, no code. New dependencies: `jsqr` 1.4.0 (Apache-2.0) and `qrcode-generator` 2.0.4 (MIT), both lazy-loaded.
- The first public version: the Windows 9x desktop shell, Paint97, Notepad, My Drawings with a Recycle Bin, Calculator, Minesweeper, Clock, Control Panel, Clippy and Ask Clippy.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull request templates, `CODEOWNERS` and a Dependabot configuration.
- Licence texts for the bundled fonts in `public/licenses/`.
- PC Emulator: an x86 PC in a window, built on v86. It boots a bundled FreeDOS floppy or a disk image you open from your own machine.
- JS Paint: [1j01/jspaint](https://github.com/1j01/jspaint) in a window, self-hosted from a pinned commit that `scripts/copy-jspaint.mjs` fetches at build time. Its picture is kept when the window is closed, and it works offline after its first open.

### Changed

- `Permissions-Policy` allows `camera=(self)` on the main rule, for Send to a device. `/jspaint/` keeps `camera=()`, and `npm run check:csp` checks it.
- A build now needs `git` and access to GitHub the first time, to fetch JS Paint.
- `frame-src` allows `'self'`, and paths under `/jspaint/` are served with `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, `frame-src 'self'` and `connect-src 'self' data: blob:`. Every other path keeps `DENY` and `frame-ancestors 'none'`.
- The service worker treats only top-level page loads as the shell. A framed page no longer replaces the cached `index.html`.
- Dragging or resizing a window keeps working while the pointer crosses a frame.
- Windows keep their opening order in the page and are stacked by `z-index` alone. Bringing one to the front used to move its node, which would reload a framed app.
- Reset all data also deletes the pictures JS Paint has autosaved.
- Ask Clippy runs MiniCPM-V 4.7 1B (Apache-2.0) through a vendored wllama `master` build, on WebGPU when the browser has it and on the CPU otherwise. It replaces Qwen2.5 1.5B on WebLLM, and before that Gemma 3 270M. The 1573 MB model is downloaded from Hugging Face at a pinned revision, in 64 MiB ranges that are each SHA-256-checked before they are cached. `connect-src` allows `huggingface.co` and `*.hf.co`; `raw.githubusercontent.com` is gone. Old model caches are deleted.
- Ask Clippy can look at the drawing (**Look at my drawing** sends the canvas as a picture) and draw diagrams (**Diagram** asks for Mermaid code, which lands on the canvas as shapes after Apply).
- `LICENSE`, `NOTICE` and the README now state that the MIT licence covers the code only: the Clippy artwork belongs to Microsoft, and the model weights keep their own licence.
- `NOTICE` lists every bundled font with its real licence. The pixel font from 98.css is CC BY-SA 3.0, not MIT.
