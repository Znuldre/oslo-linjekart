"use client";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Lang, Line, SchematicLayout, StationIndex } from "@/lib/types";
import { useMapState, type MapView } from "@/lib/url-state";
import { localePath, withBase } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SchematicMap } from "./SchematicMap";
import { LayerToggles } from "./LayerToggles";
import { useLineStatus } from "./useLineStatus";
import { StationCard } from "@/components/station/StationCard";
import { StationSearch } from "./StationSearch";

const GeoMap = dynamic(() => import("./GeoMap").then((m) => m.GeoMap), {
  ssr: false,
  loading: () => <GeoLoading />,
});

function GeoLoading() {
  const { t } = useI18n();
  return <div className="geomap geomap--loading">{t("map.loadingGeo")}</div>;
}

export interface MapExplorerProps {
  layout: SchematicLayout;
  lines: Line[];
  stations: StationIndex[];
  lang: Lang;
}

export function MapExplorer(props: MapExplorerProps) {
  return (
    <Suspense fallback={<div className="schematic schematic--placeholder" />}>
      <MapExplorerInner {...props} />
    </Suspense>
  );
}

function MapExplorerInner({ layout, lines, stations, lang }: MapExplorerProps) {
  const { t } = useI18n();
  const allCodes = useMemo(() => lines.map((l) => l.publicCode), [lines]);
  const { state, activeLines, update } = useMapState(allCodes);
  const lineIds = useMemo(() => lines.map((l) => l.id), [lines]);
  const { statuses, statusMap, loading: statusLoading } = useLineStatus(lineIds);
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null);

  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const stationById = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const selectedNode = state.station ? nodeById.get(state.station) ?? null : null;
  const selectedStations = selectedNode ? selectedNode.stationIds.map((id) => stationById.get(id)).filter((s): s is StationIndex => !!s) : [];

  const onSelect = useCallback((nodeId: string | null) => update({ station: nodeId }), [update]);
  const hrefFor = useCallback((slug: string) => withBase(localePath(lang, `/stopp/${slug}`)), [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.station) update({ station: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.station, update]);

  const disruptedCount = Object.values(statusMap).filter((s) => s === "deviation").length;

  const jumpTo = (station: StationIndex) => {
    const node = layout.nodes.find((n) => n.stationIds.includes(station.id));
    if (!node) return;
    update({ station: node.id });
    setFocus({ nodeId: node.id, nonce: Date.now() });
  };

  return (
    <section className="map-explorer" aria-label={t("nav.map")}>
      <div className="map-explorer__toolbar">
        <LayerToggles lines={lines} activeLines={activeLines} onChange={(next) => update({ lines: next.size === allCodes.length ? null : next })} status={statusMap} />
        <div className="map-explorer__tools">
          <StationSearch stations={stations} onPick={jumpTo} />
          <div className="view-switch" role="group" aria-label={t("map.view.schematic") + " / " + t("map.view.geo")}>
            {(["schematic", "geo"] as MapView[]).map((v) => (
              <button key={v} type="button" aria-pressed={state.view === v} className={state.view === v ? "is-on" : ""} onClick={() => update({ view: v })}>
                {t(`map.view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="map-explorer__status" aria-live="polite">
        <span className={`status-pill ${statusLoading ? "" : disruptedCount ? "status-pill--warn" : "status-pill--ok"}`}>
          {statusLoading ? t("map.status.loading") : disruptedCount ? `${t("map.status.deviation")}: ${disruptedCount}` : t("map.status.normal")}
        </span>
        <span className="text-meta">{t("map.status.title")}</span>
      </div>
      <div className="map-explorer__stage">
        {state.view === "geo" ? (
          <GeoMap lines={lines} stations={stations} activeLines={activeLines} selected={selectedNode?.id ?? null} onSelect={onSelect} layout={layout} lang={lang} />
        ) : (
          <SchematicMap layout={layout} lines={lines} stations={stations} activeLines={activeLines} selected={selectedNode?.id ?? null} onSelect={onSelect} hrefFor={hrefFor} status={statusMap} focus={focus} lang={lang} />
        )}
        {selectedStations.length > 0 && <StationCard stations={selectedStations} lang={lang} onClose={() => update({ station: null })} lineStatuses={statuses} statusLoading={statusLoading} />}
      </div>
    </section>
  );
}
