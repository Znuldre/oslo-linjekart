"use client";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Lang, Line, LayoutNode, SchematicLayout, StationIndex } from "@/lib/types";
import { lineColour } from "@/lib/colours";
import { sortLineCodes } from "@/lib/line-order";
import { useI18n } from "@/components/i18n/I18nProvider";
import { buildSegments, linePathD, nodeRadius, STROKE } from "./geometry";
import { useViewBox, type ViewBox } from "./useViewBox";

export interface SchematicMapProps {
  layout: SchematicLayout;
  lines: Line[];
  stations: StationIndex[];
  activeLines: Set<string>;
  selected: string | null;
  onSelect: (nodeId: string | null) => void;
  hrefFor: (slug: string) => string;
  status?: Record<string, "normal" | "deviation" | "unknown">;
  compact?: boolean;
  focus?: { nodeId: string; nonce: number } | null;
  lang: Lang;
}

export function SchematicMap({ layout, lines, stations, activeLines, selected, onSelect, hrefFor, status, compact, focus }: SchematicMapProps) {
  const { t } = useI18n();
  const full = useMemo<ViewBox>(() => ({ x: 0, y: 0, w: layout.viewBox[0], h: layout.viewBox[1] }), [layout]);
  const { vb, svgRef, handlers, zoomAt, reset, centerOn, suppressClick } = useViewBox(full, !compact);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pxWidth, setPxWidth] = useState(1000);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setPxWidth(entries[0].contentRect.width || 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const segs = useMemo(() => buildSegments(layout), [layout]);
  const stationById = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const nodeInfo = useMemo(
    () =>
      layout.nodes.map((n) => {
        const sts = n.stationIds.map((id) => stationById.get(id)).filter((s): s is StationIndex => !!s);
        const codes = sortLineCodes(new Set(sts.flatMap((s) => s.lineCodes)));
        return { node: n, stations: sts, lineCodes: codes, name: sts.map((s) => s.name).filter((v, i, a) => a.indexOf(v) === i).join(" / ") };
      }),
    [layout.nodes, stationById],
  );

  useEffect(() => {
    if (!focus) return;
    const n = layout.nodes.find((x) => x.id === focus.nodeId);
    if (n) centerOn(n.x, n.y, compact ? 4 : 3.2);
  }, [focus, layout.nodes, centerOn, compact]);

  // Skala: SVG-enheter per skjermpiksel → tekst og noderinger holder konstant skjermstørrelse
  const unitsPerPx = vb.w / pxWidth;
  const zoomLevel = full.w / vb.w;
  // Etikett-nivåer: knutepunkt/endestasjoner alltid, mellomstore knutepunkt ved moderat zoom, vanlige stopp ved nær zoom
  const pxPerUnit = 1 / unitsPerPx;
  const tier1 = pxPerUnit >= 0.9; // ~40 SVG-enheter ≥ 36 px på skjermen
  const tier2 = pxPerUnit >= 1.4;
  const labelSize = 11.5 * unitsPerPx;
  const labelVisible = (node: LayoutNode, lineCount: number, isSelected: boolean) => {
    if (isSelected) return true;
    if (compact) return lineCount > 1 || node.kind === "terminus" ? tier1 || pxPerUnit >= 0.7 : tier2;
    // Helt utzoomet: bare endestasjoner og de største knutepunktene, så sentrum ikke drukner i tekst
    if (node.kind === "terminus" || lineCount >= 6) return true;
    if (lineCount > 1) return tier1;
    return tier2;
  };
  const lineOrder = lines.map((l) => l.publicCode);

  const handleNodeClick = (e: MouseEvent, nodeId: string) => {
    if (suppressClick.current) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    onSelect(nodeId);
  };

  return (
    <div ref={wrapRef} className={`schematic${compact ? " schematic--compact" : ""}`}>
      <svg
        ref={svgRef}
        className="schematic__svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="group"
        aria-label={t("nav.map")}
        {...handlers}
        onDoubleClick={(e) => zoomAt(1.6, e.clientX, e.clientY)}
      >
        <rect x={vb.x - 5000} y={vb.y - 5000} width={vb.w + 10000} height={vb.h + 10000} fill="transparent" onClick={() => !suppressClick.current && onSelect(null)} />
        {/* Linjer (inaktive tegnes dempet) */}
        <g className="schematic__lines" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {lineOrder.map((code) => {
            const c = lineColour(code);
            const active = activeLines.has(code);
            return (
              <path
                key={code}
                d={linePathD(code, segs)}
                stroke={c.colour}
                strokeWidth={STROKE}
                opacity={active ? 1 : 0.12}
                className="schematic__line"
                data-line={code}
              />
            );
          })}
        </g>
        {/* Noder */}
        <g className="schematic__nodes">
          {nodeInfo.map(({ node, stations: sts, lineCodes, name }) => {
            const isActive = lineCodes.some((c) => activeLines.has(c));
            const r = nodeRadius(node, lineCodes.length);
            const single = lineCodes.length === 1 ? lineColour(lineCodes[0]).colour : "var(--map-ink)";
            const isSelected = selected === node.id;
            const showLabel = labelVisible(node, lineCodes.length, isSelected);
            const primary = sts[0];
            const hasDeviation = status && lineCodes.some((c) => status[c] === "deviation");
            return (
              <a
                key={node.id}
                href={primary ? hrefFor(primary.slug) : "#"}
                className={`schematic__node${isSelected ? " is-selected" : ""}${isActive ? "" : " is-inactive"}`}
                onClick={(e) => handleNodeClick(e, node.id)}
                aria-label={`${name}: ${t("station.lines").toLowerCase()} ${lineCodes.join(", ")}`}
                aria-current={isSelected ? "true" : undefined}
                tabIndex={compact ? -1 : 0}
              >
                {isSelected && <circle cx={node.x} cy={node.y} r={r + 6 * unitsPerPx + 3} className="schematic__halo" />}
                <circle cx={node.x} cy={node.y} r={r} fill="var(--map-node-fill)" stroke={single} strokeWidth={lineCodes.length > 1 ? 3 : 2.4} />
                {lineCodes.length > 1 && <circle cx={node.x} cy={node.y} r={Math.max(1.5, r - 3.6)} fill="var(--map-ink)" />}
                {hasDeviation && <circle cx={node.x + r} cy={node.y - r} r={3.2} fill="var(--error-ink)" stroke="var(--map-node-fill)" strokeWidth={1.2} />}
                {showLabel && <Label node={node} text={name} size={labelSize} />}
              </a>
            );
          })}
        </g>
      </svg>
      {!compact && (
        <div className="schematic__controls" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt(1.5)} aria-label={t("map.zoomIn")}>
            +
          </button>
          <button type="button" onClick={() => zoomAt(1 / 1.5)} aria-label={t("map.zoomOut")}>
            −
          </button>
          <button type="button" onClick={reset} aria-label={t("map.reset")}>
            ⟲
          </button>
        </div>
      )}
    </div>
  );
}

function Label({ node, text, size }: { node: LayoutNode; text: string; size: number }) {
  const { anchor, dx, dy, rotate } = node.label;
  const x = node.x + dx * (size / 11.5);
  const y = node.y + dy * (size / 11.5);
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      textAnchor={anchor}
      transform={rotate ? `rotate(${rotate} ${node.x} ${node.y})` : undefined}
      className="schematic__label"
      paintOrder="stroke"
      strokeWidth={size * 0.28}
      strokeLinejoin="round"
    >
      {text}
    </text>
  );
}
