import { AppIcon } from "../ui/AppIcon.tsx";
import { useRef, useState } from "react";
import { APPS } from "../apps/registry.ts";
import { useT } from "../i18n/index.ts";
import { actions } from "./wmStore.ts";

export function DesktopIcons() {
  const t = useT();
  const icons = APPS.filter((a) => a.desktop);
  const [sel, setSel] = useState(icons[0]?.id ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const i = icons.findIndex((a) => a.id === sel);
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move) {
      e.preventDefault();
      const next = icons[(i + move + icons.length) % icons.length];
      if (next) { setSel(next.id); queueMicrotask(() => ref.current?.querySelector<HTMLElement>(`[data-app="${next.id}"]`)?.focus()); }
    } else if (e.key === "Enter" && sel) actions.open(sel);
  };
  return (
    <div ref={ref} className="desktop-icons" role="group" aria-label={t("shell.desktop")} onKeyDown={onKey}>
      {icons.map((a) => (
        <button
          key={a.id}
          data-app={a.id}
          tabIndex={sel === a.id ? 0 : -1}
          className={`desk-icon ${sel === a.id ? "selected" : ""}`}
          onClick={() => setSel(a.id)}
          onDoubleClick={() => actions.open(a.id)}
        >
          <span className="glyph" aria-hidden="true"><AppIcon src={a.icon} size={32} /></span>
          <span className="label">{t(a.title)}</span>
        </button>
      ))}
    </div>
  );
}
