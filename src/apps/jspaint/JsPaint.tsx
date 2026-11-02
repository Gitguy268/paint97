// JS Paint (https://github.com/1j01/jspaint) in a window: the self-hosted copy that
// scripts/copy-jspaint.mjs puts in public/jspaint, framed. Same origin, so its window is reachable.
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { useStore } from "../../lib/store.ts";
import { focusedId } from "../../lib/wm.ts";
import { actions, wm } from "../../shell/wmStore.ts";
import type { AppProps } from "../registry.ts";

// JS Paint autosaves each picture under a session id it keeps in its URL hash, and starts a new
// session when opened without one: reopening the window would show an empty canvas.
const SESSION_KEY = "paint97.jspaint.session";
const SESSION = /^#local:[\w-]+$/;
const lastSession = () => {
  try { const hash = localStorage.getItem(SESSION_KEY) ?? ""; return SESSION.test(hash) ? hash : ""; } catch { return ""; }
};

export default function JsPaint({ winId }: AppProps) {
  const t = useT();
  const active = useStore(wm, (s) => focusedId(s) === winId);
  const ref = useRef<HTMLIFrameElement>(null);
  // The keyboard goes into JS Paint whenever its window comes to the front; otherwise the window element itself takes it.
  useEffect(() => { if (active) ref.current?.focus({ preventScroll: true }); }, [active]);
  const [src] = useState(() => `${import.meta.env.BASE_URL}jspaint/index.html${lastSession()}`);
  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const el = e.currentTarget;
    const frame = el.contentWindow;
    if (!frame) return;
    // File > Exit leaves for another site unless the framing page replaces close(); a bound function does not count.
    frame.close = () => actions.close(winId);
    // Events inside a frame stop at the frame, so the two kinds the desktop relies on are repeated outside it.
    // A pointerdown, on the frame element: it activates this window and closes an open Start menu, like a click anywhere else.
    frame.addEventListener("pointerdown", () => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      // shortcut: the session is read on the next click, because JS Paint changes it without an event;
      // File > New then closing without drawing reopens the previous picture.
      try { if (SESSION.test(frame.location.hash)) localStorage.setItem(SESSION_KEY, frame.location.hash); } catch { /* blocked storage */ }
    }, true);
    // Keys, on the window, where only the shell listens (Alt+Tab, Alt+`, the Win key): on the document they would also drive Paint97.
    const relayKey = (key: KeyboardEvent) => { if (!window.dispatchEvent(new KeyboardEvent(key.type, key))) key.preventDefault(); };
    frame.addEventListener("keydown", relayKey, true);
    frame.addEventListener("keyup", relayKey, true);
  };
  // No sandbox: JS Paint needs scripts and its own-origin storage, and a frame with both could lift a sandbox anyway.
  // What it runs is the pinned copy this build ships, and its CSP (FRAMED in vite.config.ts) keeps it on this origin.
  // oxlint-disable-next-line react/iframe-missing-sandbox
  return <iframe ref={ref} className="jspaint" title={t("app.jspaint")} src={src} onLoad={onLoad} />;
}
