// Modal dialog: focus moves in, Tab is trapped, Esc closes, focus returns on unmount.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "../i18n/index.ts";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, children, buttons }: { title: string; onClose: () => void; children: ReactNode; buttons?: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0], last = items.at(-1);
    if (!first || !last) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="modal-scrim">
      <div ref={ref} className="window dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="title-bar">
          <div className="title-bar-text" id={titleId}>{title}</div>
          <div className="title-bar-controls"><button aria-label={t("win.close")} onClick={onClose} /></div>
        </div>
        <div className="window-body">
          {children}
          {buttons && <div className="dialog-buttons">{buttons}</div>}
        </div>
      </div>
    </div>
  );
}
