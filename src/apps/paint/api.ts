// Typed helpers over Excalidraw's imperative API. Everything importing the heavy
// package does so lazily (dynamic import) so the entry bundle never contains it.
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Scene } from "../../lib/storage.ts";
import { slugFilename, download } from "../../lib/storage.ts";
import { computeFrameLayout, paintFrame } from "../../lib/frameExport.ts";
import { commandToSkeleton, type CanvasCommand } from "../../lib/localAi/chat.ts";

export type PaintApi = ExcalidrawImperativeAPI;
export type { AppState, ExcalidrawElement, BinaryFiles };

const lib = () => import("@excalidraw/excalidraw");

/** Put a (pre-validated) scene on the canvas. restore() rebuilds appState from known keys only. */
export async function applyScene(api: PaintApi, scene: Scene): Promise<void> {
  const { restore } = await lib();
  const safe = restore({ elements: scene.elements as ExcalidrawElement[], appState: scene.appState as Partial<AppState>, files: {} }, null, null, { repairBindings: true });
  api.updateScene({ elements: safe.elements, appState: safe.appState });
  api.scrollToContent(safe.elements, { fitToContent: true });
}

async function rasterize(api: PaintApi): Promise<HTMLCanvasElement> {
  const { exportToCanvas } = await lib();
  return exportToCanvas({ elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles() });
}
const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => {
    c.toBlob((b) => (b ? res(b) : rej(new Error("rasterize failed"))), "image/png");
  });

function saveBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

export async function exportPng(api: PaintApi, name: string) {
  saveBlob(await toBlob(await rasterize(api)), slugFilename(name, ".png"));
}
export async function exportSvg(api: PaintApi, name: string) {
  const { exportToSvg } = await lib();
  const svg = await exportToSvg({ elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles() });
  download(slugFilename(name, ".svg"), new XMLSerializer().serializeToString(svg), "image/svg+xml");
}
/** Raster composited into a painted Win9x window (Canvas2D only, no DOM rasterisation). */
export async function exportFramed(api: PaintApi, name: string, status: string, menu: string[]) {
  const drawing = await rasterize(api);
  const layout = computeFrameLayout(drawing.width, drawing.height);
  const out = document.createElement("canvas");
  out.width = layout.width; out.height = layout.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  paintFrame(ctx, layout, { title: `Paint97 — ${name}`, status, menu });
  ctx.drawImage(drawing, layout.inner.x, layout.inner.y);
  saveBlob(await toBlob(out), slugFilename(name, ".png"));
}
export async function copyPng(api: PaintApi) {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(await rasterize(api)) })]);
}

/** Add a skeleton element (text/shape) at the viewport centre or its own coordinates. */
export async function appendSkeleton(api: PaintApi, skeleton: ExcalidrawElementSkeleton) {
  const { convertToExcalidrawElements } = await lib();
  const [el] = convertToExcalidrawElements([skeleton]);
  if (el) api.updateScene({ elements: [...api.getSceneElements(), el] });
}

export async function insertSticker(api: PaintApi, glyph: string) {
  const s = api.getAppState();
  const z = s.zoom.value;
  await appendSkeleton(api, { type: "text", text: glyph, x: s.width / 2 / z - s.scrollX, y: s.height / 2 / z - s.scrollY, fontSize: 64 });
}

export const applyCanvasCommand = (api: PaintApi, cmd: CanvasCommand) => appendSkeleton(api, commandToSkeleton(cmd));

/**
 * Clippy's Mermaid code as Excalidraw elements, added to the drawing and scrolled into view.
 * Flowcharts, sequence and class diagrams become shapes; other kinds arrive as one image.
 * Rejects on code the parser refuses.
 */
export async function appendMermaid(api: PaintApi, code: string) {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([import("@excalidraw/mermaid-to-excalidraw"), lib()]);
  const { elements, files } = await parseMermaidToExcalidraw(code);
  const els = convertToExcalidrawElements(elements as ExcalidrawElementSkeleton[], { regenerateIds: true });
  if (files) api.addFiles(Object.values(files));
  api.updateScene({ elements: [...api.getSceneElements(), ...els] });
  api.scrollToContent(els, { fitToContent: true });
}

/** The drawing as a JPEG for Clippy to look at, at most 896 px a side; null for an empty canvas. */
export async function sceneJpeg(api: PaintApi): Promise<ArrayBuffer | null> {
  const elements = api.getSceneElements();
  if (!elements.length) return null;
  const { exportToBlob } = await lib();
  const blob = await exportToBlob({ elements, appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles(), mimeType: "image/jpeg", maxWidthOrHeight: 896 });
  return blob.arrayBuffer();
}

/** Menu Undo/Redo: Excalidraw exposes no history API, so replay its own keyboard shortcut. */
export function sendHistoryKey(redo: boolean) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: redo ? "y" : "z", code: redo ? "KeyY" : "KeyZ", ctrlKey: !mac, metaKey: mac, bubbles: true }));
}
