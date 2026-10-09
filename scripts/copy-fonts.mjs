// Self-host Excalidraw's fonts (public/fonts, gitignored) so font-src can be 'self' only.
import fs from "node:fs";
fs.cpSync("node_modules/@excalidraw/excalidraw/dist/prod/fonts", "public/fonts", { recursive: true });
