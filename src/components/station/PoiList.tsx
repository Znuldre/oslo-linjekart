"use client";
import { useEffect, useId, useState } from "react";
import type { Lang, Poi } from "@/lib/types";
import { pick } from "@/lib/i18n";
import { formatMinutes } from "@/lib/format";
import { useI18n } from "@/components/i18n/I18nProvider";

const MIN = 200;
const MAX = 1200;
const STEP = 100;
const KEY = "poi-max-walk-v2";

export function PoiList({ pois, lang }: { pois: Poi[]; lang: Lang }) {
  const { t } = useI18n();
  const id = useId();
  const [max, setMax] = useState(MAX);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (v >= MIN && v <= MAX) setMax(v);
    } catch {
      /* ingen lagring */
    }
  }, []);
  const update = (v: number) => {
    setMax(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* ingen lagring */
    }
  };

  const visible = pois.filter((p) => p.walk.distanceM <= max);

  return (
    <section className="panel" aria-labelledby="poi-h">
      <div className="panel__head">
        <h2 id="poi-h">{t("station.pois")}</h2>
        <span className="text-meta">{t("station.pois.intro")}</span>
      </div>
      <div className="poi-controls">
        <div className="poi-controls__row">
          <label htmlFor={id}>{t("station.pois.maxWalk")}</label>
          <input id={id} type="range" min={MIN} max={MAX} step={STEP} value={max} onChange={(e) => update(Number(e.target.value))} aria-valuetext={`${max} m`} />
          <output htmlFor={id} style={{ minWidth: "3.5rem", textAlign: "right", fontWeight: 500 }}>
            {max} m
          </output>
        </div>
      </div>
      {pois.length === 0 || visible.length === 0 ? (
        <p className="text-secondary">{t("station.pois.empty", { distance: max })}</p>
      ) : (
        <ul className="poi-grid">
          {visible.map((p) => {
            const name = pick(p.name, lang);
            const wp = lang === "en" ? p.wikipedia?.en ?? p.wikipedia?.nb : p.wikipedia?.nb ?? p.wikipedia?.en;
            const wpLang = lang === "en" ? (p.wikipedia?.en ? "en" : "no") : p.wikipedia?.nb ? "no" : "en";
            return (
              <li key={p.id} className="poi-card">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="poi-card__img" src={p.image.url} alt="" loading="lazy" title={p.image.attribution} />
                ) : (
                  <div className="poi-card__placeholder" aria-hidden="true">
                    {t(`poi.category.${p.category}`)}
                  </div>
                )}
                <div className="poi-card__body">
                  <div className="poi-card__meta">
                    <span>{t(`poi.category.${p.category}`)}</span>
                    <span className="poi-card__walk">{p.walk.distanceM < 60 ? t("station.pois.atStop") : t("station.pois.walk", { min: formatMinutes(p.walk.durationS) })}</span>
                  </div>
                  <h3>{name}</h3>
                  {p.summary && <p className="poi-card__summary">{pick(p.summary, lang)}</p>}
                  <div className="poi-card__links">
                    {wp && (
                      <a href={`https://${wpLang}.wikipedia.org/wiki/${encodeURIComponent(wp.replace(/ /g, "_"))}`} rel="noopener" target="_blank">
                        {t("station.pois.readMore")}
                      </a>
                    )}
                    {p.website && (
                      <a href={p.website} rel="noopener" target="_blank">
                        {t("station.pois.website")}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-meta">{t("station.pois.source")}</p>
    </section>
  );
}
