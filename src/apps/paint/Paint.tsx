import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { emitClippy } from "../../clippy/bus.ts";
import { useT } from "../../i18n/index.ts";
import { focusedId } from "../../lib/wm.ts";
import { actions, wm } from "../../shell/wmStore.ts";
import { decodeScene, encodeScene, SHARE_PREFIX } from "../../lib/share.ts";
import { sceneToFile, readSceneFile, slugFilename } from "../../lib/storage.ts";
import { STICKERS } from "../../lib/stickers.ts";
import { click, errorBeep, pop, saveChord } from "../../lib/sound.ts";
import { clearScene, type Scene } from "../../lib/storage.ts";
import { isLive, sanitizeName } from "../../lib/fs.ts";
import { fsOps, fsState } from "../../lib/fsStore.ts";
import { useStore } from "../../lib/store.ts";
import { VersionList } from "../files/VersionList.tsx";
import { boundFile, openReq } from "./session.ts";
import type { AppProps } from "../registry.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import { MenuBar } from "../../ui/Menu.tsx";
import { applyScene, copyPng, exportFramed, exportPng, exportSvg, insertSticker, sendHistoryKey, type AppState, type ExcalidrawElement, type PaintApi } from "./api.ts";
import { Palette } from "./Palette.tsx";
import { ToolStrip, type ToolId } from "./ToolStrip.tsx";

const Stage = lazy(() => import("./Stage.tsx"));

type View = { els: number; zoom: number; tool: string; stroke: string; fill: string };
const VIEW0: View = { els: 0, zoom: 100, tool: "selection", stroke: "#000000", fill: "transparent" };

export default function Paint({ winId }: AppProps) {
  const t = useT();
  const [api, setApi] = useState<PaintApi | null>(null);
  const [view, setView] = useState<View>(VIEW0);
  const [looseName, setName] = useState("untitled");
  // The drawing on the canvas may be bound to a My Drawings file: saves and autosaves then write to it.
  const fileId = useStore(boundFile, (x) => x);
  const node = useStore(fsState, (s) => (fileId && isLive(s.fs, fileId) ? s.fs.nodes[fileId] : undefined));
  const name = node?.name ?? looseName;
  const req = useStore(openReq, (x) => x);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [versions, setVersions] = useState(false);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | { text: string; run: () => void }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevEls = useRef(0);

  const notify = useCallback((msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? "" : n)), 5000);
  }, []);

  useEffect(() => { actions.setTitle(winId, `${name} - Paint97`); }, [winId, name]);

  const onChange = useCallback((elements: readonly ExcalidrawElement[], s: AppState) => {
    const els = elements.filter((e) => !e.isDeleted).length;
    const next: View = { els, zoom: Math.round(s.zoom.value * 100), tool: s.activeTool.type, stroke: s.currentItemStrokeColor, fill: s.currentItemBackgroundColor };
    setView((v) => (v.els === next.els && v.zoom === next.zoom && v.tool === next.tool && v.stroke === next.stroke && v.fill === next.fill ? v : next));
    if (prevEls.current > 0 && els === 0) emitClippy({ kind: "empty" });
    prevEls.current = els;
  }, []);

  const lastTool = useRef("selection");
  useEffect(() => {
    if (view.tool !== lastTool.current) { lastTool.current = view.tool; emitClippy({ kind: "tool", tool: view.tool }); }
  }, [view.tool]);

  // #scene= share links: decode, apply, then clear the hash so reloads use the local autosave.
  const importShared = useCallback(async (a: PaintApi) => {
    if (!location.hash.startsWith(SHARE_PREFIX)) return;
    const scene = await decodeScene(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    if (!scene) { notify(t("paint.sharedBad")); return; }
    try { await applyScene(a, scene); notify(t("paint.sharedOpened")); } catch { notify(t("paint.sharedBad")); }
  }, [notify, t]);
  const onApi = useCallback((a: PaintApi) => { setApi(a); void importShared(a); }, [importShared]);
  useEffect(() => {
    if (!api) return;
    const h = () => void importShared(api);
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, [api, importShared]);

  useEffect(() => {
    if (!api || !req) return;
    openReq.set(null);
    void applyScene(api, req.scene).then(() => { boundFile.set(req.fileId); setName(req.name); notify(t("paint.opened", { name: req.name })); }, () => notify(t("paint.openBad")));
  }, [api, req, notify, t]);

  const currentScene = (a: PaintApi): Scene => ({ elements: a.getSceneElements() as unknown as object[], appState: a.getAppState() });
  const saved = (as: string) => { saveChord(); notify(t("paint.saved", { name: as })); emitClippy({ kind: "save" }); };
  const storageFailed = () => { errorBeep(); notify(t("paint.storageFail")); emitClippy({ kind: "error", message: "storage" }); };
  /** Ctrl+S: overwrite the bound file (keeping a version), or ask for a name first. */
  const save = () => {
    if (!api) return;
    if (node) void fsOps.write(node.id, currentScene(api), true).then(() => saved(node.name), storageFailed);
    else setSaveAs(name);
  };
  const saveNew = (raw: string) => {
    if (!api) return;
    setSaveAs(null);
    void fsOps.create(raw, null, currentScene(api)).then((id) => { boundFile.set(id); saved(sanitizeName(raw)); }, storageFailed);
  };
  const onPersist = useCallback((scene: Scene) => {
    const id = boundFile.get();
    if (id && isLive(fsState.get().fs, id)) void fsOps.write(id, scene).catch(() => undefined);
  }, []);

  const guarded = (fn: (a: PaintApi) => Promise<void>, ok?: () => void) => async () => {
    if (!api) return;
    try { await fn(api); ok?.(); } catch { errorBeep(); notify(t("paint.exportFail")); emitClippy({ kind: "error", message: "export" }); }
  };

  const onPicked = async (f: File | undefined) => {
    if (!f || !api) return;
    try { await applyScene(api, await readSceneFile(f)); boundFile.set(null); setName(f.name.replace(/\.excalidraw$/i, "")); notify(t("paint.opened", { name: f.name })); }
    catch { errorBeep(); notify(t("paint.openBad")); }
  };

  const copyLink = async () => {
    if (!api) return;
    const hash = await encodeScene(api.getSceneElements(), api.getAppState());
    if (!hash) { notify(t("paint.linkTooBig")); return; }
    const url = location.origin + location.pathname + hash;
    try { await navigator.clipboard.writeText(url); notify(t("paint.linkCopied")); } catch { notify(`${t("paint.clipFail")} ${url}`); }
  };

  const setStyle = (patch: Partial<AppState>) => api?.updateScene({ appState: patch as AppState });
  const zoomTo = (v: number) => api?.updateScene({ appState: { zoom: { value: Math.min(30, Math.max(0.1, v)) as AppState["zoom"]["value"] } } as AppState });

  // Ctrl+S on the window, not the element: after drawing, focus sits on <body>, and
  // Excalidraw would otherwise open its own save dialog.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s" || focusedId(wm.get()) !== winId) return;
      e.preventDefault(); e.stopPropagation();
      saveRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [winId]);

  const menus = [
    { label: t("paint.file"), items: [
      { label: t("paint.new"), onSelect: () => setConfirm({ text: t("paint.newConfirm"), run: () => { api?.resetScene(); boundFile.set(null); setName("untitled"); } }) },
      { label: t("paint.open"), onSelect: () => fileRef.current?.click() },
      { label: t("paint.save"), shortcut: "Ctrl+S", onSelect: save },
      { label: t("paint.saveAs"), onSelect: () => setSaveAs(name) },
      { label: t("files.versions"), disabled: !node, onSelect: () => setVersions(true) },
      { label: t("paint.saveFile"), onSelect: () => { if (api) { sceneToFile(api.getSceneElements(), api.getAppState(), name); emitClippy({ kind: "export" }); } } },
      "sep" as const,
      { label: t("paint.exportPng"), onSelect: guarded((a) => exportPng(a, name), () => emitClippy({ kind: "export" })) },
      { label: t("paint.exportSvg"), onSelect: guarded((a) => exportSvg(a, name), () => emitClippy({ kind: "export" })) },
      { label: t("paint.exportFramed"), onSelect: guarded((a) => exportFramed(a, name, t("paint.objects", { n: view.els }), [t("paint.file"), t("paint.edit"), t("paint.stickers"), t("paint.view")]), () => emitClippy({ kind: "export" })) },
      { label: t("paint.copyImage"), onSelect: guarded((a) => copyPng(a), () => notify(t("paint.copied"))) },
      { label: t("paint.copyLink"), onSelect: () => void copyLink() },
    ] },
    { label: t("paint.edit"), items: [
      { label: t("paint.undo"), shortcut: "Ctrl+Z", onSelect: () => sendHistoryKey(false) },
      { label: t("paint.redo"), shortcut: "Ctrl+Y", onSelect: () => sendHistoryKey(true) },
      "sep" as const,
      { label: t("paint.clearSaved"), onSelect: () => setConfirm({ text: t("paint.clearConfirm"), run: () => void clearScene().then(() => api?.resetScene()) }) },
    ] },
    { label: t("paint.view"), items: [
      { label: t("paint.zoomIn"), onSelect: () => zoomTo(view.zoom / 100 * 1.25) },
      { label: t("paint.zoomOut"), onSelect: () => zoomTo(view.zoom / 100 / 1.25) },
      { label: t("paint.zoomReset"), onSelect: () => zoomTo(1) },
    ] },
    { label: t("paint.stickers"), items: STICKERS.map((s) => ({ label: `${s.glyph}  ${s.name}`, onSelect: () => { if (api) void insertSticker(api, s.glyph).then(click); } })) },
  ];

  return (
    <div className="paint">
      <MenuBar menus={menus} label={t("paint.menu")} />
      <div className="paint-main">
        <ToolStrip active={view.tool} onPick={(id: ToolId) => { api?.setActiveTool({ type: id }); pop(); }} />
        <div className="paint-canvas">
          <Suspense fallback={<div className="pane pad">{t("paint.loading")}</div>}>
            <Stage onApi={onApi} onChange={onChange} onPersist={onPersist} onStorageError={() => { notify(t("paint.storageFail")); emitClippy({ kind: "error", message: "storage" }); }} />
          </Suspense>
        </div>
      </div>
      <Palette stroke={view.stroke} fill={view.fill} onStroke={(c) => setStyle({ currentItemStrokeColor: c })} onFill={(c) => setStyle({ currentItemBackgroundColor: c })} />
      <div className="status-bar">
        <p className="status-bar-field" role="status" aria-live="polite">{note || slugFilename(name, ".excalidraw")}</p>
        <p className="status-bar-field">{t("paint.objects", { n: view.els })}</p>
        <p className="status-bar-field">{t("paint.zoom", { pct: view.zoom })}</p>
      </div>
      <input ref={fileRef} type="file" accept=".excalidraw,.json,application/json" hidden onChange={(e) => { void onPicked(e.target.files?.[0]); e.target.value = ""; }} />
      {saveAs !== null && (
        <Dialog
          title={t("paint.saveAs")}
          onClose={() => setSaveAs(null)}
          buttons={<><button onClick={() => saveNew(saveAs)}>{t("ui.ok")}</button><button onClick={() => setSaveAs(null)}>{t("ui.cancel")}</button></>}
        >
          <div className="field-row-stacked">
            <label htmlFor="paint-save-name">{t("files.name")}</label>
            <input id="paint-save-name" data-autofocus type="text" maxLength={64} value={saveAs} onChange={(e) => setSaveAs(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveNew(saveAs); } }} onBlur={(e) => setSaveAs(sanitizeName(e.target.value))} />
          </div>
        </Dialog>
      )}
      {versions && node && (
        <Dialog title={`${t("files.versions")} — ${node.name}`} onClose={() => setVersions(false)} buttons={<button data-autofocus onClick={() => setVersions(false)}>{t("ui.close")}</button>}>
          <VersionList node={node} onDone={() => setVersions(false)} onError={() => notify(t("files.damaged", { name: node.name }))} />
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={t("app.paint")}
          onClose={() => setConfirm(null)}
          buttons={<><button data-autofocus onClick={() => { confirm.run(); setConfirm(null); }}>{t("ui.ok")}</button><button onClick={() => setConfirm(null)}>{t("ui.cancel")}</button></>}
        >
          <p>{confirm.text}</p>
        </Dialog>
      )}
    </div>
  );
}
