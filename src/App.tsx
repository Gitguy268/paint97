import { useEffect, useState } from "react";
import { prefersReducedMotion, settings } from "./lib/settings.ts";
import { useStore } from "./lib/store.ts";
import BootScreen from "./shell/BootScreen.tsx";
import { SHARE_PREFIX } from "./lib/share.ts";
import { actions } from "./shell/wmStore.ts";
import { Shell } from "./shell/Shell.tsx";

export default function App() {
  const glass = useStore(settings, (s) => s.glass);
  const [booting, setBooting] = useState(!prefersReducedMotion());
  useEffect(() => { if (location.hash.startsWith(SHARE_PREFIX)) actions.open("paint"); }, []);
  useEffect(() => { document.documentElement.classList.toggle("glass-on", glass); }, [glass]);
  useEffect(() => {
    if (!booting) return;
    const done = () => setBooting(false);
    const id = setTimeout(done, 1400);
    window.addEventListener("keydown", done, { once: true });
    window.addEventListener("pointerdown", done, { once: true });
    return () => { clearTimeout(id); window.removeEventListener("keydown", done); window.removeEventListener("pointerdown", done); };
  }, [booting]);
  return booting ? <BootScreen /> : <Shell />;
}
