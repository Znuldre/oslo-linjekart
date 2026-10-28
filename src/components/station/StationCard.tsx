"use client";
import Link from "next/link";
import type { Lang, StationIndex } from "@/lib/types";
import { sortLineCodes, modeOfLine } from "@/lib/line-order";
import { localePath } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LineBadge, ModeIcon } from "@/components/ui/LineBadge";
import { isDisruptive, pickLang, type LineStatus } from "@/lib/entur-client";

export function StationCard({
  stations,
  lang,
  onClose,
  lineStatuses,
  statusLoading,
}: {
  stations: StationIndex[];
  lang: Lang;
  onClose: () => void;
  lineStatuses: LineStatus[] | null;
  statusLoading: boolean;
}) {
  const { t } = useI18n();
  if (!stations.length) return null;
  const primary = stations[0];
  const codes = sortLineCodes(new Set(stations.flatMap((s) => s.lineCodes)));
  const modes = [...new Set(stations.flatMap((s) => s.modes))];
  const relevant = (lineStatuses ?? []).filter((ls) => codes.includes(ls.publicCode));
  const disruptions = relevant.flatMap((ls) => ls.situations.filter((s) => isDisruptive(s.severity)).map((s) => ({ code: ls.publicCode, text: pickLang(s.summary, lang) })));
  const seen = new Set<string>();
  const unique = disruptions.filter((d) => (seen.has(d.text) ? false : (seen.add(d.text), true))).slice(0, 3);

  return (
    <div className="station-card" role="dialog" aria-label={primary.name}>
      <div className="station-card__head">
        <div>
          <h2 className="station-card__title">{stations.map((s) => s.name).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}</h2>
          <div className="station-card__modes">
            {modes.map((m) => (
              <ModeIcon key={m} mode={m} label={t(`mode.${m}`)} />
            ))}
            <span className="station-card__badges">
              {codes.map((c) => (
                <LineBadge key={c} code={c} mode={modeOfLine(c)} size="sm" />
              ))}
            </span>
          </div>
        </div>
        <button type="button" className="station-card__close" onClick={onClose} aria-label={t("card.close")}>
          ×
        </button>
      </div>
      <div className="station-card__status" aria-live="polite">
        {statusLoading ? (
          <span className="text-secondary">{t("map.status.loading")}</span>
        ) : unique.length ? (
          <ul className="station-card__deviations">
            {unique.map((d, i) => (
              <li key={i}>
                <LineBadge code={d.code} mode={modeOfLine(d.code)} size="sm" /> <span>{d.text}</span>
              </li>
            ))}
          </ul>
        ) : lineStatuses ? (
          <span className="status-ok">● {t("card.status.normal")}</span>
        ) : (
          <span className="text-secondary">{t("card.status.unknown")}</span>
        )}
      </div>
      {stations.length > 1 && (
        <p className="text-meta">
          {stations
            .slice(1)
            .map((s) => t("card.linked", { name: s.name, distance: primary.linked.find((l) => l.stationId === s.id)?.distanceM ?? "" }))
            .join(" · ")}
        </p>
      )}
      <div className="station-card__actions">
        {stations.map((s) => (
          <Link key={s.id} href={localePath(lang, `/stopp/${s.slug}`)} className="btn btn--primary">
            {stations.length > 1 ? `${t("card.goto")}: ${s.name} (${s.modes.map((m) => t(`mode.${m}`)).join("/")})` : t("card.goto")} →
          </Link>
        ))}
      </div>
    </div>
  );
}
