// One table drives desktop icons, the Start menu, taskbar buttons and window content.
// Adding an app = one component file + one row here.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { MsgKey } from "../i18n/en.ts";
import type { Props } from "../lib/wm.ts";

export type AppProps = { winId: string; props: Props };
export type AppDef = {
  id: string;
  title: MsgKey;
  icon: string;
  component: LazyExoticComponent<ComponentType<AppProps>>;
  size: { w: number; h: number };
  singleton: boolean;
  desktop: boolean; // shows an icon on the desktop
  start: boolean; // listed in the Start menu
};

export const APPS: readonly AppDef[] = [
  { id: "settings", title: "app.settings", icon: "🛠️", component: lazy(() => import("./settings/Settings.tsx")), size: { w: 460, h: 520 }, singleton: true, desktop: false, start: true },
  { id: "help", title: "app.help", icon: "❓", component: lazy(() => import("./help/Help.tsx")), size: { w: 420, h: 300 }, singleton: true, desktop: true, start: true },
];

export const appById = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
