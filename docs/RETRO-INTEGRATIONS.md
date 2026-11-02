# Classic desktop integrations

The existing 98.css shell and Excalidraw drawing database are retained.

| Project | Pinned version | Used here |
| --- | --- | --- |
| [Win98-Icons](https://github.com/zhaotianff/Win98-Icons) | `3a266076e77e91a5237d2eb6c128bb4e965f7392` | Selected local PNGs for desktop, Start, window titles, switcher and taskbar; `public/icons/win98/`. |
| [BrowserFS](https://github.com/jvilk/BrowserFS) | npm `1.4.3` | Notepad stores `/notepad.json` in its dedicated `paint97-notepad` IndexedDB filesystem. Lazy-loaded; no global Node shims. |
| [RetroBar](https://github.com/dremin/RetroBar) | `69f36278150cb39bc37d3237e3178926734c6804` | Unmodified `start9x.png` and a CSS adaptation of the Windows 95–98 theme's colours, pressed borders and tray. The native .NET/WPF app cannot run in a browser; no executable is bundled. |
| [windows_98.css](https://github.com/yocontra/windows_98.css) | `a5c75c1c8fa2c4638d6192161eb7710e00a0766c` | Unmodified compiled stylesheet under `src/styles/vendor/`, in a low-priority CSS layer; its `.win98` scope is applied to Start. The menu sidebar uses the upstream gradient; house styles retain keyboard focus and layout. |

Notepad reads legacy notes first, migrates them, and retains a localStorage fallback until the BrowserFS write succeeds. Saves are ordered and write a temporary file before renaming it over the saved file. Backups keep the existing v1 format: BrowserFS notes are exported as the familiar note keys. Import replaces the note directly in BrowserFS (avoiding localStorage quota limits); reset clears it after queued writes finish. When BrowserFS is unavailable, the legacy localStorage path remains available. Drawing files, versions and the Recycle Bin keep their original database.

The service worker precaches the classic icons, BrowserFS chunk and desktop CSS/fonts. Static precache lookups tolerate the preview server’s Origin variants, so first-use offline module loading works. Nothing is fetched from these repositories at runtime. Licence texts ship in `public/licenses/`. Microsoft artwork and trademarks are not relicensed by this project or the repository's MIT notice.

BrowserFS upstream is deprecated in favour of ZenFS. The requested BrowserFS version is pinned; a future move to ZenFS must preserve the saved note and backup format.

[Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md) was read and applied as session guidance only. No skill, plugin, hooks or rule files were installed.
