"use client";
import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Lang, Line, SchematicLayout, StationIndex, GeometryCollection } from "@/lib/types";
import { useI18n } from "@/components/i18n/I18nProvider";

export interface GeoMapProps {
  lines: Line[];
  stations: StationIndex[];
  activeLines: Set<string>;
  selected: string | null;
  onSelect: (nodeId: string | null) => void;
  layout: SchematicLayout;
  lang: Lang;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function GeoMap({ stations, activeLines, selected, onSelect, layout }: GeoMapProps) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);

  // Node-id for hver stasjon (for å dele valg-tilstand med det skjematiske kartet)
  const nodeOf = (stationId: string) => layout.nodes.find((n) => n.stationIds.includes(stationId))?.id ?? null;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxzoom: 19,
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.7, "raster-brightness-max": 0.92 } }],
      },
      center: [10.75, 59.925],
      zoom: 11.2,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", async () => {
      const res = await fetch(`${BASE}/data/geometry.geojson`);
      const geo = (await res.json()) as GeometryCollection;
      m.addSource("network", { type: "geojson", data: geo as never });
      m.addLayer({
        id: "lines-casing",
        type: "line",
        source: "network",
        filter: ["==", ["get", "kind"], "line"],
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 10], "line-opacity": 0.9 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      m.addLayer({
        id: "lines",
        type: "line",
        source: "network",
        filter: ["==", ["get", "kind"], "line"],
        paint: { "line-color": ["get", "colour"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 15, 6] },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      m.addLayer({
        id: "stations",
        type: "circle",
        source: "network",
        filter: ["==", ["get", "kind"], "station"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6],
          "circle-color": "#ffffff",
          "circle-stroke-color": "#25103a",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2],
        },
      });
      m.addLayer({
        id: "station-labels",
        type: "symbol",
        source: "network",
        filter: ["==", ["get", "kind"], "station"],
        minzoom: 12.5,
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#25103a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      m.addLayer({
        id: "selected",
        type: "circle",
        source: "network",
        filter: ["==", ["get", "id"], "__none__"],
        paint: { "circle-radius": 12, "circle-color": "rgba(49,54,99,0.18)", "circle-stroke-color": "#313663", "circle-stroke-width": 2.5 },
      });
      m.on("click", "stations", (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (id) onSelect(nodeOf(id));
      });
      m.on("mouseenter", "stations", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "stations", () => (m.getCanvas().style.cursor = ""));
      ready.current = true;
      applyFilters();
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const codes = [...activeLines];
    const lineFilter: unknown[] = ["all", ["==", ["get", "kind"], "line"], ["in", ["get", "lineCode"], ["literal", codes]]];
    m.setFilter("lines", lineFilter as never);
    m.setFilter("lines-casing", lineFilter as never);
    const stationFilter: unknown[] = ["all", ["==", ["get", "kind"], "station"], ["any", ...codes.map((c) => ["in", c, ["get", "lineCodes"]])]];
    m.setFilter("stations", stationFilter as never);
    m.setFilter("station-labels", stationFilter as never);
    const selStation = selected ? layout.nodes.find((n) => n.id === selected)?.stationIds ?? [] : [];
    m.setFilter("selected", ["in", ["get", "id"], ["literal", selStation]] as never);
    if (selStation.length) {
      const st = stations.find((s) => s.id === selStation[0]);
      if (st && !m.getBounds().contains([st.lon, st.lat])) m.easeTo({ center: [st.lon, st.lat] });
    }
    void (m.getSource("network") as GeoJSONSource | undefined);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(applyFilters, [activeLines, selected]);

  return (
    <div className="geomap">
      <div ref={el} className="geomap__canvas" role="region" aria-label={t("map.view.geo")} />
    </div>
  );
}
