import { useT } from "../../i18n/index.ts";
import { TIP_PACKS } from "../../clippy/tips.ts";
import { settings, updateSettings, type Locale, type MotionPref, type Personality } from "../../lib/settings.ts";
import { useStore } from "../../lib/store.ts";
import { WALLPAPERS } from "../../lib/wallpapers.ts";
import { DataSection } from "./DataSection.tsx";

export default function Settings() {
  const t = useT();
  const s = useStore(settings, (x) => x);
  return (
    <form className="pane pad settings" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>{t("set.display")}</legend>
        <div className="field-row">
          <label htmlFor="set-wp">{t("set.wallpaper")}</label>
          <select id="set-wp" value={s.wallpaper} onChange={(e) => updateSettings({ wallpaper: e.target.value as typeof s.wallpaper })}>
            {WALLPAPERS.map((w) => <option key={w.id} value={w.id}>{t(`wp.${w.id}`)}</option>)}
          </select>
        </div>
        <div className="field-row">
          <input id="set-glass" type="checkbox" checked={s.glass} onChange={(e) => updateSettings({ glass: e.target.checked })} />
          <label htmlFor="set-glass">{t("set.glass")}</label>
        </div>
        <div className="field-row">
          <label htmlFor="set-lang">{t("set.language")}</label>
          <select id="set-lang" value={s.locale} onChange={(e) => updateSettings({ locale: e.target.value as Locale })}>
            <option value="en">English</option>
            <option value="nl">Nederlands</option>
          </select>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("set.sound")}</legend>
        <div className="field-row">
          <label htmlFor="set-vol">{t("set.volume")}</label>
          <input id="set-vol" type="range" min={0} max={100} value={Math.round(s.volume * 100)} onChange={(e) => updateSettings({ volume: Number(e.target.value) / 100 })} />
        </div>
        <div className="field-row">
          <input id="set-mute" type="checkbox" checked={s.muted} onChange={(e) => updateSettings({ muted: e.target.checked })} />
          <label htmlFor="set-mute">{t("set.muted")}</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("set.clippy")}</legend>
        <div className="field-row">
          <input id="set-clippy" type="checkbox" checked={s.clippyOn} onChange={(e) => updateSettings({ clippyOn: e.target.checked })} />
          <label htmlFor="set-clippy">{t("set.clippyOn")}</label>
        </div>
        <div className="field-row">
          <label htmlFor="set-pers">{t("set.personality")}</label>
          <select id="set-pers" value={s.personality} onChange={(e) => updateSettings({ personality: e.target.value as Personality })}>
            {TIP_PACKS.map((p) => <option key={p.id} value={p.id}>{t(`tip.personality.${p.id}`)}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="set-scale">{t("set.scale")}</label>
          <select id="set-scale" value={s.clippyScale} onChange={(e) => updateSettings({ clippyScale: Number(e.target.value) as 1 | 2 | 3 | 4 })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}×</option>)}
          </select>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("set.access")}</legend>
        <div className="field-row">
          <label htmlFor="set-motion">{t("set.motion")}</label>
          <select id="set-motion" value={s.motion} onChange={(e) => updateSettings({ motion: e.target.value as MotionPref })}>
            <option value="system">{t("set.motion.system")}</option>
            <option value="reduce">{t("set.motion.reduce")}</option>
            <option value="full">{t("set.motion.full")}</option>
          </select>
        </div>
      </fieldset>
      <DataSection />
    </form>
  );
}
