import { settings } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { en, type MsgKey } from "./en.ts";
import { nl } from "./nl.ts";

export type { MsgKey };
const dicts = { en, nl } as const;

/** Translate with {name} interpolation. Falls back to English, then the key. */
export function translate(locale: "en" | "nl", key: MsgKey, vars?: Record<string, string | number>): string {
  const raw: string = dicts[locale][key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}
export const t = (key: MsgKey, vars?: Record<string, string | number>) => translate(settings.get().locale, key, vars);

/** React hook: re-renders on locale change. */
export function useT() {
  const locale = useStore(settings, (s) => s.locale);
  return (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
