// MiniCPM-V's two GGUF files as the 64 MiB byte ranges Ask Clippy downloads, checks and
// caches one at a time. Pure, so the unit tests run it on the committed manifest in Node.

export type ModelManifest = {
  repo: string;
  revision: string;
  files: Record<string, { totalSize: number; sha256: string; chunks: { size: number; sha256: string }[] }>;
};

export type ModelRange = {
  /** Index of the file the range belongs to, in load order (language model, then projector). */
  file: number;
  url: string;
  /** Cache Storage key. A query, not a #fragment: the Cache API ignores fragments when matching. */
  key: string;
  start: number;
  size: number;
  sha256: string;
};

/** Every range of every file, in load order. */
export function planRanges(m: ModelManifest): ModelRange[] {
  const base = `https://huggingface.co/${m.repo}/resolve/${m.revision}/`;
  return Object.entries(m.files).flatMap(([name, f], file) => {
    let start = 0;
    return f.chunks.map((c, i) => {
      const range = { file, url: base + name, key: `${base}${name}?part=${i}`, start, size: c.size, sha256: c.sha256 };
      start += c.size;
      return range;
    });
  });
}

/** Lowercase hex SHA-256 of bytes, via WebCrypto. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
