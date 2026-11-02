// Notepad: BrowserFS autosave with a legacy localStorage fallback, find/replace and .txt open/save.
import { useCallback, useEffect, useRef, useState } from "react";
import { NOTE_NAME_KEY, NOTE_TEXT_KEY, sharedNoteStore, type Note } from "../../lib/noteStore.ts";
import { t as translateNow, useT } from "../../i18n/index.ts";
import { click, errorBeep, saveChord } from "../../lib/sound.ts";
import { download, slugFilename } from "../../lib/storage.ts";
import { actions } from "../../shell/wmStore.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import { MenuBar } from "../../ui/Menu.tsx";
import type { AppProps } from "../registry.ts";

const K_TEXT = NOTE_TEXT_KEY;
const K_NAME = NOTE_NAME_KEY;
const K_WRAP = "paint97.notepad.wrap.v1";
const MAX_FILE = 5 * 1024 * 1024; // plain text; bigger would block the UI thread
const ls = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* quota/blocked: non-fatal */ } },
};
type Find = { needle: string; repl: string; replace: boolean };

export default function Notepad({ winId }: AppProps) {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [text, setText] = useState(() => ls.get(K_TEXT) ?? t("note.welcome"));
  const [name, setNameState] = useState(() => ls.get(K_NAME) ?? "notes.txt");
  const [wrap, setWrap] = useState(() => ls.get(K_WRAP) !== "0");
  const [find, setFind] = useState<Find | null>(null);
  const [note, setNote] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Note | null>(null);
  const nameRef = useRef(name);
  const persist = useCallback(async (n: Note) => {
    let fallback = false;
    try { localStorage.setItem(K_TEXT, n.text); localStorage.setItem(K_NAME, n.name); fallback = true; } catch { /* BrowserFS can still save beyond localStorage's quota. */ }
    try {
      const store = await sharedNoteStore();
      if (!store) throw new Error("storage unavailable");
      await store.save(n);
      // A newer edit may already be waiting; remove only this save's fallback.
      if (ls.get(K_TEXT) === n.text && ls.get(K_NAME) === n.name) {
        localStorage.removeItem(K_TEXT); localStorage.removeItem(K_NAME);
      }
    } catch { if (!fallback) { errorBeep(); setNote(translateNow("note.saveBad")); } }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const legacy = ls.get(K_TEXT);
        const store = await sharedNoteStore();
        const saved = legacy !== null ? { text: legacy, name: ls.get(K_NAME) ?? "notes.txt" } : await store?.load();
        if (!cancelled && saved) { setText(saved.text); setNameState(saved.name); nameRef.current = saved.name; }
        if (!cancelled && legacy !== null && saved) void persist(saved);
      } catch { if (!cancelled) setNote(translateNow("files.unavailable")); }
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, [persist]);

  useEffect(() => { actions.setTitle(winId, `${name} - ${t("app.notepad")}`); }, [winId, name, t]);
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(""), 4000); return () => clearTimeout(id); }, [note]);
  // Closing the window must not drop the last half-second of typing.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null) void persist(pending.current);
  }, [persist]);

  const setName = (n: string) => { setNameState(n); nameRef.current = n; };
  const onType = (v: string) => {
    setText(v);
    pending.current = { text: v, name: nameRef.current };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; if (pending.current) void persist(pending.current); pending.current = null; }, 500);
  };
  const replaceAllText = (v: string, n: string) => {
    // Cancel the pending autosave first, or it would land the old text over the new one.
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
    setText(v); setName(n); void persist({ text: v, name: n });
  };
  const openFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > MAX_FILE) throw new Error("too large");
      replaceAllText(await f.text(), f.name);
      click();
    } catch { errorBeep(); setNote(t("note.openBad")); }
  };

  // ---- find / replace: case-sensitive plain substring, wraps around ----
  const selectAt = (idx: number, len: number) => { const ta = area.current; if (ta && idx >= 0) { ta.focus(); ta.setSelectionRange(idx, idx + len); } };
  const findNext = () => {
    const needle = find?.needle ?? "";
    if (!needle) return;
    let idx = text.indexOf(needle, area.current?.selectionEnd ?? 0);
    if (idx < 0) idx = text.indexOf(needle);
    if (idx < 0) { setNote(t("note.notFound", { needle })); return; }
    selectAt(idx, needle.length);
  };
  const replaceOne = () => {
    const ta = area.current;
    if (!find?.needle || !ta) return;
    const { selectionStart: a, selectionEnd: b } = ta;
    if (ta.value.slice(a, b) !== find.needle) { findNext(); return; }
    const next = ta.value.slice(0, a) + find.repl + ta.value.slice(b);
    onType(next);
    const from = a + find.repl.length;
    // The DOM value swaps on re-render; chase the next match once it has.
    setTimeout(() => { const i = next.indexOf(find.needle, from); selectAt(i >= 0 ? i : next.indexOf(find.needle), find.needle.length); }, 0);
  };
  const replaceAll = () => {
    if (!find?.needle) return;
    if (!text.includes(find.needle)) { setNote(t("note.notFound", { needle: find.needle })); return; }
    onType(text.split(find.needle).join(find.repl));
  };
  const closeFind = () => { setFind(null); area.current?.focus(); };
  const findKeys = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === "Enter") { e.preventDefault(); enter(); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  };

  const menus = [
    { label: t("paint.file"), items: [
      { label: t("paint.new"), onSelect: () => (text.trim() ? setConfirmNew(true) : replaceAllText("", "untitled.txt")) },
      { label: t("paint.open"), onSelect: () => fileRef.current?.click() },
      { label: t("note.save"), shortcut: "Ctrl+S", onSelect: () => { saveChord(); download(slugFilename(name, ".txt"), text, "text/plain"); } },
    ] },
    { label: t("paint.edit"), items: [
      { label: t("note.find"), shortcut: "Ctrl+F", onSelect: () => setFind({ needle: "", repl: "", replace: false }) },
      { label: t("note.replace"), shortcut: "Ctrl+H", onSelect: () => setFind({ needle: "", repl: "", replace: true }) },
    ] },
    { label: t("note.format"), items: [
      { label: `${wrap ? "✓ " : ""}${t("note.wrap")}`, onSelect: () => { setWrap(!wrap); ls.set(K_WRAP, wrap ? "0" : "1"); } },
    ] },
  ];

  return (
    <div className="notepad">
      <MenuBar menus={ready ? menus : []} label={t("app.notepad")} />
      {find && (
        <div className="note-find" role="search">
          <label htmlFor={`${winId}-find`}>{t("note.findWhat")}</label>
          <input id={`${winId}-find`} type="text" autoFocus value={find.needle} onChange={(e) => setFind({ ...find, needle: e.target.value })} onKeyDown={(e) => findKeys(e, findNext)} />
          {find.replace && (
            <>
              <label htmlFor={`${winId}-repl`}>{t("note.replaceWith")}</label>
              <input id={`${winId}-repl`} type="text" value={find.repl} onChange={(e) => setFind({ ...find, repl: e.target.value })} onKeyDown={(e) => findKeys(e, replaceOne)} />
            </>
          )}
          <button onClick={findNext}>{t("note.findNext")}</button>
          {find.replace && <><button onClick={replaceOne}>{t("note.replaceOne")}</button><button onClick={replaceAll}>{t("note.replaceAll")}</button></>}
          <button onClick={closeFind}>{t("ui.close")}</button>
        </div>
      )}
      <textarea
        ref={area} disabled={!ready} aria-busy={!ready} className="note-area" value={text} spellCheck={false} wrap={wrap ? "soft" : "off"} aria-label={t("note.text")}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
          const k = e.key.toLowerCase();
          if (k === "f" || k === "h") { e.preventDefault(); setFind({ needle: "", repl: "", replace: k === "h" }); } // beat the browser's find bar
          else if (k === "s") { e.preventDefault(); saveChord(); download(slugFilename(name, ".txt"), text, "text/plain"); }
        }}
      />
      <div className="status-bar">
        <p className="status-bar-field" role="status" aria-live="polite">{note || t("note.chars", { n: text.length })}</p>
      </div>
      <input ref={fileRef} type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ""; }} />
      {confirmNew && (
        <Dialog title={t("app.notepad")} onClose={() => setConfirmNew(false)} buttons={<><button onClick={() => { replaceAllText("", "untitled.txt"); setConfirmNew(false); }}>{t("ui.ok")}</button><button data-autofocus onClick={() => setConfirmNew(false)}>{t("ui.cancel")}</button></>}>
          <p>{t("note.newConfirm")}</p>
        </Dialog>
      )}
    </div>
  );
}
