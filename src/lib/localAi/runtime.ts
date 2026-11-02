// Browser-side runtime for Ask Clippy: wllama (llama.cpp in WebAssembly) running
// MiniCPM-V 4.7 1B, which also reads images. wllama puts every layer on the GPU through
// WebGPU when the browser has it and runs on the CPU otherwise.
//
// The two GGUF files (the language model and its image projector) come from Hugging Face
// at a pinned revision, in 64 MiB ranges: each range is checked against the SHA-256 in
// minicpm-v.json before it is cached, so a pause keeps every range that finished and a
// tampered one never reaches the cache. The engine is vendored under public/vendor/wllama/
// (a master build: the 3.8.1 release cannot load this model) and only ever imported on
// demand, so it stays out of the desktop shell.
import raw from "./minicpm-v.json?raw";
import { GENERATION } from "./chat";
import { planRanges, sha256Hex, type ModelManifest } from "./modelFiles";
import type { DownloadProgress } from "./modelState";

export const MODEL_NAME = "MiniCPM-V 4.7 1B";
const MANIFEST = JSON.parse(raw) as ModelManifest;
const RANGES = planRanges(MANIFEST);
const MODEL_BYTES = RANGES.reduce((n, r) => n + r.size, 0);
// Named after the revision: a new model ships under a new name, and the old bucket is dropped.
const CACHE = `paint97-minicpm-v-${MANIFEST.revision.slice(0, 8)}`;
const VENDOR = `${import.meta.env.BASE_URL}vendor/wllama/`;

type Part = { type: "text"; text: string } | { type: "image"; data: ArrayBuffer };
export type EngineMessage = { role: "system" | "user" | "assistant"; content: string | Part[] };
export type GenerationOptions = { temperature: number; max_tokens: number };

export type Engine = {
  /** Streams one assistant reply; deltas arrive via onDelta. Rejects with an AbortError when stopped. */
  chat: (
    messages: EngineMessage[],
    onDelta: (text: string) => void,
    signal?: AbortSignal,
    options?: GenerationOptions,
  ) => Promise<void>;
  /** Best-effort teardown: frees the GPU and wasm memory. Absent on test doubles. */
  close?: () => Promise<void>;
};

// Only the slice of the vendored bundle this file calls.
type Wllama = {
  setCompat(paths: { worker: string; wasm: string }): void;
  loadModel(blobs: Blob[], params: Record<string, unknown>): Promise<void>;
  createChatCompletion(params: Record<string, unknown>): Promise<AsyncIterable<{ choices: { delta: { content?: string } }[] }>>;
  exit(): Promise<void>;
};
type WllamaModule = { Wllama: new (paths: { default: string }, config: { suppressNativeLog: boolean }) => Wllama };

// Test seam for the e2e suite: a scripted engine factory injected with
// page.addInitScript, so CI (no GPU, no 1.6 GB download) can drive the model
// manager and the reply path. The app itself never sets it.
declare global {
  var __p97EngineFactory: ((onProgress?: (p: DownloadProgress) => void, signal?: AbortSignal) => Engine | Promise<Engine>) | undefined;
}

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** Null when this browser can run the model, else the missing capability. wllama's compat build covers browsers without JSPI or 64-bit memory. */
export function browserSupport(): Promise<string | null> {
  return Promise.resolve(globalThis.__p97EngineFactory || typeof WebAssembly === "object" ? null : "WebAssembly");
}

export async function isModelCached(): Promise<boolean> {
  if (globalThis.__p97EngineFactory) return true;
  // Free what earlier runtimes kept: wllama's 253 MB Gemma buckets, WebLLM's 880 MB Qwen ones, older revisions.
  for (const name of await caches.keys()) {
    if (name !== CACHE && (name.startsWith("paint97-model-") || name.startsWith("paint97-minicpm-v-") || name.startsWith("webllm/"))) void caches.delete(name);
  }
  return (await (await caches.open(CACHE)).keys()).length === RANGES.length;
}

/** Drops the cached model (frees ~1.6 GB of Cache Storage). */
export async function deleteModelFromCache(): Promise<void> {
  await caches.delete(CACHE);
}

export const modelSizeLabel = (): string => `${Math.round(MODEL_BYTES / 1e6)} MB`;

/** Fetches, checks and caches every range not cached yet. Aborting pauses; finished ranges stay. */
async function download(cache: Cache, onProgress?: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  let loaded = 0;
  const report = (extra: number) => onProgress?.({ loadedBytes: loaded + extra, totalBytes: MODEL_BYTES });
  for (const [i, r] of RANGES.entries()) {
    const where = `part ${i + 1} of ${RANGES.length}`;
    if (await cache.match(r.key)) {
      loaded += r.size;
      report(0);
      continue;
    }
    let res: Response;
    try {
      res = await fetch(r.url, { headers: { Range: `bytes=${r.start}-${r.start + r.size - 1}` }, signal });
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new Error(`Could not reach Hugging Face for ${where}. Check your connection.`, { cause: e });
    }
    if (!res.ok || !res.body) throw new Error(`Downloading ${where} failed (HTTP ${res.status}).`);
    // Streamed so the bar moves inside a 64 MiB range.
    const reader = res.body.getReader();
    const pieces: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pieces.push(value);
      got += value.byteLength;
      report(got);
    }
    if (got !== r.size) throw new Error(`The model's ${where} came back as ${got} bytes, expected ${r.size}.`);
    const bytes = new Uint8Array(got);
    let at = 0;
    for (const p of pieces) { bytes.set(p, at); at += p.byteLength; }
    if ((await sha256Hex(bytes)) !== r.sha256) throw new Error(`Integrity check failed for the model's ${where}: the bytes do not match the pinned hash.`);
    await cache.put(r.key, new Response(bytes));
    loaded += r.size;
    report(0);
  }
}

/**
 * Downloads whatever is not cached yet, then loads the model (onto the GPU when there is one).
 * Aborting the signal pauses: finished ranges stay cached, so the next call resumes.
 */
export async function createEngine(onProgress?: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<Engine> {
  const scripted = globalThis.__p97EngineFactory;
  if (scripted) return scripted(onProgress, signal);
  signal?.throwIfAborted();
  const cache = await caches.open(CACHE);
  await download(cache, onProgress, signal);
  // One Blob per file, built from the cached ranges: Cache Storage hands them back disk-backed.
  const parts: Blob[][] = [];
  for (const r of RANGES) {
    const hit = await cache.match(r.key);
    if (!hit) throw new Error("Part of the model is missing from this device. Download it again.");
    (parts[r.file] ??= []).push(await hit.blob());
  }
  signal?.throwIfAborted();

  const { Wllama } = (await import(/* @vite-ignore */ `${VENDOR}wllama.js`)) as WllamaModule;
  const w = new Wllama({ default: `${VENDOR}wllama.wasm` }, { suppressNativeLog: true });
  // Both builds are vendored: upstream points the compat pair at jsDelivr, which the CSP refuses.
  w.setCompat({ worker: `${VENDOR}wllama-compat.js`, wasm: `${VENDOR}wllama-compat.wasm` });
  const pause = () => void w.exit().catch(() => undefined);
  signal?.addEventListener("abort", pause);
  try {
    // MiniCPM reasons out loud first unless its chat template is told not to.
    await w.loadModel(parts.map((p) => new Blob(p)), { n_ctx: 4096, default_template_kwargs: { enable_thinking: false } });
    signal?.throwIfAborted();
  } catch (e) {
    await w.exit().catch(() => undefined);
    signal?.throwIfAborted();
    // A private window keeps every Blob in memory and Chrome there gives up reading back a model this size.
    if (e instanceof Error && /NotReadableError/.test(e.message)) throw new Error("This window could not hold the model. In a private window, try a normal one.", { cause: e });
    throw e;
  } finally {
    signal?.removeEventListener("abort", pause);
  }

  return {
    async chat(messages, onDelta, stop, options = GENERATION) {
      try {
        const stream = await w.createChatCompletion({ messages, stream: true, abortSignal: stop, ...options });
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta.content;
          if (text) onDelta(text);
        }
      } catch (e) {
        stop?.throwIfAborted();
        throw e;
      }
      // A stopped reply must not count as finished: it could draw.
      stop?.throwIfAborted();
    },
    close: () => w.exit().catch(() => undefined),
  };
}
