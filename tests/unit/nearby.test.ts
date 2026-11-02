// Unit tests for src/lib/nearby.ts and the QR half of src/lib/qrScan.ts — the
// pairing codes and the payload arrive from another device, so the codec, the
// accept-first handshake and the byte cap are security-relevant.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSignal, encodeSignal, NearbyError, receivePayload, sendPayload, type Channel } from "../../src/lib/nearby.ts";
import { qrMatrix, type JsQR } from "../../src/lib/qrScan.ts";
import { encodeText, toBase64Url } from "../../src/lib/share.ts";

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\na=fingerprint:sha-256 AB:CD\r\n";
const raw = async (text: string) => toBase64Url(await encodeText(text));

/** Two ends of an in-memory data channel, delivering asynchronously like the real one. */
function channelPair(): [Channel, Channel] {
  const make = () => Object.assign(new EventTarget(), { readyState: "open", bufferedAmount: 0, bufferedAmountLowThreshold: 0, binaryType: "blob" }) as Channel;
  const a = make();
  const b = make();
  const wire = (from: Channel, to: Channel) => {
    from.send = (data) => {
      const copy = typeof data === "string" ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      setTimeout(() => to.dispatchEvent(new MessageEvent("message", { data: copy })));
    };
    from.close = () => {
      for (const side of [a, b]) { side.readyState = "closed"; setTimeout(() => side.dispatchEvent(new Event("close"))); }
    };
  };
  wire(a, b);
  wire(b, a);
  return [a, b];
}

test("a pairing code round trips, bare or inside a link", async () => {
  const offer = await encodeSignal({ type: "offer", sdp: SDP });
  assert.match(offer, /^1o[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeSignal(offer), { type: "offer", sdp: SDP });
  assert.deepEqual(await decodeSignal(`https://example.test/#rtc=${offer}\n`), { type: "offer", sdp: SDP });
  assert.equal((await decodeSignal("rtc=" + (await encodeSignal({ type: "answer", sdp: SDP })))).type, "answer");
});

test("anything else is refused as a pairing code", async () => {
  for (const input of ["", "hello", "2o" + (await raw(SDP)), "1x" + (await raw(SDP)), "1o!!!", "1o" + "A".repeat(9000)]) {
    await assert.rejects(decodeSignal(input), NearbyError, JSON.stringify(input.slice(0, 20)));
  }
  await assert.rejects(decodeSignal("1o" + (await raw("not sdp"))), NearbyError);
});

test("a scene crosses in chunks, after the receiver accepts", async () => {
  const [sender, receiver] = channelPair();
  const text = JSON.stringify({ elements: [{ id: "é🎉", text: "x".repeat(50_000) }] });
  let seen: unknown = null;
  const [sent, got] = await Promise.all([
    sendPayload(sender, { title: "Big", text }),
    receivePayload(receiver, { confirm: (offer) => { seen = offer; return Promise.resolve(true); } }),
  ]);
  assert.equal(sent, true);
  assert.deepEqual(seen, { title: "Big", bytes: new TextEncoder().encode(text).length });
  assert.deepEqual(got, { title: "Big", text });
});

test("a decline sends nothing", async () => {
  const [sender, receiver] = channelPair();
  let chunks = 0;
  receiver.addEventListener("message", (event) => { if (typeof (event as MessageEvent).data !== "string") chunks++; });
  const [sent, got] = await Promise.all([
    sendPayload(sender, { title: "No", text: "secret" }),
    receivePayload(receiver, { confirm: () => Promise.resolve(false) }),
  ]);
  assert.equal(sent, false);
  assert.equal(got, null);
  assert.equal(chunks, 0);
});

test("the receiver refuses a header over its cap, and a sender that lies", async () => {
  let [sender, receiver] = channelPair();
  let asked = false;
  const big = receivePayload(receiver, { confirm: () => Promise.resolve((asked = true)), maxBytes: 10 });
  sender.send(JSON.stringify({ v: 1, title: "t", bytes: 11 }));
  await assert.rejects(big, (e: NearbyError) => e.key === "nearby.tooBig");
  assert.equal(asked, false);

  [sender, receiver] = channelPair();
  const lying = receivePayload(receiver, { confirm: () => Promise.resolve(true) });
  sender.send(JSON.stringify({ v: 1, title: "t", bytes: 2 }));
  sender.addEventListener("message", (event) => { if ((event as MessageEvent).data === "accept") sender.send(new Uint8Array(3)); });
  await assert.rejects(lying, (e: NearbyError) => e.key === "nearby.garbled");
});

test("a real-sized pairing code still reads at webcam resolution", async () => {
  // Chromium's answer for a data channel with two mDNS host candidates.
  const sdp = [
    "v=0", "o=- 4611731400430051336 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0", "a=extmap-allow-mixed",
    "a=msid-semantic: WMS", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0",
    "a=candidate:1830156466 1 udp 2113937151 75e730f7-3579-4fd4-b18b-d9ab118fc068.local 63212 typ host generation 0 network-cost 999",
    "a=candidate:1713879950 1 udp 2113939711 1d720845-1d59-470c-b36e-f0a344449be1.local 62937 typ host generation 0 network-cost 999",
    "a=ice-ufrag:fhZe", "a=ice-pwd:FABtsQpDsdqyioZYESTouTrK", "a=ice-options:trickle",
    "a=fingerprint:sha-256 4E:1F:0B:8C:69:9A:3D:22:5E:B7:41:6D:0C:F2:AA:13:97:58:E0:3B:C4:7D:21:66:9F:0E:B3:58:2A:71:CD:04",
    "a=setup:active", "a=mid:0", "a=sctp-port:5000", "a=max-message-size:262144", "",
  ].join("\r\n");
  const code = await encodeSignal({ type: "answer", sdp });
  const { count, isDark } = await qrMatrix(code);
  // A 640x480 frame from arm's length: 3 px a module, 4-module quiet zone.
  const width = 640, height = 480, scale = 3;
  const offset = Math.floor((height - (count + 8) * scale) / 2);
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (!isDark(row, column)) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const at = ((offset + (row + 4) * scale + y) * width + offset + (column + 4) * scale + x) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
      }
    }
  }
  const { default: jsQR } = (await import("jsqr")) as unknown as { default: JsQR };
  assert.equal(jsQR(pixels, width, height)?.data, code);
});
