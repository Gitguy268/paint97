// Excalidraw mount + debounced autosave. Loaded lazily by Paint.tsx.
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "../../styles/excalidraw-overrides.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { loadScene, saveScene, type Scene } from "../../lib/storage.ts";
import type { PaintApi } from "./api.ts";

const SAVE_MS = 600;

export type StageProps = {
  onApi: (api: PaintApi) => void;
  onChange: (elements: readonly ExcalidrawElement[], appState: AppState) => void;
  /** Called once per failed-save streak. */
  onStorageError: () => void;
  /** Called with each autosaved scene (used for per-drawing saves). */
  onPersist?: (scene: Scene) => void;
};

export default function Stage({ onApi, onChange, onStorageError, onPersist }: StageProps) {
  const [initial, setInitial] = useState<Scene | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Scene | null>(null);
  const errored = useRef(false);
  const cb = useRef({ onStorageError, onPersist });
  useEffect(() => { cb.current = { onStorageError, onPersist }; });

  useEffect(() => {
    let dead = false;
    void loadScene().then((s) => !dead && setInitial(s), () => !dead && setInitial(null));
    return () => { dead = true; };
  }, []);

  const persist = (scene: Scene) => {
    cb.current.onPersist?.(scene);
    void saveScene(scene.elements, scene.appState).then(
      () => { errored.current = false; },
      () => { if (!errored.current) { errored.current = true; cb.current.onStorageError(); } },
    );
  };
  // Flush the pending write when the window closes.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) persist(pending.current);
  // eslint-disable-next-line -- persist reads refs only
  }, []);

  return (
    <div className="excali-host">
      {initial !== undefined && (
        <Excalidraw
          excalidrawAPI={onApi}
          initialData={{ elements: (initial?.elements ?? []) as ExcalidrawElement[], appState: { ...(initial?.appState ?? {}), currentItemFontFamily: 2 } as Partial<AppState> }}
          onChange={(elements, appState) => {
            onChange(elements, appState);
            pending.current = { elements: elements as unknown as object[], appState };
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => { timer.current = null; if (pending.current) { persist(pending.current); pending.current = null; } }, SAVE_MS);
          }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
        />
      )}
    </div>
  );
}
