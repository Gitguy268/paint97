// React wrapper around ClippyEngine: lifecycle, settings, and turning app events into tips.
// The engine owns its DOM outside React (document.body), so this renders nothing.
import { useEffect, useRef } from "react";
import { t, translate } from "../i18n/index.ts";
import { prefersReducedMotion, settings } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { TASKBAR_H } from "../shell/wmStore.ts";
import { browserIo, loadClippyAssets } from "./assets.ts";
import { onClippy, type ClippyEvent } from "./bus.ts";
import { browserClock, createDomRenderer, type DomRenderer } from "./dom.ts";
import { ClippyEngine } from "./engine.ts";
import { LONG_IDLE_MS, TIP_STATE0, dayKey, nextTip, tipFor, tipOfTheDay, tipPackById, type Tip } from "./tips.ts";

const K_POS = "paint97.clippy.pos.v1";
const K_DAY = "paint97.clippy.day.v1";
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked storage */ } },
};
const savedPos = (): { x?: number; y?: number } => {
  try { const p = JSON.parse(ls.get(K_POS) ?? "null") as { x?: unknown; y?: unknown } | null; return typeof p?.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : {}; } catch { return {}; }
};

export default function Clippy() {
  const scale = useStore(settings, (s) => s.clippyScale);
  const motion = useStore(settings, (s) => s.motion);
  const locale = useStore(settings, (s) => s.locale);
  const live = useRef<{ engine: ClippyEngine; renderer: DomRenderer } | null>(null);

  useEffect(() => {
    let dead = false;
    let cleanup = () => undefined as void;
    // Total asset failure (offline and the CDN blocked) stays silent: the app simply has no Clippy.
    void loadClippyAssets(browserIo, import.meta.env.BASE_URL).then((assets) => {
      if (dead) return;
      const s = settings.get();
      const renderer = createDomRenderer(assets, { volume: () => { const c = settings.get(); return c.muted ? 0 : c.volume; }, bottomInset: TASKBAR_H });
      const engine = new ClippyEngine(assets.data, renderer, browserClock, { scale: s.clippyScale, reducedMotion: prefersReducedMotion(s), ...savedPos() });
      renderer.setLabel(t("clippy.label"));
      live.current = { engine, renderer };

      let state = TIP_STATE0;
      let lastActive = Date.now();
      let idleTold = false;
      const pack = () => tipPackById(settings.get().personality);
      const say = (tip: Tip) => { engine.stop(); engine.play(tip.anim); engine.speak(tip.text); };
      const onEvent = (e: ClippyEvent) => {
        const r = tipFor(pack(), e, state, Date.now(), Math.random());
        if (r) { state = r.state; say(r.tip); }
      };
      renderer.attach(engine, {
        click: () => { const r = nextTip(pack(), state, Date.now()); state = r.state; say(r.tip); },
        moved: (x, y) => ls.set(K_POS, JSON.stringify({ x, y })),
      });

      // First visit of the day: greeting plus the tip of the day. Later visits: a quiet wave.
      const today = dayKey(new Date());
      engine.play("Greeting");
      if (ls.get(K_DAY) !== today) {
        ls.set(K_DAY, today);
        engine.speak(`${pack().greeting} ${t("clippy.tipOfDay", { tip: tipOfTheDay(pack(), new Date()) })}`);
      }

      const off = onClippy(onEvent);
      const active = () => { lastActive = Date.now(); idleTold = false; };
      window.addEventListener("pointerdown", active, true);
      window.addEventListener("keydown", active, true);
      const idle = window.setInterval(() => {
        if (document.hidden || idleTold || Date.now() - lastActive < LONG_IDLE_MS) return;
        idleTold = true; // once per quiet spell
        onEvent({ kind: "idle" });
      }, 10_000);
      cleanup = () => {
        off();
        window.removeEventListener("pointerdown", active, true);
        window.removeEventListener("keydown", active, true);
        window.clearInterval(idle);
        engine.dispose();
        renderer.destroy();
        live.current = null;
      };
    }, () => undefined);
    return () => { dead = true; cleanup(); };
  }, []);

  useEffect(() => { live.current?.engine.setScale(scale); }, [scale]);
  useEffect(() => { live.current?.engine.setReducedMotion(prefersReducedMotion({ ...settings.get(), motion })); }, [motion]);
  useEffect(() => { live.current?.renderer.setLabel(translate(locale, "clippy.label")); }, [locale]);
  return null;
}
