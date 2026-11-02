// PC Emulator: an x86 machine (v86) in a window. Boots the bundled FreeDOS floppy,
// or a disk image the user picks; the image is read locally and never uploaded.
import { useEffect, useRef, useState } from "react";
import type { V86 } from "v86";
import wasmUrl from "v86/build/v86.wasm?url";
import { useT } from "../../i18n/index.ts";
import { useStore } from "../../lib/store.ts";
import { driveFor, type Drive } from "../../lib/vpc.ts";
import { focusedId } from "../../lib/wm.ts";
import { wm } from "../../shell/wmStore.ts";
import type { AppProps } from "../registry.ts";

const asset = (file: string) => ({ url: `${import.meta.env.BASE_URL}v86/${file}` });
type Disk = { name: string; drive: Drive; buffer: ArrayBuffer };
// PS/2 break codes for Ctrl, Alt and both Shifts: the guest never sees the key-up of a modifier held while focus leaves.
const RELEASE_MODIFIERS = [0x9d, 0xb8, 0xaa, 0xb6];

export default function Vpc({ winId }: AppProps) {
  const t = useT();
  const active = useStore(wm, (s) => focusedId(s) === winId);
  const screen = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const [disk, setDisk] = useState<Disk | null>(null); // null = the bundled FreeDOS floppy
  const [emu, setEmu] = useState<V86 | null>(null); // set once the machine has loaded
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    let loaded = false;
    let machine: V86 | undefined;
    const fail = (reason: unknown) => { if (!dead) setError(reason instanceof Error ? reason.message : String(reason)); };
    void import("v86").then(({ V86 }) => {
      if (dead) return;
      const m = (machine = new V86({
        // shortcut: the hashed file name defeats v86's "-fallback.wasm" lookup, so browsers without modern wasm fail to start; ship the fallback under a fixed name if they matter.
        wasm_path: wasmUrl,
        bios: asset("seabios.bin"),
        vga_bios: asset("vgabios.bin"),
        ...(disk ? { [disk.drive]: { buffer: disk.buffer } } : { fda: asset("freedos.img") }),
        screen: { container: screen.current },
        autostart: true,
        // The speaker loads an AudioWorklet from a blob: URL, which the CSP's script-src refuses.
        disable_speaker: true,
      }));
      m.add_listener("download-error", (e) => fail(e.file_name));
      m.add_listener("emulator-loaded", () => {
        loaded = true;
        // destroy() throws on a machine that is still loading, so a window closed mid-load is torn down here.
        if (dead) void m.destroy();
        else { setEmu(m); screen.current?.focus({ preventScroll: true }); }
      });
    }, fail);
    return () => {
      dead = true;
      setEmu(null);
      if (loaded) void machine?.destroy();
    };
  }, [disk]);

  // v86 listens for keys on window and cancels each one: without this no other app could use the keyboard.
  // Keys reach the guest only while its screen has focus, so Tab can still reach the buttons.
  useEffect(() => { emu?.keyboard_set_enabled(typing); }, [emu, typing]);
  // The guest takes Tab and Escape too, so Ctrl+Alt is the way out for keyboard users (WCAG 2.1.2).
  // AltGr reports ctrlKey + altKey as well, but its key is "AltGraph", so typing AltGr characters does not release.
  const onScreenKey = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey && e.altKey && (e.key === "Control" || e.key === "Alt"))) return;
    e.stopPropagation(); // v86's listener sits on window, after React's
    openRef.current?.focus();
  };
  // An unfocused or minimised machine is paused rather than left competing for the main thread.
  useEffect(() => {
    if (!emu) return;
    emu.mouse_set_enabled(active);
    void (active ? emu.run() : emu.stop());
  }, [emu, active]);

  const openDisk = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      // shortcut: the whole image is held in RAM; switch to v86's File-backed async buffer if multi-GB images matter.
      setDisk({ name: file.name, drive: driveFor(file.name, file.size), buffer: await file.arrayBuffer() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const status = error ? t("vpc.error", { reason: error })
    : !emu ? t("vpc.starting")
    : !active ? t("vpc.paused")
    : typing ? t("vpc.running", { disk: disk?.name ?? "FreeDOS" })
    : t("vpc.click");

  return (
    <div className="vpc">
      <div className="exp-toolbar">
        <button ref={openRef} onClick={() => fileRef.current?.click()}>{t("vpc.open")}</button>
        <button disabled={!emu} onClick={() => { emu?.restart(); screen.current?.focus(); }}>{t("vpc.restart")}</button>
      </div>
      {/* v86 owns the two children: text mode renders into the div, graphics into the canvas. */}
      <div
        ref={screen} className="vpc-screen" role="application" tabIndex={0} aria-label={t("vpc.screen")}
        onFocus={() => setTyping(true)}
        onBlur={() => { setTyping(false); emu?.keyboard_send_scancodes(RELEASE_MODIFIERS); }}
        onKeyDown={onScreenKey}
        // Once a guest enables its mouse, v86 cancels mousedown over the screen, so a click alone would never focus it.
        onPointerDown={() => screen.current?.focus({ preventScroll: true })}
      >
        <div />
        <canvas hidden />
      </div>
      <div className="status-bar">
        <p className="status-bar-field" role="status" aria-live="polite">{status}</p>
      </div>
      <input ref={fileRef} type="file" accept=".img,.ima,.iso,.bin" hidden onChange={(e) => { void openDisk(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
