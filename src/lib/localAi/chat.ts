// Prompt-side logic for Ask Clippy: the system prompt, a one-line summary of
// the open drawing (fed to the model so it can talk about what you drew),
// history trimming, and reply cleanup. Pure functions — unit-tested in Node.

export type ChatMsg = { role: "user" | "assistant"; content: string };

// The model is tiny (270M params): short answers keep quality up and latency
// down. 200 tokens leaves room for a <canvas> command block plus a sentence
// or two of prose. Spread into wllama's createChatCompletion().
export const GENERATION = { temperature: 0.7, max_tokens: 200 } as const;

// Greeting shown in an empty transcript — a UI hint, not model output.
export const CHAT_HINT =
  "Clippy runs fully offline on this device. Ask about your drawing or anything else.";

const SYSTEM_BASE = [
  "You are Clippy, the Office Assistant inside Paint97, a Windows-95-style drawing app.",
  "Answer in at most three short sentences, in a helpful, lightly playful voice.",
  "Never claim to have internet access or to control other programs.",
].join(" ");

// How the model may ask to draw: exactly one strict block, and only when
// asked. Every claim made here is enforced by validateCanvasCommand below —
// the prompt teaches, the validator decides.
const CANVAS_RULE = [
  "To draw on the whiteboard, end your reply with exactly one block of the form",
  '<canvas>{"tool":"rectangle","x":100,"y":100,"w":300,"h":200,"stroke":"#1e1e1e","fill":"transparent","text":""}</canvas>',
  "- tool is one of rectangle, ellipse, diamond, arrow, line, text; x/y is the top-left position (clamped to -50000…50000), w/h the size in pixels (up to 5000, negative points left/up for arrow and line);",
  "stroke is one of #1e1e1e #e03131 #2f9e44 #1971c2 #f08c00, fill one of transparent #ffc9c9 #ffec99 #d0bfff #b2f2bb #a5d8ff, text only for tool text (max 200 characters, otherwise empty).",
  "Only emit the block when the user asks you to draw something — never in a casual reply.",
].join(" ");

/** System prompt, optionally including a snapshot of the open drawing. */
export function buildSystemPrompt(scene?: string | null): string {
  const base = scene ? `${SYSTEM_BASE}\nCurrent drawing on the canvas: ${scene}.` : SYSTEM_BASE;
  return `${base}\n${CANVAS_RULE}`;
}

// [singular, plural] per Excalidraw element type — the sentence goes to the
// model, so "1 arrow" beats "1 arrows". Unknown types fall back to raw/+s.
const KIND: Record<string, [string, string]> = {
  rectangle: ["rectangle", "rectangles"],
  ellipse: ["ellipse", "ellipses"],
  diamond: ["diamond", "diamonds"],
  arrow: ["arrow", "arrows"],
  line: ["line", "lines"],
  freedraw: ["pen stroke", "pen strokes"],
  text: ["text label", "text labels"],
  image: ["image", "images"],
  frame: ["frame", "frames"],
  object: ["object", "objects"],
};

/**
 * "12 objects: 4 rectangles, 6 arrows, 2 text labels" — or null when the
 * canvas is empty. Tolerates unknown/absent types (upstream may add kinds).
 */
export function summarizeScene(els: readonly unknown[]): string | null {
  if (els.length === 0) return null;
  const counts = new Map<string, number>();
  for (const el of els) {
    const raw = (el as { type?: unknown } | null)?.type;
    const key = typeof raw === "string" && raw ? raw : "object";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kinds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => {
      const [one, many] = KIND[t] ?? [t, `${t}s`];
      return `${n} ${n === 1 ? one : many}`;
    });
  return `${els.length} object${els.length === 1 ? "" : "s"}: ${kinds.join(", ")}`;
}

/**
 * Trim a conversation that starts with a user turn down to the last
 * `maxTurns` exchanges, also dropping while it stays above `maxChars`.
 * Drops whole user/assistant pairs only, so the alternation the Gemma chat
 * template requires can never break (dropping a lone user message would
 * leave a reply at index 0 and the template rejects the conversation).
 */
export function trimHistory(
  msgs: readonly ChatMsg[],
  maxTurns = 4,
  maxChars = 4000,
): ChatMsg[] {
  let out = [...msgs];
  const charCount = (m: readonly ChatMsg[]) => m.reduce((n, x) => n + x.content.length, 0);
  while (
    out.length > maxTurns * 2 ||
    (charCount(out) > maxChars && out.length > 2)
  ) {
    // Never trim the trailing turn — the newest question must survive.
    if (out[0]?.role !== "user" || out[1]?.role !== "assistant") break;
    out = out.slice(2);
  }
  return out;
}

/**
 * What actually gets sent: the transcript trimmed down to whole exchanges
 * that end with a question (an in-progress assistant line or empty draft is
 * never a prompt — dropping it keeps the request ending on a user turn, the
 * one shape the Gemma chat template always accepts).
 */
export function messagesForRequest(msgs: readonly ChatMsg[]): ChatMsg[] {
  const complete = [...msgs];
  while (complete.length > 0) {
    const last = complete[complete.length - 1]!;
    if (last.role === "user" && last.content.trim()) break;
    complete.pop();
  }
  return trimHistory(complete);
}

/** Cut a streamed reply at the next template marker and tidy the edges. */
export function cleanReply(text: string): string {
  const cut = text.indexOf("<start_of_turn>");
  return (cut === -1 ? text : text.slice(0, cut)).replace(/\s+$/, "").trimStart();
}

// --- canvas commands --------------------------------------------------------
// The model may end a reply with exactly one machine-readable block asking
// the app to draw something. That block is hostile input by assumption: it
// comes from a tiny model that can be tricked, so everything below is
// allowlist-based, clamped, and pure — unit-tested against flood, junk and
// prototype-pollution payloads before it ever reaches the canvas.

export type CanvasTool = "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text";

export type CanvasCommand = {
  tool: CanvasTool;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string;
  /** Only ever non-empty for tool "text". */
  text: string;
};

const TOOLS = ["rectangle", "ellipse", "diamond", "arrow", "line", "text"] as const;
// Excalidraw's default swatch palettes — the model may pick, never invent.
const STROKES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"] as const;
const FILLS = ["transparent", "#ffc9c9", "#ffec99", "#d0bfff", "#b2f2bb", "#a5d8ff"] as const;
// Anything else in the JSON — including `__proto__`/`constructor`, which
// JSON.parse installs as ordinary own keys — fails closed.
const ALLOWED_KEYS = new Set(["tool", "x", "y", "w", "h", "stroke", "fill", "text"]);

const MAX_BLOCK = 500; // characters of JSON inside <canvas>…</canvas>
const MAX_TEXT = 200; // characters of label text
const MAX_COORD = 50000; // x/y clamp — nothing drawn absurdly far off-screen
const MAX_DIM = 5000; // |w|/|h| clamp

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Size clamp that keeps the sign (arrow/line direction) and never hits 0. */
const dim = (n: number): number => {
  const v = clamp(Math.abs(n), 1, MAX_DIM);
  return n < 0 ? -v : v;
};

/**
 * Strict validation of a parsed <canvas> payload. Null means "drop it and
 * show the reply normally": unknown tools or keys, wrong types, off-palette
 * colours, oversized or empty text and non-finite numbers all fail closed;
 * coordinates and sizes are clamped into sane bounds, never trusted.
 */
export function validateCanvasCommand(raw: unknown): CanvasCommand | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) if (!ALLOWED_KEYS.has(key)) return null;
  if (!isOneOf(TOOLS, o.tool)) return null;
  const x = finite(o.x);
  const y = finite(o.y);
  const w = finite(o.w);
  const h = finite(o.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (!isOneOf(STROKES, o.stroke)) return null;
  if (!isOneOf(FILLS, o.fill)) return null;
  const text = o.text === undefined ? "" : o.text;
  if (typeof text !== "string" || text.length > MAX_TEXT) return null;
  if (o.tool === "text" ? text.trim() === "" : text !== "") return null;
  return {
    tool: o.tool,
    x: clamp(x, -MAX_COORD, MAX_COORD),
    y: clamp(y, -MAX_COORD, MAX_COORD),
    w: dim(w),
    h: dim(h),
    stroke: o.stroke,
    fill: o.fill,
    text,
  };
}

const BLOCK_RE = /<canvas>([\s\S]*?)<\/canvas>/g;

/**
 * Pull the optional command block out of a reply. The returned `text` is
 * what the transcript shows — blocks removed, an unclosed tail cut (a reply
 * truncated mid-block must not leak raw JSON), space runs collapsed. The
 * `command` is non-null only when the reply held exactly one well-formed,
 * valid block; zero blocks, a flood of blocks and every validation failure
 * drop the command and let the reply show normally.
 */
export function splitCanvasCommand(reply: string): {
  text: string;
  command: CanvasCommand | null;
} {
  const bodies: string[] = [];
  const stripped = reply.replace(BLOCK_RE, (_match, body: string) => {
    bodies.push(body);
    return "";
  });
  const tail = stripped.indexOf("<canvas");
  const text = (tail === -1 ? stripped : stripped.slice(0, tail))
    .replace(/ {2,}/g, " ")
    .trim();
  if (bodies.length !== 1 || tail !== -1) return { text, command: null };
  const body = bodies[0]!;
  if (body.length > MAX_BLOCK) return { text, command: null };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { text, command: null };
  }
  return { text, command: validateCanvasCommand(raw) };
}

/** Confirm-dialog copy for a parsed command (Win9x asks before drawing). */
export function describeCommand(c: CanvasCommand): string {
  const at = `at ${Math.round(c.x)}, ${Math.round(c.y)}`;
  if (c.tool === "text") return `Clippy wants to add the text "${c.text}" ${at}.`;
  const article = /^[aeiou]/.test(c.tool) ? "an" : "a";
  const size =
    c.tool === "arrow" || c.tool === "line"
      ? ""
      : ` (${Math.round(Math.abs(c.w))}×${Math.round(Math.abs(c.h))})`;
  return `Clippy wants to draw ${article} ${c.tool} ${at}${size}.`;
}

/**
 * An Excalidraw `convertToExcalidrawElements` skeleton for a validated
 * command: closed shapes take the size as a bounding box, linear elements
 * as one segment (sign = direction), text as a label.
 */
export type CanvasSkeleton =
  | {
      type: "rectangle" | "ellipse" | "diamond";
      x: number;
      y: number;
      width: number;
      height: number;
      strokeColor: string;
      backgroundColor: string;
    }
  | {
      type: "arrow" | "line";
      x: number;
      y: number;
      width: number;
      height: number;
      strokeColor: string;
      backgroundColor: string;
      points: [number, number][];
    }
  | { type: "text"; x: number; y: number; text: string; strokeColor: string; fontSize: number };

export function commandToSkeleton(c: CanvasCommand): CanvasSkeleton {
  if (c.tool === "text") {
    return { type: "text", x: c.x, y: c.y, text: c.text, strokeColor: c.stroke, fontSize: 24 };
  }
  const box = {
    x: c.x,
    y: c.y,
    width: Math.abs(c.w),
    height: Math.abs(c.h),
    strokeColor: c.stroke,
  };
  if (c.tool === "arrow" || c.tool === "line") {
    return { type: c.tool, ...box, backgroundColor: "transparent", points: [[0, 0], [c.w, c.h]] };
  }
  return { type: c.tool, ...box, backgroundColor: c.fill };
}
