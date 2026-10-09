import { useT } from "../../i18n/index.ts";

export default function Help() {
  const t = useT();
  return (
    <div className="pane pad">
      <h2>{t("help.shortcuts")}</h2>
      <ul>
        {(["help.altTab", "help.winKey", "help.f2", "help.del", "help.undo"] as const).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </div>
  );
}
