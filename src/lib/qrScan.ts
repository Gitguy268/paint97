// QR codes in and out, for the Send to a device dialog.
//
// Reading: BarcodeDetector where the browser has one (Chromium on macOS and
// Android), otherwise jsQR on canvas frames — Firefox, Safari and desktop
// Chromium elsewhere have none. Both libraries are dynamic imports, so neither
// is in the first paint. Frames are polled on a timer, because a background
// tab stops delivering animation frames.
import type { MsgKey } from "../i18n/en.ts";

const INTERVAL = 200;
const MAX_SIDE = 640; // jsQR's cost grows with pixels; a pairing code is large on screen

export type JsQR = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
type Detect = (video: HTMLVideoElement) => Promise<string | null> | string | null;
type NativeDetector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorClass = { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> };

async function detector(): Promise<Detect> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      if ((await Native.getSupportedFormats()).includes("qr_code")) {
        const native = new Native({ formats: ["qr_code"] });
        return async (video) => (await native.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      // A detector that throws is no detector: fall through to jsQR.
    }
  }
  // jsqr's typings declare an ES default export, but the file is CommonJS: the
  // function itself is what the default import holds, in Vite and in Node.
  const { default: jsQR } = (await import("jsqr")) as unknown as { default: JsQR };
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return (video) => {
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (!width || !height || !context) return null;
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    return jsQR(context.getImageData(0, 0, width, height).data, width, height)?.data ?? null;
  };
}

/** Thrown when there is no camera to use; the dialog falls back to paste. */
export class CameraError extends Error {
  readonly key: MsgKey = "nearby.noCamera";
}

/** Show the camera in `video` and call `onText` with every code it reads. Resolves to a stop function. */
export async function startScan(video: HTMLVideoElement, onText: (text: string) => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    throw new CameraError();
  }
  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    const detect = await detector();
    const tick = async () => {
      if (stopped) return;
      try {
        const text = await detect(video);
        if (text && !stopped) onText(text);
      } catch {
        // One unreadable frame says nothing about the next.
      }
      if (!stopped) timer = window.setTimeout(tick, INTERVAL);
    };
    void tick();
  } catch {
    stop();
    throw new CameraError();
  }
  return stop;
}

/** The module matrix for `text`, at low error correction: a code going screen to camera is never smudged. */
export async function qrMatrix(text: string): Promise<{ count: number; isDark: (row: number, column: number) => boolean }> {
  const { default: qrcode } = await import("qrcode-generator");
  const code = qrcode(0, "L");
  code.addData(text, "Byte");
  code.make();
  return { count: code.getModuleCount(), isDark: (row, column) => code.isDark(row, column) };
}

/** One SVG path of merged dark runs, offset by a 4-module quiet zone. */
export function qrPath({ count, isDark }: { count: number; isDark: (row: number, column: number) => boolean }): string {
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (!isDark(row, column)) continue;
      let end = column;
      while (end + 1 < count && isDark(row, end + 1)) end++;
      d += `M${column + 4} ${row + 4}h${end - column + 1}v1h-${end - column + 1}z`;
      column = end;
    }
  }
  return d;
}
