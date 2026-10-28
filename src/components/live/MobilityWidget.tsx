"use client";
import { useEffect, useState } from "react";
import { fetchMobility, type MobilitySnapshot } from "@/lib/entur-client";
import { useI18n } from "@/components/i18n/I18nProvider";

export function MobilityWidget({ lat, lon }: { lat: number; lon: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<MobilitySnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await fetchMobility(lat, lon, ctrl.signal);
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(load, 60_000);
    };
    load();
    return () => {
      cancelled = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [lat, lon]);

  if (failed && !data) return null;
  const scooters = data?.scooters.reduce((a, s) => a + s.count, 0) ?? 0;
  const bikes = data?.bikeStations.slice(0, 2) ?? [];

  return (
    <section className="panel" aria-labelledby="mob-h">
      <div className="panel__head">
        <h2 id="mob-h">{t("station.mobility")}</h2>
      </div>
      {!data ? (
        <p className="text-secondary">{t("common.loading")}</p>
      ) : scooters === 0 && bikes.length === 0 ? (
        <p className="text-secondary">{t("station.mobility.empty")}</p>
      ) : (
        <div className="mobility">
          {bikes.map((b) => (
            <div key={b.name} className="mobility__item">
              <span className="mobility__count">{b.bikes}</span>
              <span className="text-small">{t("station.mobility.bikes", { n: "" }).trim()}</span>
              <span className="text-meta">
                {b.name} · {t("station.mobility.nearest", { m: b.distanceM })}
              </span>
            </div>
          ))}
          {scooters > 0 && (
            <div className="mobility__item">
              <span className="mobility__count">{scooters}</span>
              <span className="text-small">{t("station.mobility.scooters", { n: "" }).trim()}</span>
              <span className="text-meta">
                {data.scooters.map((s) => `${s.operator} ${s.count}`).join(" · ")} · {t("station.mobility.within", { m: 300 })}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="text-meta">{t("station.mobility.source")}</p>
    </section>
  );
}
