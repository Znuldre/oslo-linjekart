/**
 * Bygger content/layout/oslo.json fra content/layout/anchors.json (håndlagte ankre) og data/lines.json.
 * - Ankrede stasjoner får faste posisjoner (+ offset).
 * - Stasjoner uten anker fordeles jevnt langs den oktilineære banen mellom nærmeste ankre i linjens stoppsekvens.
 * - Banen mellom to ankre er rett hvis den er oktilineær, ellers ett automatisk knekk (diagonal først), eller
 *   eksplisitt via-punkt(er) fra anchors.vias ("a|b").
 * - Etikettplassering velges automatisk ut fra ledig retning rundt noden.
 * Kjør: node scripts/layout/build-from-anchors.ts
 */
import type { Line, StationIndex, SchematicLayout, LayoutNode, LinePath, LineSegment, LabelRotate } from "../../src/lib/types.ts";
import { readJson, writeJson, data, content, log } from "../pipeline/lib/io.ts";

type Pt = [number, number];
interface Anchors {
  viewBox: [number, number];
  grid: number;
  offset: [number, number];
  nodes: Record<string, Pt>;
  vias?: Record<string, Pt[]>;
  /** Manuelle etikettplasseringer per stasjons-slug (overstyrer automatikken) */
  labels?: Record<string, Partial<LayoutNode["label"]>>;
}

const anchors = readJson<Anchors>(content("layout", "anchors.json"));
const lines = readJson<Line[]>(data("lines.json"));
const stations = readJson<StationIndex[]>(data("stations.index.json"));
const bySlug = new Map(stations.map((s) => [s.slug, s]));
const slugOf = new Map(stations.map((s) => [s.id, s.slug]));

const [OX, OY] = anchors.offset;
const shift = (p: Pt): Pt => [p[0] + OX, p[1] + OY];

// Kontroll: alle ankre må finnes
for (const slug of Object.keys(anchors.nodes)) if (!bySlug.has(slug)) throw new Error(`Anker «${slug}» finnes ikke blant stasjonene`);

const pos = new Map<string, Pt>(); // slug → posisjon (med offset)
for (const [slug, p] of Object.entries(anchors.nodes)) pos.set(slug, shift(p));

const viaKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const explicitVia = (a: string, b: string): Pt[] | undefined => {
  const raw = anchors.vias?.[`${a}|${b}`] ?? (anchors.vias?.[`${b}|${a}`] ? [...anchors.vias[`${b}|${a}`]].reverse() : undefined);
  return raw?.map(shift);
};

const isOcti = (a: Pt, b: Pt) => {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6;
};

/** Ett automatisk knekk: diagonal først, så rett. */
function autoBend(a: Pt, b: Pt): Pt[] {
  if (isOcti(a, b)) return [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) > Math.abs(dy)) return [[a[0] + Math.sign(dx) * Math.abs(dy), b[1]]];
  return [[b[0], a[1] + Math.sign(dy) * Math.abs(dx)]];
}

function pathBetween(aSlug: string, bSlug: string): Pt[] {
  const a = pos.get(aSlug)!;
  const b = pos.get(bSlug)!;
  const via = explicitVia(aSlug, bSlug) ?? autoBend(a, b);
  return [a, ...via, b];
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Punkt (og indeks for siste passerte hjørne) ved buelengde t langs polylinjen. */
function pointAt(poly: Pt[], t: number): { p: Pt; seg: number } {
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const L = dist(poly[i], poly[i + 1]);
    if (acc + L >= t - 1e-9) {
      const f = L === 0 ? 0 : (t - acc) / L;
      return { p: [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * f, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * f], seg: i };
    }
    acc += L;
  }
  return { p: poly[poly.length - 1], seg: poly.length - 2 };
}

// Segmenter (nodepar → via-punkter), fylles under
const segments = new Map<string, { from: string; to: string; via: Pt[] }>();
const lineSegs = new Map<string, Set<string>>();

function addSegment(lineCode: string, a: string, b: string, via: Pt[]) {
  const key = viaKey(a, b);
  if (!segments.has(key)) {
    const canonical = a < b ? { from: a, to: b, via } : { from: b, to: a, via: [...via].reverse() };
    segments.set(key, canonical);
  }
  const set = lineSegs.get(lineCode) ?? new Set<string>();
  set.add(key);
  lineSegs.set(lineCode, set);
}

// 1) Plasser stasjoner langs hver linjes sekvenser (lengste først), med ankre som faste punkt
const order = lines.map((l) => l.publicCode);
let interpolated = 0;
const runsByPair = new Map<string, Pt[]>(); // slugA>slugB → polylinje brukt

// Iterative pass: en kjøring (run) kan bare fylles når begge endene er plassert. Varianter som slutter i en
// stasjon som først plasseres av en annen linje (f.eks. Avløs på linje 2) løses i en senere runde.
const allSeqs = lines.flatMap((line) => [...line.stopSequences].sort((a, b) => b.stationIds.length - a.stationIds.length).map((seq) => ({ line, seq })));
let progress = true;
const unresolved: string[] = [];
while (progress) {
  progress = false;
  unresolved.length = 0;
  for (const { line, seq } of allSeqs) {
    const slugs = seq.stationIds.map((id) => slugOf.get(id)!);
    let i = 0;
    while (i < slugs.length) {
      if (!pos.has(slugs[i])) {
        const prev = i - 1;
        let next = i + 1;
        while (next < slugs.length && !pos.has(slugs[next])) next++;
        if (prev < 0 || next >= slugs.length) {
          unresolved.push(`linje ${line.publicCode}: «${slugs[i]}» mangler anker i ${prev < 0 ? "start" : "slutt"} av ${seq.name}`);
          i = next;
          continue;
        }
        const poly = pathBetween(slugs[prev], slugs[next]);
        const total = poly.slice(1).reduce((acc, p, k) => acc + dist(poly[k], p), 0);
        const k = next - prev - 1;
        for (let j = 1; j <= k; j++) {
          const { p } = pointAt(poly, (total * j) / (k + 1));
          pos.set(slugs[prev + j], [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
          interpolated++;
        }
        runsByPair.set(`${slugs[prev]}>${slugs[next]}`, poly);
        progress = true;
        i = next;
      } else i++;
    }
  }
}
if (unresolved.length) throw new Error(`Kunne ikke plassere alle stasjoner:\n  ${[...new Set(unresolved)].join("\n  ")}`);

// 2) Segmenter for hvert nabopar i alle sekvenser. Via-punkter = polylinjens hjørner mellom stasjonene.
for (const line of lines) {
  for (const seq of line.stopSequences) {
    const slugs = seq.stationIds.map((id) => slugOf.get(id)!);
    for (let i = 0; i < slugs.length - 1; i++) {
      const a = slugs[i];
      const b = slugs[i + 1];
      if (a === b) continue;
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      // Finn en polylinje (fra plasseringen) som inneholder begge punktene; ellers direkte bane
      let via: Pt[] = [];
      const poly = findPolyContaining(pa, pb);
      if (poly) via = cornersBetween(poly, pa, pb);
      else via = explicitVia(a, b) ?? autoBend(pa, pb);
      addSegment(line.publicCode, a, b, via);
    }
  }
}

function findPolyContaining(pa: Pt, pb: Pt): Pt[] | null {
  for (const poly of runsByPair.values()) {
    const ta = paramOn(poly, pa);
    const tb = paramOn(poly, pb);
    if (ta !== null && tb !== null) return ta <= tb ? poly : [...poly].reverse();
  }
  return null;
}

function paramOn(poly: Pt[], p: Pt): number | null {
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const L = dist(a, b);
    if (L === 0) continue;
    const cross = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L;
    const dot = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L;
    if (cross < 0.5 && dot >= -0.5 && dot <= L + 0.5) return acc + dot;
    acc += L;
  }
  return null;
}

function cornersBetween(poly: Pt[], pa: Pt, pb: Pt): Pt[] {
  const ta = paramOn(poly, pa)!;
  const tb = paramOn(poly, pb)!;
  const out: Pt[] = [];
  let acc = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    acc += dist(poly[i - 1], poly[i]);
    if (acc > ta + 0.5 && acc < tb - 0.5) out.push(poly[i]);
  }
  return out;
}

// 3) Noder med etikettplassering
const termini = new Set<string>();
for (const l of lines) for (const s of l.stopSequences) termini.add(slugOf.get(s.stationIds[0])!).add(slugOf.get(s.stationIds[s.stationIds.length - 1])!);

const DIRS: { name: string; v: Pt; anchor: LayoutNode["label"]["anchor"]; dx: number; dy: number }[] = [
  { name: "E", v: [1, 0], anchor: "start", dx: 11, dy: 4 },
  { name: "W", v: [-1, 0], anchor: "end", dx: -11, dy: 4 },
  { name: "SE", v: [0.7071, 0.7071], anchor: "start", dx: 9, dy: 13 },
  { name: "NE", v: [0.7071, -0.7071], anchor: "start", dx: 9, dy: -6 },
  { name: "SW", v: [-0.7071, 0.7071], anchor: "end", dx: -9, dy: 13 },
  { name: "NW", v: [-0.7071, -0.7071], anchor: "end", dx: -9, dy: -6 },
  { name: "S", v: [0, 1], anchor: "middle", dx: 0, dy: 17 },
  { name: "N", v: [0, -1], anchor: "middle", dx: 0, dy: -10 },
];

const SPACING = 7; // må samsvare med geometry.ts
const FONT = 11.5;
type Box = { x0: number; y0: number; x1: number; y1: number };
const placedBoxes: Box[] = [];
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Grov tekstboks for en etikett (bredde ≈ 0,56 em per tegn). */
function labelBox(p: Pt, name: string, cand: { name: string; anchor: LayoutNode["label"]["anchor"]; dx: number; dy: number }, band: number): Box {
  const w = name.length * FONT * 0.56;
  const h = FONT * 1.1;
  const extra = cand.name === "S" || cand.name === "N" || cand.name.length === 2 ? band : 0;
  const dx = cand.dx + (cand.dx > 0 ? band : cand.dx < 0 ? -band : 0);
  const dy = cand.dy + (cand.dy > 0 ? extra : cand.dy < 0 ? -extra : 0);
  const x = p[0] + dx;
  const y = p[1] + dy;
  const x0 = cand.anchor === "start" ? x : cand.anchor === "end" ? x - w : x - w / 2;
  return { x0, y0: y - h * 0.8, x1: x0 + w, y1: y + h * 0.3 };
}

function labelFor(slug: string, name: string, lineCount: number): LayoutNode["label"] {
  const p = pos.get(slug)!;
  const band = ((lineCount - 1) * SPACING) / 2; // halv bredde av linjebåndet gjennom noden
  // Retninger til nabopunkter (første via eller nabonode) langs alle segmenter fra noden
  const dirs: Pt[] = [];
  for (const seg of segments.values()) {
    if (seg.from !== slug && seg.to !== slug) continue;
    const pts = seg.from === slug ? [pos.get(seg.from)!, ...seg.via, pos.get(seg.to)!] : [pos.get(seg.to)!, ...[...seg.via].reverse(), pos.get(seg.from)!];
    const q = pts[1];
    const d = dist(p, q) || 1;
    dirs.push([(q[0] - p[0]) / d, (q[1] - p[1]) / d]);
  }
  // Også nærliggende noder (unngå å legge etikett over nabonoder)
  const nearNodes: Pt[] = [];
  for (const [other, q] of pos) {
    if (other === slug) continue;
    const d = dist(p, q);
    if (d < 120) nearNodes.push(q);
    if (d < 45) dirs.push([(q[0] - p[0]) / d, (q[1] - p[1]) / d]);
  }
  const scored = DIRS.map((cand) => {
    const minAngle = dirs.length ? Math.min(...dirs.map((d) => Math.acos(Math.max(-1, Math.min(1, d[0] * cand.v[0] + d[1] * cand.v[1]))))) : Math.PI;
    const pref = cand.name === "E" ? 0.15 : cand.name === "W" ? 0.1 : cand.name === "SE" || cand.name === "NE" ? 0.05 : 0;
    return { cand, score: minAngle + pref };
  }).sort((a, b) => b.score - a.score);
  // Første kandidat (i poengrekkefølge) hvis boksen ikke kolliderer med plasserte etiketter eller nabonoder
  let chosen = scored[0].cand;
  for (const { cand, score } of scored) {
    if (score < 0.6) break; // for nær en linje – ikke aktuelt
    const box = labelBox(p, name, cand, band);
    const hitsLabel = placedBoxes.some((b) => overlaps(b, box));
    const hitsNode = nearNodes.some((q) => q[0] > box.x0 - 6 && q[0] < box.x1 + 6 && q[1] > box.y0 - 6 && q[1] < box.y1 + 6);
    if (!hitsLabel && !hitsNode) {
      chosen = cand;
      break;
    }
  }
  placedBoxes.push(labelBox(p, name, chosen, band));
  const dx = chosen.dx + (chosen.dx > 0 ? band : chosen.dx < 0 ? -band : 0);
  const extra = chosen.name === "S" || chosen.name === "N" || chosen.name.length === 2 ? band : 0;
  const dy = chosen.dy + (chosen.dy > 0 ? extra : chosen.dy < 0 ? -extra : 0);
  const rotate: LabelRotate = 0;
  return { anchor: chosen.anchor, dx: Math.round(dx), dy: Math.round(dy), rotate };
}

// Viktigste noder først, så de får de beste plassene
const byImportance = [...stations].sort((a, b) => {
  const ta = termini.has(a.slug) ? 1 : 0;
  const tb = termini.has(b.slug) ? 1 : 0;
  return b.lineCodes.length + tb - (a.lineCodes.length + ta);
});
const labelsBySlug = new Map<string, LayoutNode["label"]>();
// Manuelle etiketter reserveres først, så automatikken ikke legger andre etiketter over dem
for (const [slug, ov] of Object.entries(anchors.labels ?? {})) {
  const s = bySlug.get(slug);
  if (!s) throw new Error(`labels: ukjent stasjon «${slug}»`);
  const label: LayoutNode["label"] = { anchor: "start", dx: 11, dy: 4, rotate: 0, ...ov };
  labelsBySlug.set(slug, label);
  const cand = { name: "manual", v: [0, 0] as Pt, anchor: label.anchor, dx: label.dx, dy: label.dy };
  placedBoxes.push(labelBox(pos.get(slug)!, s.name, cand, 0));
}
for (const s of byImportance) if (!labelsBySlug.has(s.slug)) labelsBySlug.set(s.slug, labelFor(s.slug, s.name, s.lineCodes.length));

const nodes: LayoutNode[] = stations.map((s) => {
  const p = pos.get(s.slug);
  if (!p) throw new Error(`Stasjon «${s.slug}» ble ikke plassert`);
  const kind: LayoutNode["kind"] = termini.has(s.slug) ? "terminus" : s.lineCodes.length > 1 || s.modes.length > 1 ? "interchange" : "stop";
  return { id: s.slug, stationIds: [s.id], x: p[0], y: p[1], kind, label: labelsBySlug.get(s.slug)! };
});

const linePaths: LinePath[] = order.map((code) => {
  const segs: LineSegment[] = [];
  for (const key of lineSegs.get(code) ?? []) {
    const s = segments.get(key)!;
    const seg: LineSegment = { from: s.from, to: s.to };
    if (s.via.length) seg.via = s.via.map((v) => [Math.round(v[0] * 10) / 10, Math.round(v[1] * 10) / 10]);
    segs.push(seg);
  }
  return { lineCode: code, offset: 0, segments: segs };
});

const layout: SchematicLayout = { viewBox: anchors.viewBox, grid: anchors.grid, nodes, lines: linePaths };
writeJson(content("layout", "oslo.json"), layout);
log("layout", `${nodes.length} noder (${Object.keys(anchors.nodes).length} ankre, ${interpolated} interpolert), ${segments.size} segmenter → content/layout/oslo.json`);
