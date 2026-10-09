import { useEffect, useState } from "react";
import { appById } from "../apps/registry.ts";
import { useT } from "../i18n/index.ts";
import { settings, updateSettings } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { focusedId } from "../lib/wm.ts";
import { actions, wm } from "./wmStore.ts";

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function TrayClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 10_000); return () => clearInterval(id); }, []);
  return <time dateTime={now.toISOString()}>{hhmm(now)}</time>;
}

export function Taskbar({ startOpen, onStart }: { startOpen: boolean; onStart: () => void }) {
  const t = useT();
  const wins = useStore(wm, (s) => s.wins);
  const muted = useStore(settings, (s) => s.muted);
  const focused = focusedId({ wins, seq: 0 });
  // Buttons keep opening order (z-order shuffles on focus), so sort by id sequence.
  const ordered = [...wins].sort((a, b) => Number(a.id.split("#")[1]) - Number(b.id.split("#")[1]));
  return (
    <div className="taskbar" role="toolbar" aria-label={t("shell.taskbar")}>
      <button className={`start-btn ${startOpen ? "pressed" : ""}`} aria-haspopup="menu" aria-expanded={startOpen} onClick={onStart}>
        <span className="logo" aria-hidden="true" />
        <b>{t("shell.start")}</b>
      </button>
      <div className="task-items">
        {ordered.map((w) => {
          const def = appById(w.appId);
          if (!def) return null;
          return (
            <button key={w.id} className={`task-item ${focused === w.id ? "active" : ""}`} aria-pressed={focused === w.id} onClick={() => actions.taskbar(w.id)}>
              <span aria-hidden="true">{def.icon}</span> <span className="task-label">{w.title ?? t(def.title)}</span>
            </button>
          );
        })}
      </div>
      <div className="tray" role="group" aria-label={t("shell.tray")}>
        <button className="tray-btn" aria-pressed={muted} aria-label={muted ? t("shell.unmute") : t("shell.mute")} onClick={() => updateSettings({ muted: !muted })}>
          {muted ? "🔇" : "🔊"}
        </button>
        <TrayClock />
      </div>
    </div>
  );
}
