import { memo, Suspense, useEffect, useRef } from "react";
import { appById } from "../apps/registry.ts";
import { useT } from "../i18n/index.ts";
import { snapZone, type WinState } from "../lib/wm.ts";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { actions, workArea } from "./wmStore.ts";

const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

export const Window = memo(function Window({ win, z, active }: { win: WinState; z: number; active: boolean }) {
  const t = useT();
  const def = appById(win.appId);
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const el = useRef<HTMLElement>(null);
  // Focus follows the active window (opened, restored, Alt+Tab) unless focus is already inside it.
  useEffect(() => {
    if (active && win.mode !== "min" && el.current && !el.current.contains(document.activeElement)) el.current.focus({ preventScroll: true });
  }, [active, win.mode]);
  if (!def) return null;
  const title = win.title ?? t(def.title);
  const max = win.mode === "max";
  const App = def.component;

  const track = (move: (e: PointerEvent) => void, end?: (e: PointerEvent) => void) => {
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      end?.(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTitleDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
    actions.focus(win.id);
    if (max) return;
    drag.current = { sx: e.clientX, sy: e.clientY, x: win.rect.x, y: win.rect.y };
    track(
      (ev) => { const d = drag.current; if (d) actions.move(win.id, d.x + ev.clientX - d.sx, d.y + ev.clientY - d.sy); },
      (ev) => { drag.current = null; const z2 = snapZone(ev.clientX, ev.clientY, workArea()); if (z2) actions.snap(win.id, z2); },
    );
  };

  const onResizeDown = (dir: string) => (e: React.PointerEvent) => {
    if (max || e.button !== 0) return;
    e.preventDefault();
    actions.focus(win.id);
    const { sx, sy, r } = { sx: e.clientX, sy: e.clientY, r: win.rect };
    track((ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h } = r;
      if (dir.includes("e")) w = r.w + dx;
      if (dir.includes("s")) h = r.h + dy;
      if (dir.includes("w")) { w = r.w - dx; x = r.x + dx; }
      if (dir.includes("n")) { h = r.h - dy; y = r.y + dy; }
      actions.resize(win.id, { x, y, w, h });
    });
  };

  return (
    <section
      ref={el}
      tabIndex={-1}
      className={`window win ${active ? "" : "inactive"} ${max ? "maximized" : ""}`}
      style={{ left: win.rect.x, top: win.rect.y, width: win.rect.w, height: win.rect.h, zIndex: z, display: win.mode === "min" ? "none" : undefined }}
      aria-labelledby={`${win.id}-t`}
      onPointerDownCapture={() => !active && actions.focus(win.id)}
    >
      <div className={`title-bar ${active ? "" : "inactive"}`} onPointerDown={onTitleDown} onDoubleClick={() => actions.toggleMax(win.id)}>
        <span className="title-icon" aria-hidden="true">{def.icon}</span>
        <div className="title-bar-text" id={`${win.id}-t`}>{title}</div>
        <div className="title-bar-controls">
          <button aria-label={t("win.minimize")} onClick={() => actions.minimize(win.id)} />
          <button aria-label={max ? t("win.restore") : t("win.maximize")} onClick={() => actions.toggleMax(win.id)} />
          <button aria-label={t("win.close")} onClick={() => actions.close(win.id)} />
        </div>
      </div>
      <div className="window-body win-content">
        <ErrorBoundary label={title}>
          <Suspense fallback={<div className="pane pad">…</div>}>
            <App winId={win.id} props={win.props} />
          </Suspense>
        </ErrorBoundary>
      </div>
      {!max && DIRS.map((d) => <div key={d} className={`rz rz-${d}`} onPointerDown={onResizeDown(d)} />)}
    </section>
  );
});
