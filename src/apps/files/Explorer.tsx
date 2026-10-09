// One Explorer-style folder window with two faces: My Drawings (folders, open,
// rename, move, bin) and the Recycle Bin (restore, delete, empty).
// APG listbox: the list keeps focus, aria-activedescendant follows the selection.
import { useEffect, useId, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { children, isLive, pathOf, trashed, type FsNode } from "../../lib/fs.ts";
import { fsOps, fsState } from "../../lib/fsStore.ts";
import { click, errorBeep } from "../../lib/sound.ts";
import { useStore } from "../../lib/store.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import { openInPaint } from "../paint/session.ts";
import { VersionList } from "./VersionList.tsx";

const fmtSize = (chars: number) => (chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`);
/** Drag payload type: carried on the event itself, so a row can be dropped into another folder window. */
const DRAG_TYPE = "application/x-paint97-node";
type Ask = { text: string; run: () => void };
type Prompt = { title: string; value: string; run: (v: string) => void };

export function Explorer({ bin }: { bin: boolean }) {
  const t = useT();
  const uid = useId();
  const { fs, undo, loaded } = useStore(fsState, (s) => s);
  const [cwdRaw, setCwd] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [cut, setCut] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [propsId, setPropsId] = useState<string | null>(null);

  // A folder that was binned or deleted elsewhere drops this window back to the root.
  const cwd = cwdRaw && isLive(fs, cwdRaw) ? cwdRaw : null;
  const entries = bin ? trashed(fs) : children(fs, cwd);
  const selIndex = entries.findIndex((n) => n.id === sel);
  const cur = selIndex >= 0 ? entries[selIndex] : undefined;
  const propsNode = propsId ? fs.nodes[propsId] : undefined;
  const rootLabel = bin ? t("app.bin") : t("app.drawings");

  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(""), 5000); return () => clearTimeout(id); }, [note]);

  /** Run a storage action; failures beep and say so instead of failing silently. */
  const run = (p: Promise<unknown>, ok?: string) => void p.then(() => { if (ok) setNote(ok); }, () => { errorBeep(); setNote(t("files.unavailable")); });

  const openFile = async (n: FsNode) => {
    try {
      const scene = await fsOps.read(n.id);
      if (!scene) { errorBeep(); setNote(t("files.damaged", { name: n.name })); return; }
      openInPaint({ scene, name: n.name, fileId: n.id });
    } catch { errorBeep(); setNote(t("files.unavailable")); }
  };
  const primary = (n: FsNode) => {
    if (bin) run(fsOps.restore(n.id), t("files.restored", { name: n.name }));
    else if (n.kind === "folder") { setCwd(n.id); setSel(null); }
    else void openFile(n);
  };
  const dispose = (n: FsNode) => {
    if (bin) setAsk({ text: t("files.deleteConfirm", { name: n.name }), run: () => run(fsOps.purge(n.id)) });
    else run(fsOps.trash(n.id), t("files.trashed", { name: n.name }));
  };
  const renameSel = (n: FsNode) => setPrompt({ title: t("files.rename"), value: n.name, run: (v) => run(fsOps.rename(n.id, v)) });
  const newFolder = () => setPrompt({ title: t("files.newFolder"), value: t("files.newFolderName"), run: (v) => run(fsOps.newFolder(v, cwd)) });
  const moveTo = (id: string, parent: string | null) => run(fsOps.move(id, parent), t("files.moved"));
  const up = () => { if (cwd) { setSel(cwd); setCwd(fs.nodes[cwd]?.parent ?? null); } };
  const undoLast = () => run(fsOps.undo(), t("files.undone"));

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); undoLast(); return; }
    if (!bin && mod && e.key.toLowerCase() === "x" && cur) { e.preventDefault(); setCut(cur.id); setNote(t("files.cut", { name: cur.name })); return; }
    if (!bin && mod && e.key.toLowerCase() === "v" && cut) { e.preventDefault(); moveTo(cut, cwd); setCut(null); return; }
    if (!bin && e.key === "Backspace") { e.preventDefault(); up(); return; }
    if (cur && e.key === "Enter") { e.preventDefault(); primary(cur); return; }
    if (cur && e.key === "Delete") { e.preventDefault(); dispose(cur); return; }
    if (cur && !bin && e.key === "F2") { e.preventDefault(); renameSel(cur); return; }
    const next = e.key === "ArrowDown" ? Math.min(entries.length - 1, selIndex + 1) : e.key === "ArrowUp" ? Math.max(0, selIndex - 1) : e.key === "Home" ? 0 : e.key === "End" ? entries.length - 1 : -1;
    const n = entries[next];
    if (n) { e.preventDefault(); setSel(n.id); }
  };

  const dropOn = (parent: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; } },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      e.preventDefault(); e.stopPropagation(); // a folder row wins over the list behind it
      if (id !== parent) moveTo(id, parent);
    },
  });

  return (
    <div className="exp">
      <div className="exp-toolbar" role="toolbar" aria-label={rootLabel}>
        {bin ? (
          <>
            <button disabled={!cur} onClick={() => cur && primary(cur)}>{t("files.restore")}</button>
            <button disabled={!cur} onClick={() => cur && dispose(cur)}>{t("files.delete")}</button>
            <button disabled={entries.length === 0} onClick={() => setAsk({ text: t("files.emptyConfirm"), run: () => run(fsOps.emptyBin()) })}>{t("files.empty")}</button>
          </>
        ) : (
          <>
            <button disabled={!cwd} onClick={up} {...dropOn(cwd ? (fs.nodes[cwd]?.parent ?? null) : null)}>{t("files.up")}</button>
            <button disabled={!cur} onClick={() => cur && primary(cur)}>{t("files.open")}</button>
            <button onClick={newFolder}>{t("files.newFolder")}</button>
            <button disabled={!cur} onClick={() => cur && renameSel(cur)}>{t("files.rename")}</button>
            <button disabled={!cur} onClick={() => cur && dispose(cur)}>{t("files.delete")}</button>
          </>
        )}
        <button disabled={!cur} onClick={() => cur && setPropsId(cur.id)}>{t("files.properties")}</button>
        <button disabled={undo.length === 0} onClick={undoLast}>{t("files.undo")}</button>
      </div>
      {!bin && <div className="exp-address" aria-label={t("files.address")}>{[rootLabel, ...pathOf(fs, cwd)].join(" \\ ")}</div>}

      <div
        className="exp-list" role="listbox" tabIndex={0} aria-label={rootLabel}
        aria-activedescendant={cur ? `${uid}-${cur.id}` : undefined}
        onKeyDown={onKey}
        onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}
        {...(bin ? {} : dropOn(cwd))}
      >
        {/* Messages are disabled options: a listbox must own at least one option. */}
        {loaded && entries.length === 0 && <div role="option" aria-selected="false" aria-disabled="true" className="exp-msg">{bin ? t("files.binEmpty") : t("files.folderEmpty")}</div>}
        {entries.map((n) => (
          <div
            key={n.id} id={`${uid}-${n.id}`} role="option" aria-selected={n.id === sel}
            className={`exp-row ${n.id === sel ? "selected" : ""} ${n.id === cut ? "cut" : ""}`}
            draggable={!bin}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(DRAG_TYPE, n.id); e.dataTransfer.setData("text/plain", n.name); }}
            {...(!bin && n.kind === "folder" ? dropOn(n.id) : {})}
            onClick={() => { setSel(n.id); click(); }}
            onDoubleClick={() => primary(n)}
          >
            <span aria-hidden="true">{n.kind === "folder" ? "📁" : "📄"}</span>
            <span className="exp-name">{n.name}</span>
            <span>{new Date(bin ? (n.trashedAt ?? n.modifiedAt) : n.modifiedAt).toLocaleDateString()}</span>
            <span className="exp-size">{n.kind === "file" ? fmtSize(n.chars) : ""}</span>
          </div>
        ))}
      </div>

      <div className="status-bar">
        <p className="status-bar-field" role="status" aria-live="polite">{note || t("files.count", { n: entries.length })}</p>
        <p className="status-bar-field">{cur ? cur.name : rootLabel}</p>
      </div>

      {ask && (
        <Dialog title={rootLabel} onClose={() => setAsk(null)} buttons={<><button onClick={() => { ask.run(); setAsk(null); }}>{t("files.delete")}</button><button data-autofocus onClick={() => setAsk(null)}>{t("ui.cancel")}</button></>}>
          <p>{ask.text}</p>
        </Dialog>
      )}
      {prompt && (
        <Dialog title={prompt.title} onClose={() => setPrompt(null)} buttons={<><button onClick={() => { prompt.run(prompt.value); setPrompt(null); }}>{t("ui.ok")}</button><button onClick={() => setPrompt(null)}>{t("ui.cancel")}</button></>}>
          <div className="field-row-stacked">
            <label htmlFor={`${uid}-name`}>{t("files.name")}</label>
            <input
              id={`${uid}-name`} data-autofocus type="text" maxLength={64} value={prompt.value}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); prompt.run(prompt.value); setPrompt(null); } }}
            />
          </div>
        </Dialog>
      )}
      {propsNode && (
        <Dialog title={t("files.propertiesOf", { name: propsNode.name })} onClose={() => setPropsId(null)} buttons={<button data-autofocus onClick={() => setPropsId(null)}>{t("ui.close")}</button>}>
          <dl className="props">
            <dt>{t("files.name")}</dt><dd>{propsNode.name}</dd>
            <dt>{t("files.type")}</dt><dd>{propsNode.kind === "folder" ? t("files.typeFolder") : t("files.typeFile")}</dd>
            <dt>{t("files.location")}</dt><dd>{[t("app.drawings"), ...pathOf(fs, propsNode.parent)].join(" \\ ")}</dd>
            {propsNode.kind === "file" && <><dt>{t("files.size")}</dt><dd>{fmtSize(propsNode.chars)}</dd></>}
            <dt>{t("files.created")}</dt><dd>{new Date(propsNode.createdAt).toLocaleString()}</dd>
            <dt>{t("files.modified")}</dt><dd>{new Date(propsNode.modifiedAt).toLocaleString()}</dd>
          </dl>
          {propsNode.kind === "file" && !bin && (
            <fieldset>
              <legend>{t("files.versions")}</legend>
              <VersionList node={propsNode} onDone={() => setPropsId(null)} onError={() => { errorBeep(); setNote(t("files.damaged", { name: propsNode.name })); }} />
            </fieldset>
          )}
        </Dialog>
      )}
    </div>
  );
}
