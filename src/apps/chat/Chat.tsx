// Ask Clippy: model manager (download / pause / resume / remove) + a streaming chat.
// Everything runs on this device; replies may carry one validated canvas command, and
// the Diagram button asks for Mermaid code. Either is only ever applied after an explicit Apply.
// "Look at my drawing" sends the canvas along as a picture, which MiniCPM-V can read.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { buildSystemPrompt, cleanReply, describeCommand, DIAGRAM_GENERATION, DIAGRAM_SYSTEM, extractMermaid, messagesForRequest, splitCanvasCommand, summarizeScene, type CanvasCommand, type ChatMsg } from "../../lib/localAi/chat.ts";
import { MODEL_STATE0, modelReducer, percent } from "../../lib/localAi/modelState.ts";
import { browserSupport, createEngine, deleteModelFromCache, isAbortError, isModelCached, MODEL_NAME, modelSizeLabel, type Engine, type EngineMessage } from "../../lib/localAi/runtime.ts";
import { errorBeep } from "../../lib/sound.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import { sceneJpeg } from "../paint/api.ts";
import { canvasCmd, canvasDiagram, paintApi } from "../paint/session.ts";
import { actions } from "../../shell/wmStore.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (n: number) => Math.round(n / 1e6);

export default function Chat() {
  const t = useT();
  const [model, dispatch] = useReducer(modelReducer, MODEL_STATE0);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [pendingCmd, setPendingCmd] = useState<CanvasCommand | null>(null);
  const [pendingDiagram, setPendingDiagram] = useState<string | null>(null);
  const [look, setLook] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const engine = useRef<Engine | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const warmUp = useCallback(async () => {
    // Abortable so a window closed mid-load does not leave the model sitting on the GPU.
    const ctrl = new AbortController();
    abort.current = ctrl;
    try { engine.current = await createEngine(undefined, ctrl.signal); dispatch({ type: "ready" }); }
    catch (e) { if (!isAbortError(e)) dispatch({ type: "failed", kind: "load", msg: errText(e) }); }
    finally { if (abort.current === ctrl) abort.current = null; }
  }, []);

  /** Start or resume: shards that already finished stay cached, so resume only fetches the rest. */
  const download = useCallback(async () => {
    dispatch({ type: "download" });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      // createEngine downloads and loads in one step, so the engine is ready as soon as this resolves.
      engine.current = await createEngine((progress) => dispatch({ type: "progress", progress }), ctrl.signal);
      dispatch({ type: "installed" });
      dispatch({ type: "ready" });
    } catch (e) {
      if (isAbortError(e)) dispatch({ type: "paused" });
      else dispatch({ type: "failed", kind: "install", msg: errText(e) });
    } finally { abort.current = null; }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const missing = await browserSupport();
        if (!alive) return;
        if (missing) { setUnsupported(missing); return; }
        const cached = await isModelCached();
        if (!alive) return;
        dispatch({ type: "probed", cached });
        if (cached) void warmUp();
      } catch (e) {
        if (alive) dispatch({ type: "failed", kind: "load", msg: errText(e) });
      }
    })();
    void navigator.storage?.estimate?.().then((est) => { if (alive && typeof est.usage === "number" && typeof est.quota === "number") setStorage({ usage: est.usage, quota: est.quota }); }, () => undefined);
    return () => {
      alive = false;
      abort.current?.abort(); // closing the window pauses a download and stops a reply
      void engine.current?.close?.();
      engine.current = null;
    };
  }, [warmUp]);

  useEffect(() => { const el = log.current; if (el && (msgs.length || streaming !== null)) el.scrollTop = el.scrollHeight; }, [msgs, streaming]);

  const removeModel = async () => {
    setConfirmRemove(false);
    dispatch({ type: "removing" });
    await engine.current?.close?.().catch(() => undefined);
    engine.current = null;
    try { await deleteModelFromCache(); dispatch({ type: "removed" }); }
    catch { dispatch({ type: "probed", cached: await isModelCached().catch(() => false) }); void warmUp(); }
  };

  const busy = streaming !== null;
  const stop = () => abort.current?.abort();
  const send = async (diagram = false) => {
    const value = input.trim();
    // abort.current doubles as a same-tick re-entrancy guard against a fast double Enter.
    if (!engine.current || !value || busy || abort.current) return;
    setInput(""); setSendErr("");
    const next: ChatMsg[] = [...msgs, { role: "user", content: value }];
    setMsgs(next);
    setStreaming("");
    const ctrl = new AbortController();
    abort.current = ctrl;
    let raw = "";
    const scene = paintApi.get();
    try {
      // A diagram is asked for on its own, behind the prompt the model was fine-tuned on.
      const request: EngineMessage[] = diagram
        ? [{ role: "system", content: DIAGRAM_SYSTEM }, { role: "user", content: value }]
        : [{ role: "system", content: buildSystemPrompt(scene ? summarizeScene(scene.getSceneElements()) : null) }, ...messagesForRequest(next)];
      // The drawing rides along with the newest question only: one picture per request keeps the prompt short.
      const picture = !diagram && look && scene ? await sceneJpeg(scene) : null;
      if (picture) request[request.length - 1] = { role: "user", content: [{ type: "image", data: picture }, { type: "text", text: value }] };
      await engine.current.chat(
        request,
        // The command block is stripped while streaming so raw JSON never flashes in the transcript.
        (delta) => { raw += delta; setStreaming(diagram ? cleanReply(raw) : splitCanvasCommand(cleanReply(raw)).text); },
        ctrl.signal,
        diagram ? DIAGRAM_GENERATION : undefined,
      );
      const done = splitCanvasCommand(cleanReply(raw));
      setMsgs([...next, { role: "assistant", content: (diagram ? cleanReply(raw) : done.text) || "…" }]);
      // Only a finished reply may draw; a stopped stream never does.
      if (diagram) {
        const code = extractMermaid(raw);
        if (code) setPendingDiagram(code);
        else setSendErr(t("chat.diagramBad"));
      } else if (done.command) setPendingCmd(done.command);
    } catch (e) {
      const partial = splitCanvasCommand(cleanReply(raw)).text;
      if (isAbortError(e)) { if (partial) setMsgs([...next, { role: "assistant", content: partial }]); else setSendErr(t("chat.stopped")); }
      else { errorBeep(); setSendErr(errText(e)); }
    } finally {
      setStreaming(null);
      abort.current = null;
      inputRef.current?.focus();
    }
  };

  if (unsupported) return <div className="chat"><div className="chat-setup"><p role="alert">{t("chat.unsupported", { feature: unsupported })}</p></div></div>;

  if (model.phase !== "ready") {
    const pct = percent(model.progress);
    const p = model.progress;
    return (
      <div className="chat">
        <div className="chat-setup">
          <span className="chat-glyph" aria-hidden="true">📎</span>
          {model.phase === "checking" && <p role="status">{t("chat.checking")}</p>}
          {model.phase === "absent" && (
            <>
              <p><b>{t("chat.offerTitle")}</b></p>
              <p>{t("chat.offer", { size: modelSizeLabel() })}</p>
              <button onClick={() => void download()}>{t("chat.download", { size: modelSizeLabel() })}</button>
            </>
          )}
          {(model.phase === "downloading" || model.phase === "paused") && (
            <>
              <p role="status">{model.phase === "paused" ? t("chat.paused", { pct }) : t("chat.downloading", { pct })}</p>
              <div className="chat-progress" role="progressbar" aria-label={t("chat.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div style={{ width: `${pct}%` }} />
              </div>
              {p && <p className="chat-note">{t("chat.bytes", { done: mb(p.loadedBytes), total: mb(p.totalBytes) })}</p>}
              {model.phase === "paused"
                ? <button onClick={() => void download()}>{t("chat.resume")}</button>
                : <button onClick={stop}>{t("chat.pause")}</button>}
            </>
          )}
          {model.phase === "loading" && (
            <>
              <p role="status">{t("chat.loading")}</p>
              <div className="chat-progress busy" role="progressbar" aria-label={t("chat.loading")} aria-busy="true"><div /></div>
            </>
          )}
          {model.phase === "error" && (
            <>
              <p className="chat-err" role="alert">{model.error?.msg}</p>
              <button onClick={() => (model.error?.kind === "install" ? void download() : (dispatch({ type: "probed", cached: true }), void warmUp()))}>{t("chat.retry")}</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat">
      <div ref={log} className="chat-log" role="log" aria-live="polite" aria-label={t("chat.log")} tabIndex={0}>
        {msgs.length === 0 && !busy && <p className="chat-note">{t("chat.hint")}</p>}
        {msgs.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}><span className="sr-only">{m.role === "user" ? t("chat.you") : "Clippy"}: </span>{m.content}</div>)}
        {/* aria-busy: screen readers wait for the finished reply instead of reading every token */}
        {busy && <div className="chat-msg assistant" aria-busy="true">{streaming || "…"}<span className="chat-caret" aria-hidden="true">▌</span></div>}
      </div>
      {sendErr && <p className="chat-err" role="alert">{sendErr}</p>}
      <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input ref={inputRef} type="text" value={input} maxLength={2000} placeholder={t("app.askClippy")} aria-label={t("chat.message")} onChange={(e) => setInput(e.target.value)} />
        {busy ? <button type="button" onClick={stop}>{t("chat.stop")}</button> : (
          <>
            <button type="submit" disabled={!input.trim()}>{t("chat.send")}</button>
            <button type="button" disabled={!input.trim()} onClick={() => void send(true)}>{t("chat.diagram")}</button>
          </>
        )}
      </form>
      <div className="chat-options">
        <input id="chat-look" type="checkbox" checked={look} disabled={busy} onChange={(e) => setLook(e.target.checked)} />
        <label htmlFor="chat-look">{t("chat.look")}</label>
      </div>
      <div className="chat-model">
        <span>{t("chat.modelStatus", { model: MODEL_NAME, size: modelSizeLabel() })}</span>
        {storage && <span>{t("chat.storage", { used: mb(storage.usage), quota: mb(storage.quota) })}</span>}
        <button disabled={busy} onClick={() => setConfirmRemove(true)}>{t("chat.remove")}</button>
      </div>
      {pendingCmd && (
        <Dialog
          title={t("chat.drawTitle")}
          onClose={() => setPendingCmd(null)}
          buttons={<><button data-autofocus onClick={() => { canvasCmd.set(pendingCmd); setPendingCmd(null); actions.open("paint"); }}>{t("chat.apply")}</button><button onClick={() => setPendingCmd(null)}>{t("ui.cancel")}</button></>}
        >
          <p>{t("chat.drawAsk")}</p>
          <p><b>{describeCommand(pendingCmd)}</b></p>
        </Dialog>
      )}
      {pendingDiagram && (
        <Dialog
          title={t("chat.diagramTitle")}
          onClose={() => setPendingDiagram(null)}
          buttons={<><button data-autofocus onClick={() => { canvasDiagram.set(pendingDiagram); setPendingDiagram(null); actions.open("paint"); }}>{t("chat.apply")}</button><button onClick={() => setPendingDiagram(null)}>{t("ui.cancel")}</button></>}
        >
          <p>{t("chat.diagramAsk")}</p>
        </Dialog>
      )}
      {confirmRemove && (
        <Dialog title={t("app.askClippy")} onClose={() => setConfirmRemove(false)} buttons={<><button onClick={() => void removeModel()}>{t("chat.remove")}</button><button data-autofocus onClick={() => setConfirmRemove(false)}>{t("ui.cancel")}</button></>}>
          <p>{t("chat.removeConfirm", { size: modelSizeLabel() })}</p>
        </Dialog>
      )}
    </div>
  );
}
