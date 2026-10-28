/** Server-side lesing av genererte data (kun i server-komponenter / generateStaticParams). */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Line, Station, StationIndex, SchematicLayout } from "./types";

const DATA = join(process.cwd(), "data");
const CONTENT = join(process.cwd(), "content");

const cache = new Map<string, unknown>();
const useCache = process.env.NODE_ENV === "production";
function readJson<T>(path: string): T {
  if (!useCache) return JSON.parse(readFileSync(path, "utf8")) as T;
  if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return cache.get(path) as T;
}

export const getLines = () => readJson<Line[]>(join(DATA, "lines.json"));
export const getStationIndex = () => readJson<StationIndex[]>(join(DATA, "stations.index.json"));
export const getLayout = () => readJson<SchematicLayout>(join(CONTENT, "layout", "oslo.json"));
export const getHubs = () => readJson<{ slug: string; name: string; stationId: string | null }[]>(join(DATA, "hubs.json"));

export function getStationSlugs(): string[] {
  return readdirSync(join(DATA, "stations"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function getStation(slug: string): Station | null {
  try {
    return readJson<Station>(join(DATA, "stations", `${slug}.json`));
  } catch {
    return null;
  }
}

export function getStationById(id: string): StationIndex | undefined {
  return getStationIndex().find((s) => s.id === id);
}

export const LINE_ORDER = ["1", "2", "3", "4", "5", "12", "13", "15", "17", "18", "19"];
export const sortLineCodes = (codes: string[]) => [...codes].sort((a, b) => LINE_ORDER.indexOf(a) - LINE_ORDER.indexOf(b));
