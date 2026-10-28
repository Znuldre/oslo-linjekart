/**
 * Lager et første utkast til skjematisk layout (content/layout/oslo.json) fra geografiske
 * koordinater: affin projeksjon → rutenett → kollisjonsløsning → oktilineære segmenter med ett knekk.
 * Kjør: node scripts/layout/seed-from-geo.ts [--overwrite]
 * Skriver ikke over eksisterende fil uten --overwrite.
 */
import { existsSync } from "node:fs";
import type { Line, StationIndex, SchematicLayout, LayoutNode, LinePath, LineSegment } from "../../src/lib/types.ts";
import { readJson, writeJson, data, content, log } from "../pipeline/lib/io.ts";

const VIEW: [number, number] = [1600, 1100];
const GRID = 10;
const MARGIN = 80;

const overwrite = process.argv.includes("--overwrite");
const target = content("layout", "oslo.json");
if (existsSync(target) && !overwrite) {
  console.error(`${target} finnes allerede. Bruk --overwrite for å erstatte.`);
  process.exit(1);
}

const lines = readJson<Line[]>(data("lines.json"));
const stations = readJson<StationIndex[]>(data("stations.index.json"));

// 1) Projeksjon
const lat0 = stations.reduce((a, s) => a + s.lat, 0) / stations.length;
const k = Math.cos((lat0 * Math.PI) / 180);
const xs = stations.map((s) => s.lon * k);
const ys = stations.map((s) => -s.lat);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);
const scale = Math.min((VIEW[0] - 2 * MARGIN) / (maxX - minX), (VIEW[1] - 2 * MARGIN) / (maxY - minY));
const snap = (v: number) => Math.round(v / GRID) * GRID;

const termini = new Set<string>();
for (const l of lines) for (const s of l.stopSequences) termini.add(s.stationIds[0]).add(s.stationIds[s.stationIds.length - 1]);

// 2) Noder + kollisjonsløsning (to noder i samme celle → skyv den ene til nærmeste ledige celle)
const occupied = new Set<string>();
const nodes: LayoutNode[] = [];
for (const s of stations) {
  let x = snap(MARGIN + (s.lon * k - minX) * scale);
  let y = snap(MARGIN + (-s.lat - minY) * scale);
  let r = 0;
  outer: while (occupied.has(`${x},${y}`)) {
    r++;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const nx = x + dx * r * GRID;
      const ny = y + dy * r * GRID;
      if (!occupied.has(`${nx},${ny}`)) {
        x = nx;
        y = ny;
        break outer;
      }
    }
  }
  occupied.add(`${x},${y}`);
  const kind: LayoutNode["kind"] = termini.has(s.id) ? "terminus" : s.lineCodes.length > 1 || s.modes.length > 1 ? "interchange" : "stop";
  nodes.push({ id: s.slug, stationIds: [s.id], x, y, kind, label: { anchor: "start", dx: 8, dy: 4, rotate: 0 } });
}
const nodeByStation = new Map(nodes.flatMap((n) => n.stationIds.map((id) => [id, n] as const)));

// 3) Segmenter med ett oktilineært knekk (diagonal først, deretter rett)
function bend(a: LayoutNode, b: LayoutNode): [number, number][] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return undefined;
  if (Math.abs(dx) > Math.abs(dy)) return [[a.x + Math.sign(dx) * Math.abs(dy), b.y]];
  return [[b.x, a.y + Math.sign(dy) * Math.abs(dx)]];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const sharedVia = new Map<string, LineSegment>();
const linePaths: LinePath[] = lines.map((l) => {
  const seen = new Set<string>();
  const segments: LineSegment[] = [];
  for (const seq of l.stopSequences) {
    for (let i = 0; i < seq.stationIds.length - 1; i++) {
      const a = nodeByStation.get(seq.stationIds[i])!;
      const b = nodeByStation.get(seq.stationIds[i + 1])!;
      const key = pairKey(a.id, b.id);
      if (seen.has(key)) continue;
      seen.add(key);
      let seg = sharedVia.get(key);
      if (!seg) {
        const [from, to] = a.id < b.id ? [a, b] : [b, a];
        seg = { from: from.id, to: to.id };
        const via = bend(from, to);
        if (via) seg.via = via;
        sharedVia.set(key, seg);
      }
      segments.push({ ...seg });
    }
  }
  return { lineCode: l.publicCode, offset: 0, segments };
});

const layout: SchematicLayout = { viewBox: VIEW, grid: GRID, nodes, lines: linePaths };
writeJson(target, layout);
log("seed", `${nodes.length} noder, ${sharedVia.size} unike segmenter → ${target}`);
