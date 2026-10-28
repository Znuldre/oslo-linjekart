/**
 * Validerer content/layout/oslo.json mot data/lines.json og data/stations.index.json.
 * Feil (exit 1): manglende/ukjente stasjoner, manglende segmenter for nabopar, segmenter som ikke
 * finnes i noen linje, dupliserte node-id-er, noder utenfor viewBox.
 * Advarsler (exit 0, eller 1 med --strict): ikke-oktilineære segmenter, noder utenfor rutenett,
 * noder med identiske koordinater.
 */
import { existsSync } from "node:fs";
import type { Line, StationIndex, SchematicLayout } from "../../src/lib/types.ts";
import { readJson, data, content } from "../pipeline/lib/io.ts";

const strict = process.argv.includes("--strict");
const layoutPath = content("layout", "oslo.json");

if (!existsSync(layoutPath)) {
  console.error(`Mangler ${layoutPath}. Kjør \`npm run layout:seed\` først.`);
  process.exit(1);
}
if (!existsSync(data("lines.json")) || !existsSync(data("stations.index.json"))) {
  console.error("Mangler data/lines.json eller data/stations.index.json. Kjør `npm run pipeline` først.");
  process.exit(1);
}

const layout = readJson<SchematicLayout>(layoutPath);
const lines = readJson<Line[]>(data("lines.json"));
const stations = readJson<StationIndex[]>(data("stations.index.json"));

const errors: string[] = [];
const warnings: string[] = [];

// Noder
const nodeIds = new Set<string>();
const stationToNode = new Map<string, string>();
const coordSeen = new Map<string, string>();
for (const n of layout.nodes) {
  if (nodeIds.has(n.id)) errors.push(`duplisert node-id ${n.id}`);
  nodeIds.add(n.id);
  for (const sid of n.stationIds) {
    if (stationToNode.has(sid)) errors.push(`stasjon ${sid} ligger i både ${stationToNode.get(sid)} og ${n.id}`);
    stationToNode.set(sid, n.id);
  }
  if (n.x < 0 || n.y < 0 || n.x > layout.viewBox[0] || n.y > layout.viewBox[1]) errors.push(`node ${n.id} utenfor viewBox (${n.x},${n.y})`);
  if (n.x % layout.grid !== 0 || n.y % layout.grid !== 0) warnings.push(`node ${n.id} ikke på rutenett (${n.x},${n.y})`);
  const ck = `${n.x},${n.y}`;
  if (coordSeen.has(ck)) warnings.push(`node ${n.id} har samme koordinat som ${coordSeen.get(ck)}`);
  coordSeen.set(ck, n.id);
}
const stationIds = new Set(stations.map((s) => s.id));
for (const s of stations) if (!stationToNode.has(s.id)) errors.push(`stasjon ${s.name} (${s.id}) mangler i layout`);
for (const sid of stationToNode.keys()) if (!stationIds.has(sid)) errors.push(`layout refererer ukjent stasjon ${sid}`);

// Segmenter
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
const requiredByLine = new Map<string, Set<string>>();
for (const l of lines) {
  const req = new Set<string>();
  for (const seq of l.stopSequences) {
    for (let i = 0; i < seq.stationIds.length - 1; i++) {
      const a = stationToNode.get(seq.stationIds[i]);
      const b = stationToNode.get(seq.stationIds[i + 1]);
      if (a && b && a !== b) req.add(pairKey(a, b));
    }
  }
  requiredByLine.set(l.publicCode, req);
}

const isOctilinear = (ax: number, ay: number, bx: number, by: number) => {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return dx === 0 || dy === 0 || dx === dy;
};

for (const lp of layout.lines) {
  const req = requiredByLine.get(lp.lineCode);
  if (!req) {
    errors.push(`layout har linje ${lp.lineCode} som ikke finnes i data`);
    continue;
  }
  const present = new Set<string>();
  for (const seg of lp.segments) {
    const a = nodeById.get(seg.from);
    const b = nodeById.get(seg.to);
    if (!a || !b) {
      errors.push(`linje ${lp.lineCode}: segment ${seg.from}→${seg.to} refererer ukjent node`);
      continue;
    }
    const key = pairKey(seg.from, seg.to);
    if (present.has(key)) warnings.push(`linje ${lp.lineCode}: segment ${key} duplisert`);
    present.add(key);
    if (!req.has(key)) errors.push(`linje ${lp.lineCode}: segment ${seg.from}→${seg.to} finnes ikke i linjens stoppsekvens`);
    const pts: [number, number][] = [[a.x, a.y], ...(seg.via ?? []), [b.x, b.y]];
    for (let i = 0; i < pts.length - 1; i++) {
      if (!isOctilinear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
        warnings.push(`linje ${lp.lineCode}: segment ${seg.from}→${seg.to} del ${i + 1} er ikke oktilineær`);
      }
    }
  }
  for (const key of req) if (!present.has(key)) errors.push(`linje ${lp.lineCode}: mangler segment ${key.replace("|", "→")}`);
}
for (const l of lines) if (!layout.lines.some((lp) => lp.lineCode === l.publicCode)) errors.push(`layout mangler linje ${l.publicCode}`);

for (const w of warnings.slice(0, 30)) console.warn(`  advarsel: ${w}`);
if (warnings.length > 30) console.warn(`  … og ${warnings.length - 30} advarsler til`);
for (const e of errors) console.error(`  FEIL: ${e}`);
console.log(`Layout: ${layout.nodes.length} noder, ${layout.lines.reduce((a, l) => a + l.segments.length, 0)} segmenter – ${errors.length} feil, ${warnings.length} advarsler`);
if (errors.length || (strict && warnings.length)) process.exit(1);
