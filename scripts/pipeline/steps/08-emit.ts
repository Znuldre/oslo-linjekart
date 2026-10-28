/**
 * Steg 08: Slå sammen basis-stasjoner med resultater fra steg 03–06 og skriv data/stations/<slug>.json.
 * Manglende mellomresultater tolereres (tomme lister / UNKNOWN), slik at frontenden kan bygges tidlig.
 */
import type { Station, Accessibility, Transfer, Poi } from "../../../src/lib/types.ts";
import { readJson, readJsonIfExists, writeJson, work, data, log } from "../lib/io.ts";
import { rmSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

export function runEmit() {
  const base = readJson<Station[]>(work("stations.base.json"));
  const accessibility = readJsonIfExists<Record<string, Accessibility>>(work("accessibility.json")) ?? {};
  const transfers = readJsonIfExists<Record<string, Transfer[]>>(work("transfers.json")) ?? {};
  const pois = readJsonIfExists<Record<string, Poi[]>>(work("pois.final.json")) ?? {};
  const wikipedia = readJsonIfExists<Record<string, { nb?: string; en?: string }>>(work("station-wikipedia.json")) ?? {};

  const dir = data("stations");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let withPoi = 0;
  for (const s of base) {
    const station: Station = {
      ...s,
      accessibility: accessibility[s.id] ?? s.accessibility,
      transfers: transfers[s.id] ?? [],
      pois: pois[s.id] ?? [],
      wikipedia: wikipedia[s.id],
    };
    if (station.pois.length) withPoi++;
    writeJson(data("stations", `${s.slug}.json`), station);
  }
  // Geometri må være tilgjengelig som statisk fil for det geografiske kartet
  mkdirSync(join(process.cwd(), "public", "data"), { recursive: true });
  copyFileSync(data("geometry.geojson"), join(process.cwd(), "public", "data", "geometry.geojson"));
  log("08-emit", `${base.length} stasjonsfiler skrevet (${withPoi} med POI, ${Object.keys(transfers).length} med overganger, ${Object.keys(accessibility).length} med tilgjengelighet)`);
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runEmit();
}
