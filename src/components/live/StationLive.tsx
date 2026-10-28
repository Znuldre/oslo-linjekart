"use client";
import { useEffect, useMemo, useState } from "react";
import type { Lang } from "@/lib/types";
import { isDisruptive, pickLang, type EstimatedCall, type Situation } from "@/lib/entur-client";
import { formatTime, minutesUntil } from "@/lib/format";
import { modeOfLine, sortLineCodes } from "@/lib/line-order";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LineBadge } from "@/components/ui/LineBadge";
import { useStopLive } from "./useStopLive";

export function StationLive({ stopPlaceIds, lineIds, lineCodes, lang }: { stopPlaceIds: string[]; lineIds: string[]; lineCodes: string[]; lang: Lang }) {
  const { t } = useI18n();
  const { live, error, loading } = useStopLive(stopPlaceIds, lineIds);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(i);
  }, []);

  const situations = useMemo(() => {
    if (!live) return [];
    const all: (Situation & { codes: string[] })[] = [];
    for (const s of live.stop.situations) all.push({ ...s, codes: [] });
    for (const ls of live.lines) for (const s of ls.situations) all.push({ ...s, codes: [ls.publicCode] });
    // Slå sammen like meldinger på tvers av linjer
    const byKey = new Map<string, Situation & { codes: string[] }>();
    for (const s of all) {
      const key = pickLang(s.summary, lang);
      const cur = byKey.get(key);
      if (cur) cur.codes = sortLineCodes(new Set([...cur.codes, ...s.codes]));
      else byKey.set(key, { ...s, codes: [...s.codes] });
    }
    const order = (s: Situation) => (s.severity === "severe" || s.severity === "verySevere" ? 0 : s.severity === "slight" ? 1 : 2);
    return [...byKey.values()].sort((a, b) => order(a) - order(b));
  }, [live, lang]);

  const groups = useMemo(() => groupCalls(live?.stop.estimatedCalls ?? []), [live]);

  return (
    <>
      <section className="panel" aria-labelledby="status-h">
        <div className="panel__head">
          <h2 id="status-h">{t("station.status")}</h2>
        </div>
        {loading ? (
          <p className="text-secondary">{t("common.loading")}</p>
        ) : situations.length === 0 ? (
          <p className="status-ok">● {t("station.status.none")}</p>
        ) : (
          <ul className="situations">
            {situations.map((s) => {
              const sev = s.severity === "severe" || s.severity === "verySevere" ? "severe" : isDisruptive(s.severity) ? "slight" : "info";
              const desc = pickLang(s.description, lang);
              return (
                <li key={s.id} className={`situation situation--${sev}`}>
                  <div className="situation__head">
                    {s.codes.map((c) => (
                      <LineBadge key={c} code={c} mode={modeOfLine(c)} size="sm" />
                    ))}
                    <span>{pickLang(s.summary, lang)}</span>
                  </div>
                  {desc && desc !== pickLang(s.summary, lang) && <p className="situation__desc">{desc}</p>}
                  {s.infoLinks?.[0]?.uri && (
                    <a className="text-small" href={s.infoLinks[0].uri} rel="noopener">
                      {s.infoLinks[0].label || s.infoLinks[0].uri}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="dep-h">
        <div className="panel__head">
          <h2 id="dep-h">{t("station.departures")}</h2>
          {live && <span className="text-meta">{t("station.departures.updated", { time: formatTime(new Date(live.updatedAt).toISOString(), lang) })}</span>}
        </div>
        {error && !live ? (
          <p className="text-secondary">{t("station.departures.error")}</p>
        ) : loading ? (
          <p className="text-secondary">{t("common.loading")}</p>
        ) : groups.length === 0 ? (
          <p className="text-secondary">{t("station.departures.empty")}</p>
        ) : (
          <ul className="departures">
            {groups.map((g) => (
              <li key={g.key}>
                <LineBadge code={g.code} mode={modeOfLine(g.code)} />
                <span className="departures__dest">
                  <span>{g.frontText}</span>
                  {g.platform && <span className="departures__platform">{t("station.departures.platform", { code: g.platform })}</span>}
                </span>
                <span className="departures__times">
                  {g.calls.slice(0, 3).map((c, i) => {
                    const mins = now ? minutesUntil(c.expectedDepartureTime, now) : null;
                    const label = mins === null ? formatTime(c.expectedDepartureTime, lang) : mins <= 0 ? t("station.departures.now") : mins < 30 ? t("station.departures.min", { min: mins }) : formatTime(c.expectedDepartureTime, lang);
                    return (
                      <span key={i} className={`${c.realtime ? "departures__time--rt" : ""}${c.cancellation ? " departures__time--cancelled" : ""}`} title={c.realtime ? t("station.departures.realtime") : t("station.departures.scheduled")}>
                        {label}
                      </span>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-meta">
          <span className="departures__time--rt">{t("station.departures.realtime")}</span> · {t("station.departures.scheduled")}
        </p>
      </section>
      <span className="visually-hidden">{lineCodes.join(", ")}</span>
    </>
  );
}

interface Group {
  key: string;
  code: string;
  frontText: string;
  platform: string | null;
  calls: EstimatedCall[];
}

function groupCalls(calls: EstimatedCall[]): Group[] {
  const map = new Map<string, Group>();
  for (const c of calls) {
    const key = `${c.serviceJourney.line.publicCode}|${c.destinationDisplay.frontText}`;
    const g = map.get(key) ?? { key, code: c.serviceJourney.line.publicCode, frontText: c.destinationDisplay.frontText, platform: c.quay.publicCode, calls: [] };
    g.calls.push(c);
    if (g.platform !== c.quay.publicCode) g.platform = g.platform && c.quay.publicCode ? g.platform : null;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => a.calls[0].expectedDepartureTime.localeCompare(b.calls[0].expectedDepartureTime));
}
