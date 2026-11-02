// #scene= share links: the scene payload is DEFLATE-compressed and
// base64url-encoded into the URL hash, so a drawing travels inside the link
// itself — no server, nothing uploaded. Decoding runs the same shape
// validation as file open (parseSceneJson), so a hostile link can never put
// unvalidated data on the canvas.
//
// 32 KB cap: browsers accept far longer URLs, but proxies, chat apps and
// mail clients truncate around 2–8 KB … 64 KB; 32 KB keeps links whole in
// the common cases while still fitting real drawings (compressed JSON is
// dense — the cap is on the *encoded* string).
import { buildScenePayload, parseSceneJson } from "./storage.ts";

export const SHARE_PREFIX = "#scene=";
export const MAX_SHARE_LENGTH = 32 * 1024;
// Refuse to even compress absurd payloads — a scene this large could never
// fit under the encoded cap anyway, and stringifying megabytes of elements
// just to discover that would stall the tab.
export const MAX_SHARE_INPUT = 4 * 1024 * 1024;

type Bytes = Uint8Array<ArrayBuffer>;

export const toBase64Url = (bytes: Bytes): string => {
  // Chunked: String.fromCharCode.apply blows the arg limit on big arrays.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromBase64Url = (s: string): Bytes => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const transform = (input: Bytes, stream: TransformStream<Bytes, Bytes>): Promise<Bytes> =>
  new Response(new Blob([input]).stream().pipeThrough(stream)).arrayBuffer().then((buf) => new Uint8Array(buf));

const deflate = (bytes: Bytes): Promise<Bytes> =>
  transform(bytes, new CompressionStream("deflate") as TransformStream<Bytes, Bytes>);

const inflate = (bytes: Bytes): Promise<Bytes> =>
  transform(bytes, new DecompressionStream("deflate") as TransformStream<Bytes, Bytes>);

export const encodeText = (text: string): Promise<Bytes> =>
  deflate(new TextEncoder().encode(text));

export const decodeText = (bytes: Bytes): Promise<string> =>
  inflate(bytes).then((out) => new TextDecoder().decode(out));

/** Encoded `#scene=…` hash for the current scene, or null when it won't fit. */
export async function encodeScene(elements: unknown, appState: unknown): Promise<string | null> {
  try {
    const json = JSON.stringify(buildScenePayload(elements, appState));
    if (json.length > MAX_SHARE_INPUT) return null;
    const encoded = toBase64Url(await encodeText(json));
    if (encoded.length > MAX_SHARE_LENGTH) return null;
    return SHARE_PREFIX + encoded;
  } catch {
    return null;
  }
}

/** Scene from a `#scene=…` hash — null for anything malformed or hostile. */
export async function decodeScene(hash: string): Promise<{ elements: object[]; appState: object } | null> {
  try {
    if (!hash.startsWith(SHARE_PREFIX)) return null;
    const encoded = hash.slice(SHARE_PREFIX.length);
    if (!encoded || encoded.length > MAX_SHARE_LENGTH) return null;
    const json = await decodeText(fromBase64Url(encoded));
    if (json.length > MAX_SHARE_INPUT) return null;
    return parseSceneJson(JSON.parse(json));
  } catch {
    return null;
  }
}
