"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Lang } from "@/lib/types";
import { fetchTrip, geocode, type GeocoderFeature, type TripPattern, type TripTo } from "@/lib/entur-client";
import { formatTime, formatMinutes } from "@/lib/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LineBadge } from "@/components/ui/LineBadge";

export function TripPlanner({ stationId, stationName, lat, lon, lang }: { stationId: string; stationName: string; lat: number; lon: number; lang: Lang }) {
  const { t } = useI18n();
  const id = useId();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<GeocoderFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [to, setTo] = useState<TripTo | null>(null);
  const [patterns, setPatterns] = useState<TripPattern[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "error">("idle");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2 || (to && q === to.name)) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    debounce.current = setTimeout(async () => {
      try {
        const feats = await geocode(q, { lat, lon }, lang, ctrl.signal);
        setSuggestions(feats.filter((f) => f.id !== stationId));
        setOpen(true);
        setActive(0);
      } catch {
        /* ignorer avbrutte kall */
      }
    }, 250);
    return () => ctrl.abort();
  }, [q, lat, lon, lang, stationId, to]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = async (f: GeocoderFeature) => {
    const label = f.label || f.name;
    const dest: TripTo = f.layer === "stopPlace" ? { name: label, place: f.id } : { name: label, coordinates: { latitude: f.lat, longitude: f.lon } };
    setTo(dest);
    setQ(label);
    setOpen(false);
    await search(dest);
  };

  const search = async (dest: TripTo | null = to) => {
    if (!dest) return;
    setState("searching");
    try {
      const res = await fetchTrip(stationId, dest);
      setPatterns(res);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const enturUrl = to
    ? `https://entur.no/reiseresultater?${new URLSearchParams({
        startId: stationId,
        startLabel: stationName,
        startLat: String(lat),
        startLon: String(lon),
        ...(to.place ? { stopId: to.place } : {}),
        stopLabel: to.name,
        ...(to.coordinates ? { stopLat: String(to.coordinates.latitude), stopLon: String(to.coordinates.longitude) } : {}),
        tripMode: "oneway",
        timepickerMode: "departAfter",
      }).toString()}`
    : "https://entur.no/";

  return (
    <section className="panel panel--soft" aria-labelledby="planner-h">
      <div className="panel__head">
        <h2 id="planner-h">{t("station.planner")}</h2>
      </div>
      <form
        className="planner"
        onSubmit={(e) => {
          e.preventDefault();
          if (suggestions[active] && !to) choose(suggestions[active]);
          else search();
        }}
      >
        <div className="planner__row">
          <label>{t("station.planner.from")}</label>
          <div className="planner__from">{stationName}</div>
        </div>
        <div className="planner__row">
          <label htmlFor={id}>{t("station.planner.to")}</label>
          <div className="planner__combo" ref={wrap}>
            <input
              id={id}
              type="text"
              role="combobox"
              aria-expanded={open && suggestions.length > 0}
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              autoComplete="off"
              placeholder={t("station.planner.to.placeholder")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setTo(null);
              }}
              onFocus={() => suggestions.length && setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (open && suggestions[active]) choose(suggestions[active]);
                  else if (to) search();
                  return;
                }
                if (!open) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(suggestions.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Escape") setOpen(false);
              }}
            />
            {open && suggestions.length > 0 && (
              <ul id={`${id}-list`} role="listbox" className="planner__list">
                {suggestions.map((f, i) => (
                  <li key={f.id + i} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""} onMouseDown={() => choose(f)}>
                    <span>{f.name}</span>
                    <span className="text-meta">{[humanLayer(f, t), f.locality].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="trip__actions">
          <button type="submit" className="btn btn--primary" disabled={state === "searching"}>
            {state === "searching" ? t("station.planner.searching") : t("station.planner.search")}
          </button>
          <a className="btn btn--secondary" href="https://reise.ruter.no/" rel="noopener" target="_blank">
            {t("station.planner.open")} ↗
          </a>
        </div>
      </form>
      {state === "error" && <p className="text-secondary">{t("station.planner.error")}</p>}
      {patterns && patterns.length === 0 && <p className="text-secondary">{t("station.planner.empty")}</p>}
      {patterns && patterns.length > 0 && (
        <ol className="planner" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {patterns.map((p, i) => {
            const transit = p.legs.filter((l) => l.mode !== "foot");
            const changes = Math.max(0, transit.length - 1);
            return (
              <li key={i} className="trip">
                <div className="trip__head">
                  <span>
                    {formatTime(p.expectedStartTime, lang)} – {formatTime(p.expectedEndTime, lang)}
                  </span>
                  <span>{t("station.planner.duration", { min: formatMinutes(p.duration) })}</span>
                </div>
                <div className="trip__legs">
                  {p.legs.map((l, j) => (
                    <span key={j} style={{ display: "contents" }}>
                      {j > 0 && <span className="trip__arrow">›</span>}
                      {l.mode === "foot" ? (
                        <span className="trip__leg">🚶 {t("station.planner.walk", { min: formatMinutes(l.duration) })}</span>
                      ) : (
                        <span className="trip__leg" title={`${l.fromPlace.name} → ${l.toPlace.name}`}>
                          {l.line ? <LineBadge code={l.line.publicCode} mode={l.line.transportMode === "metro" || l.line.transportMode === "tram" ? l.line.transportMode : undefined} size="sm" /> : l.mode}
                          <span>{l.fromEstimatedCall?.destinationDisplay.frontText ?? l.toPlace.name}</span>
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <div className="trip__meta">
                  <span>{changes === 0 ? t("station.planner.transfers.none") : changes === 1 ? t("station.planner.transfers.one") : t("station.planner.transfers", { n: changes })}</span>
                  {p.walkDistance >= 80 && <span>{t("station.planner.walk", { min: Math.round(p.walkDistance / 80) })}</span>}
                  <a href={enturUrl} target="_blank" rel="noopener">
                    {t("station.planner.openEntur")} ↗
                  </a>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function humanLayer(f: GeocoderFeature, t: (k: string) => string) {
  if (f.layer === "stopPlace") return t("mode.other") === "Annet" ? "Stoppested" : "Stop";
  if (f.layer === "poi") return f.categories.filter((c) => c !== "poi")[0] ?? "";
  return "";
}
