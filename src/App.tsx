import { lazy, Suspense, useEffect, useState } from "react";
import { prefersReducedMotion, settings } from "./lib/settings.ts";
import { useStore } from "./lib/store.ts";
import BootScreen from "./shell/BootScreen.tsx";
import { RTC_PREFIX } from "./lib/nearby.ts";
import { SHARE_PREFIX } from "./lib/share.ts";
import { actions } from "./shell/wmStore.ts";
import { Shell } from "./shell/Shell.tsx";

const Clippy = lazy(() => import("./clippy/Clippy.tsx"));

export default function App() {
  const glass = useStore(settings, (s) => s.glass);
  const clippyOn = useStore(settings, (s) => s.clippyOn);
  const [booting, setBooting] = useState(!prefersReducedMotion());
  useEffect(() => { if (location.hash.startsWith(SHARE_PREFIX) || location.hash.startsWith(RTC_PREFIX)) actions.open("paint"); }, []);
  useEffect(() => { document.documentElement.classList.toggle("glass-on", glass); }, [glass]);
  useEffect(() => {
    if (!booting) return;
    const done = () => setBooting(false);
    const id = setTimeout(done, 1400);
    window.addEventListener("keydown", done, { once: true });
    window.addEventListener("pointerdown", done, { once: true });
    return () => { clearTimeout(id); window.removeEventListener("keydown", done); window.removeEventListener("pointerdown", done); };
  }, [booting]);
  return booting ? <BootScreen /> : <Shell>{clippyOn && <Suspense fallback={null}><Clippy /></Suspense>}</Shell>;
}
