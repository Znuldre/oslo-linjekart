"use client";
/**
 * Enkel layout-editor for content/layout/oslo.json:
 * - dra noder (snapper til rutenett), piltaster for finjustering
 * - velg etikettretning/rotasjon for valgt node
 * - klikk på et segment for å legge til / dra via-punkt (knekk)
 * - «Kopier JSON» → lim inn i content/layout/oslo.json (eller last ned)
 * Endringer lagres i localStorage til du tømmer dem.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabelRotate, LayoutNode, Line, SchematicLayout, StationIndex } from "@/lib/types";
import { lineColour } from "@/lib/colours";
import { buildSegments, linePathD, nodeRadius, STROKE, segKey } from "@/components/map/geometry";

const KEY = "layout-editor-draft";

export function LayoutEditor({ layout: initial, lines, stations }: { layout: SchematicLayout; lines: Line[]; stations: StationIndex[] }) {
  const [layout, setLayout] = useState<SchematicLayout>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [status, setStatus] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ kind: "node"; id: string } | { kind: "via"; segKey: string; index: number } | null>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: initial.viewBox[0], h: initial.viewBox[1] });

  useEffect(() => {
    try {
      const draft = localStorage.getItem(KEY);
      if (draft) {
        setLayout(JSON.parse(draft));
        setStatus("Lastet utkast fra localStorage");
      }
    } catch {
      /* ignorer */
    }
  }, []);

  const persist = useCallback((next: SchematicLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignorer */
    }
  }, []);

  const stationById = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const segs = useMemo(() => buildSegments(layout), [layout]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = Math.max(vb.w / rect.width, vb.h / rect.height);
    const offX = (rect.width - vb.w / scale) / 2;
    const offY = (rect.height - vb.h / scale) / 2;
    return { x: vb.x + (clientX - rect.left - offX) * scale, y: vb.y + (clientY - rect.top - offY) * scale };
  };
  const snap = (v: number) => Math.round(v / layout.grid) * layout.grid;

  const updateNode = (id: string, patch: Partial<LayoutNode>) => persist({ ...layout, nodes: layout.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  const updateLabel = (id: string, patch: Partial<LayoutNode["label"]>) => {
    const n = nodeById.get(id);
    if (n) updateNode(id, { label: { ...n.label, ...patch } });
  };

  /** Oppdaterer via-punkter for et nodepar i alle linjer som bruker det. */
  const updateVia = (key: string, via: [number, number][] | undefined) => {
    const [a, b] = key.split("|");
    persist({
      ...layout,
      lines: layout.lines.map((lp) => ({
        ...lp,
        segments: lp.segments.map((s) => {
          if (segKey(s.from, s.to) !== key) return s;
          // Lagre via i segmentets egen retning
          const forward = s.from === a && s.to === b;
          const v = via && via.length ? (forward ? via : [...via].reverse()) : undefined;
          const { via: _drop, ...rest } = s;
          void _drop;
          return v ? { ...rest, via: v } : rest;
        }),
      })),
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toSvg(e.clientX, e.clientY);
    if (drag.current.kind === "node") updateNode(drag.current.id, { x: snap(p.x), y: snap(p.y) });
    else {
      const seg = segs.get(drag.current.segKey);
      if (!seg) return;
      const canonical = seg.from.id < seg.to.id ? seg.points : [...seg.points].reverse();
      const via = canonical.slice(1, -1) as [number, number][];
      via[drag.current.index] = [snap(p.x), snap(p.y)];
      updateVia(drag.current.segKey, via);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!selected) return;
    const n = nodeById.get(selected);
    if (!n) return;
    const d = e.shiftKey ? layout.grid * 5 : layout.grid;
    if (e.key === "ArrowLeft") updateNode(selected, { x: n.x - d });
    else if (e.key === "ArrowRight") updateNode(selected, { x: n.x + d });
    else if (e.key === "ArrowUp") updateNode(selected, { y: n.y - d });
    else if (e.key === "ArrowDown") updateNode(selected, { y: n.y + d });
    else return;
    e.preventDefault();
  };

  const copyJson = async () => {
    const json = JSON.stringify(layout, null, 2) + "\n";
    try {
      await navigator.clipboard.writeText(json);
      setStatus("Kopiert til utklippstavlen – lim inn i content/layout/oslo.json");
    } catch {
      setStatus("Kunne ikke kopiere – bruk «Last ned»");
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "oslo.json";
    a.click();
  };
  const reset = () => {
    localStorage.removeItem(KEY);
    setLayout(initial);
    setStatus("Tilbakestilt til fil");
  };

  const sel = selected ? nodeById.get(selected) : null;
  const selSeg = selectedSeg ? segs.get(selectedSeg) : null;
  const selVia = selSeg ? (selSeg.from.id < selSeg.to.id ? selSeg.points : [...selSeg.points].reverse()).slice(1, -1) : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", height: "100vh", fontFamily: "system-ui", fontSize: 14 }}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ width: "100%", height: "100%", background: "#f7f5f9", touchAction: "none", outline: "none" }}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        onWheel={(e) => {
          const f = Math.exp(-e.deltaY * 0.0015);
          const p = toSvg(e.clientX, e.clientY);
          setVb((c) => ({ x: p.x - (p.x - c.x) / f, y: p.y - (p.y - c.y) / f, w: c.w / f, h: c.h / f }));
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            // panorering med bakgrunn
            const start = { x: e.clientX, y: e.clientY, vb };
            const move = (ev: PointerEvent) => {
              const rect = svgRef.current!.getBoundingClientRect();
              const scale = Math.max(start.vb.w / rect.width, start.vb.h / rect.height);
              setVb({ ...start.vb, x: start.vb.x - (ev.clientX - start.x) * scale, y: start.vb.y - (ev.clientY - start.y) * scale });
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }
        }}
      >
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {lines.map((l) => (
            <path key={l.id} d={linePathD(l.publicCode, segs)} stroke={lineColour(l.publicCode, l.mode).colour} strokeWidth={STROKE} />
          ))}
        </g>
        {/* Klikkbare segmenter (usynlige, brede) */}
        <g fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: "crosshair" }}>
          {[...segs.values()].map((s) => (
            <path
              key={s.key}
              d={s.points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ")}
              stroke={selectedSeg === s.key ? "rgba(49,54,99,0.25)" : "transparent"}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedSeg(s.key);
                setSelected(null);
              }}
            />
          ))}
        </g>
        {/* Via-punkter for valgt segment */}
        {selSeg &&
          selVia.map((v, i) => (
            <circle
              key={i}
              cx={v[0]}
              cy={v[1]}
              r={6}
              fill="#e60000"
              style={{ cursor: "move" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                drag.current = { kind: "via", segKey: selSeg.key, index: i };
              }}
            />
          ))}
        <g>
          {layout.nodes.map((n) => {
            const codes = [...new Set(n.stationIds.flatMap((id) => stationById.get(id)?.lineCodes ?? []))];
            const r = nodeRadius(n, codes.length);
            const name = n.stationIds.map((id) => stationById.get(id)?.name ?? id).join(" / ");
            return (
              <g key={n.id} style={{ cursor: "move" }}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r + 4}
                  fill={selected === n.id ? "rgba(49,54,99,0.25)" : "transparent"}
                  stroke={selected === n.id ? "#313663" : "none"}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelected(n.id);
                    setSelectedSeg(null);
                    drag.current = { kind: "node", id: n.id };
                  }}
                />
                <circle cx={n.x} cy={n.y} r={r} fill="#fff" stroke={codes.length === 1 ? lineColour(codes[0]).colour : "#25103a"} strokeWidth={codes.length > 1 ? 3 : 2.4} pointerEvents="none" />
                {showLabels && (
                  <text
                    x={n.x + n.label.dx}
                    y={n.y + n.label.dy}
                    fontSize={11}
                    textAnchor={n.label.anchor}
                    transform={n.label.rotate ? `rotate(${n.label.rotate} ${n.x} ${n.y})` : undefined}
                    fill="#25103a"
                    stroke="#f7f5f9"
                    strokeWidth={3}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <aside style={{ padding: 16, borderLeft: "1px solid #ddd", overflow: "auto", display: "grid", gap: 12, alignContent: "start", background: "#fff", color: "#25103a" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Layout-editor</h1>
        <p style={{ margin: 0, color: "#625371" }}>Dra noder (snapper til {layout.grid} px), piltaster flytter valgt node (Shift = 5 ruter). Klikk på en linje for å redigere knekkpunkt. Hjul = zoom, dra bakgrunn = panorer.</p>
        <label>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Vis etiketter
        </label>
        {sel && (
          <fieldset style={{ display: "grid", gap: 6 }}>
            <legend>
              <strong>{sel.stationIds.map((id) => stationById.get(id)?.name).join(" / ")}</strong> ({sel.x}, {sel.y})
            </legend>
            <label>
              Type{" "}
              <select value={sel.kind} onChange={(e) => updateNode(sel.id, { kind: e.target.value as LayoutNode["kind"] })}>
                <option value="stop">stopp</option>
                <option value="interchange">knutepunkt</option>
                <option value="terminus">endestasjon</option>
              </select>
            </label>
            <label>
              Etikett-anker{" "}
              <select value={sel.label.anchor} onChange={(e) => updateLabel(sel.id, { anchor: e.target.value as LayoutNode["label"]["anchor"] })}>
                <option value="start">høyre for node</option>
                <option value="end">venstre for node</option>
                <option value="middle">sentrert</option>
              </select>
            </label>
            <label>
              dx <input type="number" value={sel.label.dx} step={1} onChange={(e) => updateLabel(sel.id, { dx: Number(e.target.value) })} style={{ width: 70 }} />
            </label>
            <label>
              dy <input type="number" value={sel.label.dy} step={1} onChange={(e) => updateLabel(sel.id, { dy: Number(e.target.value) })} style={{ width: 70 }} />
            </label>
            <label>
              Rotasjon{" "}
              <select value={sel.label.rotate} onChange={(e) => updateLabel(sel.id, { rotate: Number(e.target.value) as LabelRotate })}>
                {[0, 45, -45, 90, -90].map((r) => (
                  <option key={r} value={r}>
                    {r}°
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(
                [
                  ["→", "start", 11, 4],
                  ["←", "end", -11, 4],
                  ["↓", "middle", 0, 17],
                  ["↑", "middle", 0, -10],
                  ["↘", "start", 9, 13],
                  ["↗", "start", 9, -6],
                  ["↙", "end", -9, 13],
                  ["↖", "end", -9, -6],
                ] as const
              ).map(([sym, anchor, dx, dy]) => (
                <button key={sym} type="button" onClick={() => updateLabel(sel.id, { anchor, dx, dy })} title={`Etikett ${sym}`}>
                  {sym}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {selSeg && (
          <fieldset style={{ display: "grid", gap: 6 }}>
            <legend>
              <strong>Segment</strong> {selSeg.from.id} – {selSeg.to.id} ({selSeg.lineCodes.join(", ")})
            </legend>
            <p style={{ margin: 0 }}>{selVia.length} knekkpunkt (røde). Dra dem, eller:</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  const pts = selSeg.from.id < selSeg.to.id ? selSeg.points : [...selSeg.points].reverse();
                  const a = pts[0];
                  const b = pts[pts.length - 1];
                  const mid: [number, number] = [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)];
                  updateVia(selSeg.key, [...(pts.slice(1, -1) as [number, number][]), mid]);
                }}
              >
                + knekkpunkt
              </button>
              <button type="button" onClick={() => updateVia(selSeg.key, undefined)}>
                Fjern alle knekk
              </button>
              <button
                type="button"
                onClick={() => {
                  // Automatisk oktilineært knekk: diagonal først
                  const pts = selSeg.from.id < selSeg.to.id ? selSeg.points : [...selSeg.points].reverse();
                  const a = pts[0];
                  const b = pts[pts.length - 1];
                  const dx = b[0] - a[0];
                  const dy = b[1] - a[1];
                  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return updateVia(selSeg.key, undefined);
                  const via: [number, number] = Math.abs(dx) > Math.abs(dy) ? [a[0] + Math.sign(dx) * Math.abs(dy), b[1]] : [b[0], a[1] + Math.sign(dy) * Math.abs(dx)];
                  updateVia(selSeg.key, [via]);
                }}
              >
                Auto-knekk (diagonal først)
              </button>
              <button
                type="button"
                onClick={() => {
                  const pts = selSeg.from.id < selSeg.to.id ? selSeg.points : [...selSeg.points].reverse();
                  const a = pts[0];
                  const b = pts[pts.length - 1];
                  const dx = b[0] - a[0];
                  const dy = b[1] - a[1];
                  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return updateVia(selSeg.key, undefined);
                  const via: [number, number] = Math.abs(dx) > Math.abs(dy) ? [b[0] - Math.sign(dx) * Math.abs(dy), a[1]] : [a[0], b[1] - Math.sign(dy) * Math.abs(dx)];
                  updateVia(selSeg.key, [via]);
                }}
              >
                Auto-knekk (rett først)
              </button>
            </div>
          </fieldset>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={copyJson}>
            Kopier JSON
          </button>
          <button type="button" onClick={download}>
            Last ned oslo.json
          </button>
          <button type="button" onClick={reset}>
            Tilbakestill
          </button>
          <button type="button" onClick={() => setVb({ x: 0, y: 0, w: layout.viewBox[0], h: layout.viewBox[1] })}>
            Nullstill zoom
          </button>
        </div>
        <p style={{ margin: 0, color: "#056a49" }}>{status}</p>
        <p style={{ margin: 0, color: "#625371", fontSize: 12 }}>
          Etter innliming: kjør <code>npm run layout:validate</code>. Merk at <code>npm run layout:build</code> skriver over filen fra anchors.json – flytt varige endringer inn i anchors.json (ankre/vias) hvis du vil beholde begge arbeidsflytene.
        </p>
      </aside>
    </div>
  );
}
