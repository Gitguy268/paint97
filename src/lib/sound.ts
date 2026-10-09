// Synthesised Win9x blips (WebAudio) — no audio assets. Volume/mute come from settings.
import { settings } from "./settings.ts";

let ctx: AudioContext | null = null;
let started = false;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = "square", vol = 0.06) {
  const { muted, volume } = settings.get();
  const c = muted || volume === 0 ? null : ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t = c.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * volume * 1.6, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

/** Once, on first user gesture (autoplay policy). Notes are deferred so muting mid-chime silences the tail. */
export function startupChime() {
  if (started) return;
  started = true;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => tone(f, 0, 0.12, "triangle", 0.08), i * 90));
}
export const click = () => tone(1250, 0, 0.035);
export const pop = () => { tone(740, 0, 0.05); tone(1180, 0.045, 0.06); };
export const openWin = () => { tone(660, 0, 0.06); tone(880, 0.06, 0.08); };
export const saveChord = () => [523.25, 659.25, 783.99].forEach((f) => tone(f, 0, 0.22, "triangle", 0.07));
export const errorBeep = () => { tone(220, 0, 0.12); tone(180, 0.1, 0.16); };
