/**
 * Rendrer det skjematiske kartet til SVG + PNG uten nettleser (for rask visuell kontroll av layouten).
 *   node scripts/layout/render-preview.ts [--out <mappe>] [--scale 1] [--labels all|major|none] [--crop x,y,w,h]
 * Skriver preview.svg og preview.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Line, StationIndex, SchematicLayout } from "../../src/lib/types.ts";
import { LINE_COLOURS } from "../../src/lib/colours.ts";
import { buildSegments, linePathD, nodeRadius, STROKE } from "../../src/components/map/geometry.ts";
import { readJson, data, content } from "../pipeline/lib/io.ts";

const require = createRequire(import.meta.url);
const { Resvg } = require("@resvg/resvg-js") as { Resvg: new (svg: string, opts?: unknown) => { render(): { asPng(): Buffer } } };

const args = process.argv.slice(2);
const argVal = (f: string, d: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const outDir = argVal("--out", join(process.cwd(), ".cache", "preview"));
const scale = Number(argVal("--scale", "1"));
const labels = argVal("--labels", "all");
const crop = argVal("--crop", "").split(",").map(Number).filter((n) => !Number.isNaN(n));

const layout = readJson<SchematicLayout>(content("layout", "oslo.json"));
const lines = readJson<Line[]>(data("lines.json"));
const stations = readJson<StationIndex[]>(data("stations.index.json"));
const stationById = new Map(stations.map((s) => [s.id, s]));
const segs = buildSegments(layout);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const vb = crop.length === 4 ? crop : [0, 0, layout.viewBox[0], layout.viewBox[1]];
const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" width="${vb[2] * scale}" height="${vb[3] * scale}" font-family="Segoe UI, Arial, sans-serif">`);
parts.push(`<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#f7f5f9"/>`);
parts.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
for (const l of lines) {
  const c = LINE_COLOURS[l.publicCode]?.colour ?? "#888";
  parts.push(`<path d="${linePathD(l.publicCode, segs)}" stroke="${c}" stroke-width="${STROKE}"/>`);
}
parts.push(`</g><g>`);
for (const n of layout.nodes) {
  const sts = n.stationIds.map((id) => stationById.get(id)!).filter(Boolean);
  const codes = [...new Set(sts.flatMap((s) => s.lineCodes))];
  const r = nodeRadius(n, codes.length);
  const stroke = codes.length === 1 ? LINE_COLOURS[codes[0]]?.colour ?? "#25103a" : "#25103a";
  parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="#fff" stroke="${stroke}" stroke-width="${codes.length > 1 ? 3 : 2.4}"/>`);
  if (codes.length > 1) parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${Math.max(1.5, r - 3.6)}" fill="#25103a"/>`);
  const show = labels === "all" || (labels === "major" && (n.kind !== "stop" || codes.length > 1));
  if (show) {
    const name = sts.map((s) => s.name).join(" / ");
    const size = 10.5;
    const x = n.x + n.label.dx * (size / 11.5);
    const y = n.y + n.label.dy * (size / 11.5);
    const tr = n.label.rotate ? ` transform="rotate(${n.label.rotate} ${n.x} ${n.y})"` : "";
    parts.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${n.label.anchor}" fill="#25103a" stroke="#f7f5f9" stroke-width="3" paint-order="stroke" font-weight="500"${tr}>${esc(name)}</text>`);
  }
}
parts.push(`</g></svg>`);
const svg = parts.join("\n");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "preview.svg"), svg);
const png = new Resvg(svg, { fitTo: { mode: "width", value: Math.round(vb[2] * scale) } }).render().asPng();
writeFileSync(join(outDir, "preview.png"), png);
console.log(`Skrev ${join(outDir, "preview.png")} (${Math.round(vb[2] * scale)}×${Math.round(vb[3] * scale)})`);
