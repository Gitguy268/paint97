// "Previous versions" of one drawing. Restoring opens that snapshot in Paint97 bound to
// the same file, where autosave makes it current. What it replaces is snapshotted first.
import { useT } from "../../i18n/index.ts";
import type { FsNode } from "../../lib/fs.ts";
import { fsOps } from "../../lib/fsStore.ts";
import { openInPaint } from "../paint/session.ts";

export function VersionList({ node, onDone, onError }: { node: FsNode; onDone: () => void; onError: () => void }) {
  const t = useT();
  const restore = async (at: number) => {
    try {
      const scene = await fsOps.readVersion(node.id, at);
      if (!scene) { onError(); return; }
      await fsOps.keep(node.id);
      openInPaint({ scene, name: node.name, fileId: node.id });
      onDone();
    } catch { onError(); }
  };
  if (node.versions.length === 0) return <p>{t("files.noVersions")}</p>;
  return (
    <ul className="version-list" aria-label={t("files.versions")}>
      {[...node.versions].reverse().map((at) => (
        <li key={at}>
          <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time>
          <button onClick={() => void restore(at)}>{t("files.restoreVersion")}</button>
        </li>
      ))}
    </ul>
  );
}
