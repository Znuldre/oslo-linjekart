"use client";
import Link from "next/link";
import { useMemo } from "react";
import type { Lang, Line, SchematicLayout, StationIndex } from "@/lib/types";
import { localePath, withBase } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SchematicMap } from "@/components/map/SchematicMap";

export function StationMiniMap({ layout, lines, stations, stationId, lang }: { layout: SchematicLayout; lines: Line[]; stations: StationIndex[]; stationId: string; lang: Lang }) {
  const { t } = useI18n();
  const node = layout.nodes.find((n) => n.stationIds.includes(stationId));
  const station = stations.find((s) => s.id === stationId);
  const active = useMemo(() => new Set(station?.lineCodes ?? lines.map((l) => l.publicCode)), [station, lines]);
  const focus = useMemo(() => (node ? { nodeId: node.id, nonce: 1 } : null), [node]);
  if (!node) return null;
  return (
    <section className="panel" aria-labelledby="minimap-h">
      <div className="panel__head">
        <h2 id="minimap-h">{t("station.map")}</h2>
        <Link href={`${localePath(lang)}?station=${encodeURIComponent(node.id)}`}>{t("station.map.open")} →</Link>
      </div>
      <SchematicMap layout={layout} lines={lines} stations={stations} activeLines={active} selected={node.id} onSelect={() => {}} hrefFor={(slug) => withBase(localePath(lang, `/stopp/${slug}`))} compact focus={focus} lang={lang} />
    </section>
  );
}
