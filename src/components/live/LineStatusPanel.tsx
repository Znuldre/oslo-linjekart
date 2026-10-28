"use client";
import type { Lang } from "@/lib/types";
import { isDisruptive, pickLang } from "@/lib/entur-client";
import { useLineStatus } from "@/components/map/useLineStatus";
import { useI18n } from "@/components/i18n/I18nProvider";

export function LineStatusPanel({ lineId, lang }: { lineId: string; lang: Lang }) {
  const { t } = useI18n();
  const { statuses, loading } = useLineStatus([lineId]);
  const sits = statuses?.[0]?.situations ?? [];
  return (
    <section className="panel" aria-labelledby="ls-h">
      <h2 id="ls-h">{t("line.status")}</h2>
      {loading ? (
        <p className="text-secondary">{t("map.status.loading")}</p>
      ) : sits.length === 0 ? (
        <p className="status-ok">● {t("map.status.normal")}</p>
      ) : (
        <ul className="situations">
          {sits.map((s) => {
            const sev = s.severity === "severe" || s.severity === "verySevere" ? "severe" : isDisruptive(s.severity) ? "slight" : "info";
            const summary = pickLang(s.summary, lang);
            const desc = pickLang(s.description, lang);
            return (
              <li key={s.id} className={`situation situation--${sev}`}>
                <div className="situation__head">{summary}</div>
                {desc && desc !== summary && <p className="situation__desc">{desc}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
