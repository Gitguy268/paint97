// Apps announce what the user is doing; Clippy listens. Keeps apps independent of the assistant.
export type ClippyEvent =
  | { kind: "tool"; tool: string }
  | { kind: "save" }
  | { kind: "export" }
  | { kind: "error"; message: string }
  | { kind: "empty" } // canvas just became empty
  | { kind: "help" };

type Listener = (e: ClippyEvent) => void;
const listeners = new Set<Listener>();
export const emitClippy = (e: ClippyEvent) => listeners.forEach((l) => l(e));
export function onClippy(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}
