// Browser-side runtime for Ask Clippy: capability probes, model install
// orchestration, and the wllama (llama.cpp → WASM) lifecycle.
//
// Everything that touches the network or Cache Storage goes through the
// dependency-injected helpers in model.ts; this file is the browser binding.
import wasmUrl from "@wllama/wllama/src/wasm/wllama.wasm?url";
// Deep path on purpose: the package's bare entry resolves to its raw
// TypeScript sources (root index.ts), which would pull non-erasable syntax
// (enums) into this project's type-check. esm/index.js is the published
// flat bundle; its sibling index.d.ts carries the types.
import type { ChatCompletionMessage, ChatCompletionChunk } from "@wllama/wllama/esm/index.js";
import { GENERATION } from "./chat";
import {
  MODEL_MANIFEST,
  openModelCache,
  pruneModelCaches,
} from "./manifest";
import { installModel, isModelInstalled, deleteModel, readModelBlob, type DownloadProgress } from "./model";

// --- capability probes ------------------------------------------------------
// Byte sequences and the mem64 constructor probe mirror wasm-feature-detect
// (Apache-2.0) as used by @wllama/wllama — the runtime needs exception
// handling, SIMD and 64-bit memory; older browsers get a clear message
// instead of a failed 253 MB download.

const EXCEPTIONS_WASM = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0,
  6, 64, 25, 11, 11,
]);

const SIMD_WASM = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
  8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

const hasMem64 = (): boolean => {
  try {
    const memory = new WebAssembly.Memory({
      address: "i64",
      initial: 1n,
    } as unknown as WebAssembly.MemoryDescriptor);
    return !!memory;
  } catch {
    return false;
  }
};

const hasGpu = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as { gpu?: unknown }).gpu;
  return gpu !== undefined && gpu !== null;
};

/** True when the browser can run the bundled wasm build at all. */
export function browserSupport(): string | null {
  if (!WebAssembly.validate(EXCEPTIONS_WASM)) return "WebAssembly exception handling";
  if (!WebAssembly.validate(SIMD_WASM)) return "WebAssembly SIMD";
  if (!hasMem64()) return "WebAssembly 64-bit memory";
  return null;
}

// JSPI is optional (the runtime falls back to synchronous file writes) but
// without it wllama's WebGPU path is unreliable, so it gates the GPU attempt.
const hasJspi = (): boolean => !!(WebAssembly as { Suspending?: unknown }).Suspending;

// --- install ----------------------------------------------------------------

export const installModelToCache = (
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> =>
  openModelCache().then((cache) => {
    // A new model revision may have shipped since this profile last cached
    // one; drop the old bucket before filling the new one.
    void pruneModelCaches();
    return installModel({ cache, manifest: MODEL_MANIFEST, onProgress, signal });
  });

export async function isModelCached(): Promise<boolean> {
  return isModelInstalled(await openModelCache(), MODEL_MANIFEST);
}

/** Drops the cached parts (frees ~253 MB of Cache Storage). */
export function deleteModelFromCache(): Promise<void> {
  return openModelCache().then((cache) => deleteModel({ cache, manifest: MODEL_MANIFEST }));
}

export function modelSizeLabel(): string {
  return `${Math.round(MODEL_MANIFEST.totalBytes / 1e6)} MB`;
}

/** "6 parts · 253 MB" — the model-manager status line's facts. */
export function modelStatusLabel(): string {
  return `${MODEL_MANIFEST.parts.length} parts · ${modelSizeLabel()}`;
}

// --- runtime ----------------------------------------------------------------

// Test seam for the e2e suite: the audit injects a scripted engine factory
// here (page.evaluate) so CI can drive Ask Clippy's reply path without ever
// running real inference or downloading the 253 MB model. The app itself
// never sets it — production only ever reads it as undefined.
declare global {
  var __p97EngineFactory: (() => Engine) | undefined;
}

export type Engine = {
  /** Streams one assistant reply; deltas arrive via onDelta. */
  chat: (
    messages: ChatCompletionMessage[],
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  /** Best-effort teardown: frees the wasm instance. Absent on test doubles. */
  close?: () => Promise<void>;
};

/** Loads the cached model into a fresh single-threaded worker instance. */
export async function createEngine(): Promise<Engine> {
  const scripted = globalThis.__p97EngineFactory;
  if (scripted) return scripted();
  const blob = await readModelBlob(await openModelCache(), MODEL_MANIFEST);
  // Deep path — see the note on the type import above.
  const { Wllama } = await import("@wllama/wllama/esm/index.js");

  const boot = async (gpu: boolean): Promise<InstanceType<typeof Wllama>> => {
    const w = new Wllama({ default: wasmUrl }, { suppressNativeLog: true });
    // Never fetch runtime bits from a CDN: compat mode would pull its worker
    // and wasm from jsdelivr, which our CSP deliberately refuses.
    w.setCompat(null);
    try {
      await w.loadModel([blob], {
        n_ctx: 2048,
        // Single-threaded on purpose: without COOP/COEP headers there is no
        // cross-origin isolation, so pthreads are unavailable anyway. Keeps
        // the site free of headers that would break the CDN fallback.
        n_threads: 1,
        ...(gpu ? {} : { n_gpu_layers: 0 }),
      });
      return w;
    } catch (e) {
      await w.exit().catch(() => undefined);
      throw e;
    }
  };

  // WebGPU first when the environment looks capable; fall back to CPU once
  // rather than failing outright (adapter-less machines are common).
  const wantGpu = hasJspi() && hasGpu();
  let w: InstanceType<typeof Wllama>;
  try {
    w = await boot(wantGpu);
  } catch (e) {
    if (!wantGpu) throw e;
    w = await boot(false);
  }

  return {
    async chat(messages, onDelta, signal) {
      await w.createChatCompletion({
        messages,
        stream: true,
        temperature: GENERATION.temperature,
        max_tokens: GENERATION.max_tokens,
        abortSignal: signal,
        onData: (chunk: ChatCompletionChunk) => {
          const text = chunk.choices[0]?.delta?.content;
          if (text) onDelta(text);
        },
      });
    },
    // Teardown is best-effort: the model manager calls this before
    // deleting the cached parts so a re-download doesn't stack a second
    // 253 MB wasm instance on top of the first.
    close: () => w.exit().catch(() => undefined),
  };
}
