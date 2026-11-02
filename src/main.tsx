import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "98.css";
import "./styles/integrations.css";
import "./styles/win97.css";
import "./styles/boot.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";

// Excalidraw resolves its fonts against this path; they are self-hosted in /fonts (scripts/copy-fonts.mjs).
(window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = import.meta.env.BASE_URL || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
