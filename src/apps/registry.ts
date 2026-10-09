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
  { id: "paint", title: "app.paint", icon: "🎨", component: lazy(() => import("./paint/Paint.tsx")), size: { w: 960, h: 690 }, singleton: true, desktop: true, start: true },
  { id: "notepad", title: "app.notepad", icon: "📝", component: lazy(() => import("./notepad/Notepad.tsx")), size: { w: 480, h: 360 }, singleton: true, desktop: true, start: true },
  { id: "drawings", title: "app.drawings", icon: "📁", component: lazy(() => import("./files/Drawings.tsx")), size: { w: 520, h: 360 }, singleton: false, desktop: true, start: true },
  { id: "bin", title: "app.bin", icon: "🗑️", component: lazy(() => import("./files/Bin.tsx")), size: { w: 480, h: 320 }, singleton: true, desktop: true, start: true },
  { id: "calc", title: "app.calc", icon: "🧮", component: lazy(() => import("./desk/Calculator.tsx")), size: { w: 230, h: 290 }, singleton: true, desktop: false, start: true },
  { id: "mines", title: "app.mines", icon: "💣", component: lazy(() => import("./desk/Minesweeper.tsx")), size: { w: 250, h: 300 }, singleton: true, desktop: true, start: true },
  { id: "clock", title: "app.clock", icon: "🕐", component: lazy(() => import("./desk/Clock.tsx")), size: { w: 230, h: 280 }, singleton: true, desktop: true, start: true },
  { id: "settings", title: "app.settings", icon: "🛠️", component: lazy(() => import("./settings/Settings.tsx")), size: { w: 460, h: 520 }, singleton: true, desktop: false, start: true },
  { id: "help", title: "app.help", icon: "❓", component: lazy(() => import("./help/Help.tsx")), size: { w: 420, h: 300 }, singleton: true, desktop: true, start: true },
];

export const appById = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
