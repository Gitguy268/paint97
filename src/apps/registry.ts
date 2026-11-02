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
  { id: "paint", title: "app.paint", icon: `${import.meta.env.BASE_URL}icons/win98/paint_old-0.png`, component: lazy(() => import("./paint/Paint.tsx")), size: { w: 960, h: 690 }, singleton: true, desktop: true, start: true },
  { id: "notepad", title: "app.notepad", icon: `${import.meta.env.BASE_URL}icons/win98/notepad-1.png`, component: lazy(() => import("./notepad/Notepad.tsx")), size: { w: 480, h: 360 }, singleton: true, desktop: true, start: true },
  { id: "drawings", title: "app.drawings", icon: `${import.meta.env.BASE_URL}icons/win98/directory_closed-0.png`, component: lazy(() => import("./files/Drawings.tsx")), size: { w: 520, h: 360 }, singleton: false, desktop: true, start: true },
  { id: "bin", title: "app.bin", icon: `${import.meta.env.BASE_URL}icons/win98/recycle_bin_empty-0.png`, component: lazy(() => import("./files/Bin.tsx")), size: { w: 480, h: 320 }, singleton: true, desktop: true, start: true },
  { id: "calc", title: "app.calc", icon: `${import.meta.env.BASE_URL}icons/win98/calculator-0.png`, component: lazy(() => import("./desk/Calculator.tsx")), size: { w: 230, h: 290 }, singleton: true, desktop: false, start: true },
  { id: "mines", title: "app.mines", icon: `${import.meta.env.BASE_URL}icons/win98/game_mine_1-0.png`, component: lazy(() => import("./desk/Minesweeper.tsx")), size: { w: 250, h: 300 }, singleton: true, desktop: true, start: true },
  { id: "clock", title: "app.clock", icon: `${import.meta.env.BASE_URL}icons/win98/clock-1.png`, component: lazy(() => import("./desk/Clock.tsx")), size: { w: 230, h: 280 }, singleton: true, desktop: true, start: true },
  { id: "chat", title: "app.askClippy", icon: `${import.meta.env.BASE_URL}icons/win98/msagent-2.png`, component: lazy(() => import("./chat/Chat.tsx")), size: { w: 380, h: 440 }, singleton: true, desktop: false, start: true },
  { id: "jspaint", title: "app.jspaint", icon: `${import.meta.env.BASE_URL}icons/win98/paint_old-0.png`, component: lazy(() => import("./jspaint/JsPaint.tsx")), size: { w: 800, h: 600 }, singleton: true, desktop: false, start: true },
  { id: "vpc", title: "app.vpc", icon: `${import.meta.env.BASE_URL}icons/win98/computer-2.png`, component: lazy(() => import("./vpc/Vpc.tsx")), size: { w: 740, h: 480 }, singleton: true, desktop: false, start: true },
  { id: "settings", title: "app.settings", icon: `${import.meta.env.BASE_URL}icons/win98/directory_control_panel-2.png`, component: lazy(() => import("./settings/Settings.tsx")), size: { w: 460, h: 520 }, singleton: true, desktop: false, start: true },
  { id: "help", title: "app.help", icon: `${import.meta.env.BASE_URL}icons/win98/help_book_cool-0.png`, component: lazy(() => import("./help/Help.tsx")), size: { w: 420, h: 300 }, singleton: true, desktop: true, start: true },
];

export const appById = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
