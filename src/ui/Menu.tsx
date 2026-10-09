// Menus with a roving tabindex: arrows move, Enter/Space activate, Esc closes.
import { useEffect, useRef, useState, type ReactNode } from "react";

export type MenuEntry = "sep" | { label: string; onSelect: () => void; disabled?: boolean; shortcut?: string; icon?: ReactNode };

/** Vertical menu. Focuses its first item on mount. */
export function MenuList({ items, label, onClose, autoFocus = true }: { items: MenuEntry[]; label: string; onClose: () => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  const live = items.flatMap((it, i) => (it !== "sep" && !it.disabled ? [i] : []));
  const [active, setActive] = useState(live[0] ?? 0);
  useEffect(() => {
    if (autoFocus) ref.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [autoFocus]);
  const step = (dir: 1 | -1) => {
    const at = live.indexOf(active);
    const next = live[(at + dir + live.length) % live.length] ?? active;
    setActive(next);
    queueMicrotask(() => ref.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus());
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(live[0] ?? 0); queueMicrotask(() => ref.current?.querySelector<HTMLElement>(`[data-i="${live[0]}"]`)?.focus()); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  return (
    <ul ref={ref} role="menu" aria-label={label} className="menu-list" onKeyDown={onKey}>
      {items.map((it, i) =>
        it === "sep" ? (
          <li key={i} role="separator" className="menu-sep" />
        ) : (
          <li key={i} role="none">
            <button
              role="menuitem"
              data-i={i}
              tabIndex={i === active ? 0 : -1}
              disabled={it.disabled}
              onMouseEnter={() => !it.disabled && setActive(i)}
              onClick={() => { it.onSelect(); onClose(); }}
            >
              {it.icon && <span className="menu-icon" aria-hidden="true">{it.icon}</span>}
              <span>{it.label}</span>
              {it.shortcut && <kbd>{it.shortcut}</kbd>}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export type MenuDef = { label: string; items: MenuEntry[] };

/** Horizontal menu bar; ArrowLeft/Right move between menus, ArrowDown opens. */
export function MenuBar({ menus, label }: { menus: MenuDef[]; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const focusTop = (i: number) => { setActive(i); queueMicrotask(() => ref.current?.querySelector<HTMLElement>(`[data-top="${i}"]`)?.focus()); };
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [isOpen, ref]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = menus.length;
    if (e.key === "ArrowRight") { e.preventDefault(); const j = (i + 1) % n; focusTop(j); if (open !== null) setOpen(j); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); const j = (i - 1 + n) % n; focusTop(j); if (open !== null) setOpen(j); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(i); }
  };
  return (
    <div ref={ref} className="menubar" role="menubar" aria-label={label}>
      {menus.map((m, i) => (
        <div key={m.label} className="menubar-item">
          <button
            role="menuitem"
            data-top={i}
            tabIndex={i === active ? 0 : -1}
            aria-haspopup="menu"
            aria-expanded={open === i}
            className={open === i ? "open" : ""}
            onClick={() => { setActive(i); setOpen(open === i ? null : i); }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="menu-drop">
              <MenuList items={m.items} label={m.label} onClose={() => { setOpen(null); focusTop(i); }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
