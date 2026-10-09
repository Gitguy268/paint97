import { useEffect, useState } from "react";
import { appById } from "../apps/registry.ts";
import { useT } from "../i18n/index.ts";
import { loadFs } from "../lib/fsStore.ts";
import { settings } from "../lib/settings.ts";
import { startupChime } from "../lib/sound.ts";
import { useStore } from "../lib/store.ts";
import { focusedId, mruOrder } from "../lib/wm.ts";
import type { MenuEntry } from "../ui/Menu.tsx";
import { DesktopIcons } from "./Desktop.tsx";
import { StartMenu } from "./StartMenu.tsx";
import { Taskbar } from "./Taskbar.tsx";
import { Window } from "./Window.tsx";
import { actions, wm } from "./wmStore.ts";
import { wallpaperById } from "../lib/wallpapers.ts";

/** Alt+Tab overlay. Alt+` is the fallback because browsers/OSes often swallow Alt+Tab. */
function Switcher({ ids, index }: { ids: string[]; index: number }) {
  const t = useT();
  const wins = useStore(wm, (s) => s.wins);
  return (
    <div className="switcher window" role="listbox" aria-label={t("shell.switcher")} aria-activedescendant={`sw-${ids[index]}`}>
      <div className="window-body">
        {ids.map((id, i) => {
          const w = wins.find((x) => x.id === id);
          const def = w && appById(w.appId);
          if (!w || !def) return null;
          return (
            <div key={id} id={`sw-${id}`} role="option" aria-selected={i === index} className={`sw-item ${i === index ? "sel" : ""}`}>
              <span className="glyph" aria-hidden="true">{def.icon}</span>
              <span>{w.title ?? t(def.title)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Shell({ extraStart, children }: { extraStart?: MenuEntry[]; children?: React.ReactNode }) {
  const t = useT();
  const wins = useStore(wm, (s) => s.wins);
  const wallpaper = useStore(settings, (s) => s.wallpaper);
  const [startOpen, setStartOpen] = useState(false);
  const [sw, setSw] = useState<{ ids: string[]; index: number } | null>(null);
  const active = focusedId({ wins, seq: 0 });

  useEffect(() => { void loadFs(); }, []);
  useEffect(() => {
    let metaAlone = false;
    let switcher: { ids: string[]; index: number } | null = null;
    const show = (s: typeof switcher) => { switcher = s; setSw(s); };
    const down = (e: KeyboardEvent) => {
      startupChime();
      if (e.key === "Meta") { metaAlone = true; return; }
      metaAlone = false;
      if (e.altKey && (e.key === "Tab" || e.key === "`")) {
        e.preventDefault();
        const ids = switcher?.ids ?? mruOrder(wm.get()).filter((id) => wm.get().wins.some((w) => w.id === id));
        if (ids.length < 2) return;
        const dir = e.shiftKey ? -1 : 1;
        show({ ids, index: (((switcher?.index ?? 0) + dir) % ids.length + ids.length) % ids.length });
      } else if (switcher && e.key === "Escape") { e.preventDefault(); show(null); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Meta" && metaAlone) { metaAlone = false; setStartOpen((o) => !o); }
      if (e.key === "Alt" && switcher) { const id = switcher.ids[switcher.index]; show(null); if (id) actions.focus(id); }
    };
    // Cmd/Win+Tab away never delivers the keyup: forget the half-finished chord.
    const blur = () => { metaAlone = false; if (switcher) show(null); };
    const resize = () => actions.fit();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("resize", resize);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("blur", blur); window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <div className="desktop" style={{ background: wallpaperById(wallpaper).css || undefined }}>
      <main aria-label={t("shell.desktop")} className="desktop-area">
        <DesktopIcons />
        {wins.map((w, i) => <Window key={w.id} win={w} z={10 + i} active={w.id === active} />)}
        {children}
      </main>
      {startOpen && <StartMenu extra={extraStart} onClose={() => setStartOpen(false)} />}
      <Taskbar startOpen={startOpen} onStart={() => setStartOpen((o) => !o)} />
      {sw && <Switcher ids={sw.ids} index={sw.index} />}
    </div>
  );
}
