// On-device model plumbing for Ask Clippy: URL building, SHA-256 integrity
// checks, and the install-into-Cache-Storage flow for the split Gemma-3
// Q4_K_M parts. Everything here is dependency-injected (cache, fetch,
// manifest) so the unit tests run it in plain Node — the app-side binding
// lives in manifest.ts / runtime.ts.

export type ModelPart = { file: string; bytes: number; sha256: string };

export type ModelManifest = {
  model: string;
  quant: string;
  file: string;
  source: string;
  license: string;
  repo: string;
  ref: string;
  totalBytes: number;
  sha256: string;
  parts: ModelPart[];
};

export type DownloadProgress = {
  /** 0-based index of the part being fetched (or just completed). */
  partIndex: number;
  partCount: number;
  /** Bytes of the current part and of the whole model, fetched so far. */
  partLoaded: number;
  partBytes: number;
  loadedBytes: number;
  totalBytes: number;
};

export type InstallOptions = {
  cache: PartCache;
  manifest: ModelManifest;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
};

/** Structural slice of the Cache API so tests can pass a stand-in. */
export type PartCache = {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  /** Mirrors Cache.delete — resolves false when nothing was stored. */
  delete(url: string): Promise<boolean>;
};

export class ModelInstallError extends Error {
  part: number;
  constructor(message: string, part: number) {
    super(message);
    this.name = "ModelInstallError";
    this.part = part;
  }
}

/** raw.githubusercontent.com URL for one committed model part. */
export const partUrl = (repo: string, ref: string, file: string): string =>
  `https://raw.githubusercontent.com/${repo}/${ref}/models/${file}`;

export const partUrlFor = (manifest: ModelManifest, part: ModelPart): string =>
  partUrl(manifest.repo, manifest.ref, part.file);

export const isAbortError = (e: unknown): boolean =>
  e instanceof Error && e.name === "AbortError";

/** Lowercase hex SHA-256 of bytes, via WebCrypto (global in Node ≥ 19). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Structural sanity of the committed manifest; null when it looks right. */
export function validateManifest(m: ModelManifest): string | null {
  if (!m.repo || !m.ref) return "missing repo/ref";
  if (!Array.isArray(m.parts) || m.parts.length === 0) return "no parts";
  let sum = 0;
  for (const p of m.parts) {
    if (!p.file || !Number.isInteger(p.bytes) || p.bytes <= 0) return `bad part ${p.file}`;
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) return `bad sha256 for ${p.file}`;
    sum += p.bytes;
  }
  if (sum !== m.totalBytes) return `part sizes sum to ${sum}, manifest says ${m.totalBytes}`;
  if (!/^[0-9a-f]{64}$/.test(m.sha256)) return "bad whole-file sha256";
  return null;
}

/** True when every part is cached with the expected byte count. */
export async function isModelInstalled(
  cache: PartCache,
  manifest: ModelManifest,
): Promise<boolean> {
  for (const part of manifest.parts) {
    const hit = await cache.match(partUrlFor(manifest, part));
    // Freshly installed parts carry their size (see installModel); a size
    // match against the same-origin cache is enough to trust the bytes —
    // the SHA-256 was already verified on the way in over TLS.
    if (!hit || Number(hit.headers.get("content-length")) !== part.bytes) return false;
  }
  return true;
}

/**
 * Downloads any missing parts, verifies each against the manifest, and
 * stores verified bytes in the cache. Already-cached parts are skipped, so
 * an aborted install resumes where it left off.
 */
export async function installModel(opts: InstallOptions): Promise<void> {
  const { cache, manifest, signal, onProgress } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const parts = manifest.parts;
  let loadedBytes = 0;

  const report = (partIndex: number, partLoaded: number) =>
    onProgress?.({
      partIndex,
      partCount: parts.length,
      partLoaded,
      partBytes: parts[partIndex]!.bytes,
      loadedBytes: loadedBytes + partLoaded,
      totalBytes: manifest.totalBytes,
    });

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const url = partUrlFor(manifest, part);
    const hit = await cache.match(url);
    if (hit && Number(hit.headers.get("content-length")) === part.bytes) {
      // Report before the roll-up: report() computes loadedBytes + partLoaded.
      report(i, part.bytes);
      loadedBytes += part.bytes;
      continue;
    }

    let res: Response;
    try {
      res = await fetchImpl(url, { signal });
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new ModelInstallError(
        `Could not reach GitHub for part ${i + 1} of ${parts.length} — check your connection.`,
        i,
      );
    }
    if (res.status === 404) {
      throw new ModelInstallError(
        `Part ${i + 1} of ${parts.length} is not published yet — the model files must be committed to the public repo (see README).`,
        i,
      );
    }
    if (!res.ok || !res.body) {
      throw new ModelInstallError(
        `Part ${i + 1} of ${parts.length} failed to download (HTTP ${res.status}).`,
        i,
      );
    }

    // Stream the part so the progress bar can move inside a single file.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let partLoaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      partLoaded += value.byteLength;
      report(i, partLoaded);
    }
    const bytes = new Uint8Array(partLoaded);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    if (partLoaded !== part.bytes) {
      throw new ModelInstallError(
        `Part ${i + 1} of ${parts.length} came back as ${partLoaded} bytes, expected ${part.bytes}.`,
        i,
      );
    }
    const hex = await verifyPartHash(bytes, part.sha256, i, parts.length);

    await cache.put(
      url,
      new Response(bytes, {
        headers: {
          "content-length": String(part.bytes),
          "x-paint97-sha256": hex,
        },
      }),
    );
    report(i, part.bytes);
    loadedBytes += part.bytes;
  }
}

/**
 * Removes every manifest part from the cache — the model manager's "free
 * ~253 MB" action. Missing parts are fine (a partial or already-empty
 * cache still ends up clean); real Cache errors propagate to the caller.
 */
export async function deleteModel(opts: {
  cache: PartCache;
  manifest: ModelManifest;
}): Promise<void> {
  for (const part of opts.manifest.parts) {
    await opts.cache.delete(partUrlFor(opts.manifest, part));
  }
}

// Integrity check folded into a ModelInstallError so every install failure
// surfaces through one shape in the UI.
async function verifyPartHash(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
  index: number,
  count: number,
): Promise<string> {
  const hex = await sha256Hex(bytes);
  if (hex !== expected) {
    throw new ModelInstallError(
      `Integrity check failed for part ${index + 1} of ${count} — downloaded bytes do not match the manifest.`,
      index,
    );
  }
  return hex;
}

/** Reads every verified part back out of the cache as one Blob. */
export async function readModelBlob(
  cache: PartCache,
  manifest: ModelManifest,
): Promise<Blob> {
  const blobs: Blob[] = [];
  for (const part of manifest.parts) {
    const res = await cache.match(partUrlFor(manifest, part));
    if (!res || Number(res.headers.get("content-length")) !== part.bytes) {
      throw new ModelInstallError(
        `Part ${part.file} is missing from local storage — download the model again.`,
        manifest.parts.indexOf(part),
      );
    }
    blobs.push(await res.blob());
  }
  return new Blob(blobs, { type: "application/octet-stream" });
}
