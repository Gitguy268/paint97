import { AppIcon } from "../ui/AppIcon.tsx";
import { useEffect, useRef } from "react";
import { APPS } from "../apps/registry.ts";
import { useT } from "../i18n/index.ts";
import { MenuList, type MenuEntry } from "../ui/Menu.tsx";
import { actions } from "./wmStore.ts";

export function StartMenu({ onClose, extra }: { onClose: () => void; extra?: MenuEntry[] }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!ref.current?.contains(el) && !el.closest(".start-btn")) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  const items: MenuEntry[] = [
    ...APPS.filter((a) => a.start).map((a): MenuEntry => ({ label: t(a.title), icon: <AppIcon src={a.icon} />, onSelect: () => actions.open(a.id) })),
    ...(extra?.length ? (["sep", ...extra] as MenuEntry[]) : []),
    "sep",
    { label: t("shell.shutdown"), icon: "⏻", onSelect: () => location.reload() },
  ];
  return (
    <div className="win98"><div ref={ref} className="start-menu menu">
      <div className="start-banner menu-sidebar" aria-hidden="true"><span>Paint<b>97</b></span></div>
      <MenuList items={items} label={t("shell.programs")} onClose={onClose} />
    </div></div>
  );
}
