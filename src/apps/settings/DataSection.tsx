// Backup, restore and reset of everything this browser stores for Paint97.
import { useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { exportBackup, importBackup, MAX_BACKUP_BYTES, parseBackup, resetAll, type Backup } from "../../lib/backup.ts";
import { sharedNoteStore } from "../../lib/noteStore.ts";
import { sharedStore } from "../../lib/idb.ts";
import { errorBeep } from "../../lib/sound.ts";
import { download } from "../../lib/storage.ts";
import { Dialog } from "../../ui/Dialog.tsx";

export function DataSection() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Backup | "reset" | null>(null);
  const fail = (msg: string) => { errorBeep(); setNote(msg); };

  const doExport = async () => {
    try {
      const b = await exportBackup(localStorage, await sharedStore(), new Date(), await sharedNoteStore());
      download(`paint97-backup-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b));
      setNote(t("set.exportOk"));
    } catch { fail(t("files.unavailable")); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > MAX_BACKUP_BYTES) throw new Error("too large");
      setPending(parseBackup(JSON.parse(await f.text())));
    } catch { fail(t("set.importBad")); }
  };
  // Both replace live state under the running stores, so the page restarts onto the new data.
  const confirm = async () => {
    const job = pending;
    setPending(null);
    try {
      const kv = await sharedStore();
      if (job === "reset") await resetAll(localStorage, kv, await sharedNoteStore());
      else if (job) await importBackup(job, localStorage, kv, await sharedNoteStore());
      location.reload();
    } catch { fail(t("files.unavailable")); }
  };

  return (
    <fieldset>
      <legend>{t("set.data")}</legend>
      <div className="field-row">
        <button type="button" onClick={() => void doExport()}>{t("set.export")}</button>
        <button type="button" onClick={() => fileRef.current?.click()}>{t("set.import")}</button>
        <button type="button" onClick={() => setPending("reset")}>{t("set.reset")}</button>
      </div>
      <p role="status" aria-live="polite">{note || t("set.dataHint")}</p>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label={t("set.import")} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      {pending && (
        <Dialog title={t("set.data")} onClose={() => setPending(null)} buttons={<><button type="button" onClick={() => void confirm()}>{t("ui.ok")}</button><button type="button" data-autofocus onClick={() => setPending(null)}>{t("ui.cancel")}</button></>}>
          <p>{pending === "reset" ? t("set.resetConfirm") : t("set.importConfirm", { date: pending.exportedAt.slice(0, 10) || "?" })}</p>
        </Dialog>
      )}
    </fieldset>
  );
}
