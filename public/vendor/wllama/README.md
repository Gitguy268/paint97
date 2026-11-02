# wllama, vendored

llama.cpp compiled to WebAssembly, with its WebGPU backend, as Ask Clippy's engine
(`src/lib/localAi/runtime.ts`). Loaded on demand from this origin; nothing comes from a CDN.

| | |
|---|---|
| Project | [ngxson/wllama](https://github.com/ngxson/wllama), MIT (`LICENSE`); llama.cpp is MIT too (`LICENSE-llama.cpp`) |
| Version | 3.11.0, built from [`1a5687ef7c`](https://github.com/ngxson/wllama/commit/1a5687ef7c8b349a8bded4db334ae9c687c09b8c) on `master` (llama.cpp `5c8854f`). The 3.8.1 release on npm cannot load MiniCPM-V 4.7 |

| File | What it is |
|---|---|
| `wllama.js` | The ESM bundle (`esm/index.min.js`); its worker runs from a blob URL |
| `wllama.wasm` | llama.cpp for browsers with JSPI and 64-bit memory (`src/wasm/wllama.wasm`) |
| `wllama-compat.js`, `wllama-compat.wasm` | The wasm32 build for the rest, handed to `setCompat()` (`compat/wasm/`) |

Built with `git checkout 1a5687ef7c && git submodule update --init && npm ci && npm run build:wasm && npm run build`
(the wasm step runs emscripten in Docker). `tests/unit/modelPin.test.ts` checks both wasm files know `minicpmv4_7`.
