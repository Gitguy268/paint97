// Clippy asset loading: the vendored local copy first, a version-pinned CDN package second.
import type { AgentData } from "./engine.ts";

// Pinned to an exact npm version: versions are immutable, so this URL can never
// start serving different code (SRI is impossible for dynamic imports; pinning is the control).
// The CSP allows exactly this path prefix and nothing else from the CDN.
export const CDN_PKG = "clippyjs@0.1.0";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/${CDN_PKG}/dist/agents/clippy`;
export const LOCAL_BASE = "assets/clippy";

export type ClippyAssets = { data: AgentData; mapUrl: string; sounds: Readonly<Record<string, string>>; source: "local" | "cdn" };
export type AssetIo = {
  fetchJson(url: string): Promise<unknown>;
  /** Default export of a remote ES module. */
  importDefault(url: string): Promise<unknown>;
};

/**
 * Gate for every URL that reaches <img src>, new Audio() or CSS url(""):
 * same-origin paths, data:/blob: URIs, or the pinned CDN package. Quotes,
 * backslashes and control characters are refused (they could escape url("")).
 */
export function safeAssetUrl(u: unknown): string | null {
  if (typeof u !== "string" || u === "") return null;
  // eslint-disable-next-line no-control-regex
  if (/["'\\\u0000-\u001f\u007f]/.test(u)) return null;
  if (u.startsWith("data:") || u.startsWith("blob:")) return u;
  if (u.startsWith("//")) return null; // protocol-relative = another origin
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // relative = same origin
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith(`/npm/${CDN_PKG}/`) ? url.href : null;
  } catch { return null; }
}

export function isAgentData(v: unknown): v is AgentData {
  if (!v || typeof v !== "object") return false;
  const r = v as { framesize?: unknown; animations?: unknown };
  return Array.isArray(r.framesize) && r.framesize.length === 2 && r.framesize.every((n) => typeof n === "number" && n > 0) && !!r.animations && typeof r.animations === "object";
}

const soundTable = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, u] of Object.entries(v)) { const safe = safeAssetUrl(u); if (safe) out[k] = safe; }
  return out;
};

/** Local first; the CDN only if the local agent data is missing or malformed. Sounds are optional. */
export async function loadClippyAssets(io: AssetIo, base = ""): Promise<ClippyAssets> {
  try {
    const data = await io.fetchJson(`${base}${LOCAL_BASE}/agent.json`);
    if (!isAgentData(data)) throw new Error("bad local agent data");
    const sounds = await io.fetchJson(`${base}${LOCAL_BASE}/sounds.json`).then(soundTable, () => ({}));
    return { data, mapUrl: `${base}${LOCAL_BASE}/map.png`, sounds, source: "local" };
  } catch (localErr) {
    try {
      const data = await io.importDefault(`${CDN_BASE}/agent.mjs`);
      const mapUrl = safeAssetUrl(await io.importDefault(`${CDN_BASE}/map.mjs`));
      if (!isAgentData(data) || !mapUrl) throw new Error("bad CDN agent data", { cause: localErr });
      const sounds = await io.importDefault(`${CDN_BASE}/sounds-mp3.mjs`).then(soundTable, () => ({}));
      return { data, mapUrl, sounds, source: "cdn" };
    } catch (cdnErr) {
      throw new Error(`clippy assets unavailable (local: ${String(localErr)})`, { cause: cdnErr });
    }
  }
}

export const browserIo: AssetIo = {
  async fetchJson(url) {
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    return r.json() as Promise<unknown>;
  },
  importDefault: async (url) => ((await import(/* @vite-ignore */ url)) as { default?: unknown }).default,
};
