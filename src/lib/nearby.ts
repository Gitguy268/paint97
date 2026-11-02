// Send to a device: a WebRTC data channel between two open copies of Paint97,
// paired by scanning QR codes. The ideas are LocalSend's (send straight to a
// device nearby; the receiver says yes before anything arrives) and qrcp's
// (pair by scanning a code) — no code from either.
//
// No ICE servers, so the only candidates are the devices' own addresses: both
// must share a network, and nothing passes through a server. Guest or
// client-isolated Wi-Fi never connects, and the dialog says so on the timeout.
//
// A pairing code is "1" (version), "o"/"a" (offer/answer), then the SDP through
// share.ts's deflate + base64url. In a link it sits behind "#rtc=".
import type { MsgKey } from "../i18n/en.ts";
import { decodeText, encodeText, fromBase64Url, MAX_SHARE_INPUT, toBase64Url } from "./share.ts";

export const RTC_PREFIX = "#rtc=";
export const MAX_BYTES = MAX_SHARE_INPUT; // the same ceiling as a share link's scene
const VERSION = "1";
const MAX_CODE = 8 * 1024; // caps what a hostile code can inflate into
const MAX_SDP = 16 * 1024;
const CHUNK = 16 * 1024; // the message size every browser's data channel accepts
const HIGH_WATER = 1024 * 1024;
const GATHER_TIMEOUT = 4000;
export const CONNECT_TIMEOUT = 20_000;

/** Errors carry a message key; the dialog translates them. */
export class NearbyError extends Error {
  readonly key: MsgKey;
  constructor(key: MsgKey) {
    super(key);
    this.name = "NearbyError";
    this.key = key;
  }
}

type Description = { type: "offer" | "answer"; sdp: string };

/* ------------------------------------------------------------ pairing codes */

export async function encodeSignal({ type, sdp }: Description): Promise<string> {
  return VERSION + (type === "offer" ? "o" : "a") + toBase64Url(await encodeText(sdp));
}

/** A pairing code, or a whole link holding one. */
export async function decodeSignal(input: string): Promise<Description> {
  let code = String(input).trim();
  const at = code.indexOf(RTC_PREFIX);
  if (at !== -1) code = code.slice(at + RTC_PREFIX.length);
  else if (code.startsWith(RTC_PREFIX.slice(1))) code = code.slice(RTC_PREFIX.length - 1);

  if (code.length < 3 || code.length > MAX_CODE || code[0] !== VERSION || !"oa".includes(code[1]!)) {
    throw new NearbyError("nearby.notCode");
  }
  let sdp: string;
  try {
    sdp = await decodeText(fromBase64Url(code.slice(2)));
  } catch {
    throw new NearbyError("nearby.damaged");
  }
  if (!sdp.startsWith("v=0") || sdp.length > MAX_SDP) throw new NearbyError("nearby.damaged");
  return { type: code[1] === "o" ? "offer" : "answer", sdp };
}

/* -------------------------------------------------------------- connection */

// Non-trickle: every candidate goes into the one code. Some browsers never
// report "complete" without a STUN server, so the wait is capped.
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, GATHER_TIMEOUT);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
    });
  });
}

function peer(): RTCPeerConnection {
  if (typeof RTCPeerConnection !== "function") throw new NearbyError("nearby.unsupported");
  return new RTCPeerConnection({ iceServers: [] });
}

const described = (pc: RTCPeerConnection) => encodeSignal(pc.localDescription as Description);

export async function createOffer() {
  const pc = peer();
  const channel = pc.createDataChannel("scene");
  await pc.setLocalDescription();
  await gathered(pc);
  return {
    pc,
    channel,
    code: await described(pc),
    async accept(answer: string) {
      const description = await decodeSignal(answer);
      if (description.type !== "answer") throw new NearbyError("nearby.ownCode");
      await pc.setRemoteDescription(description);
    },
  };
}

export async function answerOffer(offer: string) {
  const description = await decodeSignal(offer);
  if (description.type !== "offer") throw new NearbyError("nearby.replyCode");
  const pc = peer();
  // The channel only arrives once the sender applies this answer; if it never
  // does, or the network keeps the two apart, ICE gives up and says so.
  const channel = new Promise<RTCDataChannel>((resolve, reject) => {
    pc.addEventListener("datachannel", (event) => resolve(event.channel), { once: true });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") reject(new NearbyError("nearby.unreachable"));
    });
  });
  await pc.setRemoteDescription(description);
  await pc.setLocalDescription();
  await gathered(pc);
  return { pc, channel, code: await described(pc) };
}

/* ---------------------------------------------------------------- transfer */

/** The part of RTCDataChannel the transfer uses, so tests can stand in for it. */
export type Channel = EventTarget & {
  readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: string;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(): void;
};

export function opened(channel: Channel, timeout = CONNECT_TIMEOUT): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NearbyError("nearby.unreachable")), timeout);
    channel.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    channel.addEventListener("close", () => { clearTimeout(timer); reject(new NearbyError("nearby.closed")); }, { once: true });
  });
}

function nextMessage(channel: Channel): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: Event) => { channel.removeEventListener("close", onClose); resolve((event as MessageEvent).data); };
    const onClose = () => { channel.removeEventListener("message", onMessage); reject(new NearbyError("nearby.closed")); };
    channel.addEventListener("message", onMessage, { once: true });
    channel.addEventListener("close", onClose, { once: true });
  });
}

function drained(channel: Channel): Promise<void> {
  if (channel.bufferedAmount <= HIGH_WATER) return Promise.resolve();
  channel.bufferedAmountLowThreshold = HIGH_WATER / 2;
  return new Promise((resolve) => {
    channel.addEventListener("bufferedamountlow", () => resolve(), { once: true });
  });
}

export type Payload = { title: string; text: string };

/** Offer a payload, wait for the receiver's yes, then send it. False when declined. */
export async function sendPayload(channel: Channel, { title, text }: Payload): Promise<boolean> {
  const bytes = new TextEncoder().encode(text);
  channel.send(JSON.stringify({ v: 1, title: String(title).slice(0, 200), bytes: bytes.length }));
  if ((await nextMessage(channel)) !== "accept") return false;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await drained(channel);
    channel.send(bytes.slice(i, i + CHUNK));
  }
  // Closing before the receiver has it all can drop what is still buffered,
  // so the sender hangs up only once the receiver says "done".
  if ((await nextMessage(channel)) !== "done") throw new NearbyError("nearby.closed");
  channel.close();
  return true;
}

/** Receive one payload. Nothing past the header is read without `confirm`'s yes. */
export async function receivePayload(
  channel: Channel,
  { confirm, maxBytes = MAX_BYTES }: { confirm: (offer: { title: string; bytes: number }) => Promise<boolean>; maxBytes?: number },
): Promise<Payload | null> {
  channel.binaryType = "arraybuffer";
  let header: unknown;
  try {
    header = JSON.parse(String(await nextMessage(channel)));
  } catch (error) {
    if (error instanceof NearbyError) throw error;
    throw new NearbyError("nearby.garbled");
  }
  const { v, title, bytes } = (header ?? {}) as { v?: unknown; title?: unknown; bytes?: unknown };
  if (v !== 1 || typeof title !== "string" || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new NearbyError("nearby.garbled");
  }
  if (bytes > maxBytes) throw new NearbyError("nearby.tooBig");

  const offer = { title: title.slice(0, 200), bytes };
  if (!(await confirm(offer))) { channel.send("decline"); return null; }

  const body = new Uint8Array(bytes);
  let received = 0;
  const done = bytes === 0 ? null : new Promise<void>((resolve, reject) => {
    const stop = () => { channel.removeEventListener("message", onMessage); channel.removeEventListener("close", onClose); };
    const onClose = () => { stop(); reject(new NearbyError("nearby.closed")); };
    const onMessage = (event: Event) => {
      const data = (event as MessageEvent).data;
      const chunk = data instanceof ArrayBuffer ? new Uint8Array(data) : null;
      if (!chunk || received + chunk.length > bytes) { stop(); reject(new NearbyError("nearby.garbled")); return; }
      body.set(chunk, received);
      received += chunk.length;
      if (received === bytes) { stop(); resolve(); }
    };
    channel.addEventListener("message", onMessage);
    channel.addEventListener("close", onClose);
  });
  channel.send("accept");
  await done;
  channel.send("done");
  // pc.close() does not flush, so wait for the sender to hang up after "done",
  // or it would report a failure for a payload that arrived.
  await new Promise<void>((resolve) => {
    if (channel.readyState === "closed") { resolve(); return; }
    const timer = setTimeout(resolve, 3000);
    channel.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  return { title: offer.title, text: new TextDecoder().decode(body) };
}
