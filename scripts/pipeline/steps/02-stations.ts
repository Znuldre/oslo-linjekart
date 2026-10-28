/**
 * Steg 02: Slå sammen stopp til stasjoner (forelder-StopPlace), lag slugs, stoppsekvenser,
 * nabostopp, «linked»-stopp, geometri og minutter til knutepunkt.
 * Leser .cache/work/lines.raw.json, skriver data/lines.json, data/stations.index.json,
 * data/geometry.geojson, data/hubs.json og .cache/work/stations.base.json.
 */
import type { RawLine, RawJourneyPattern, RawQuay } from "./01-lines.ts";
import type {
  Line,
  StationIndex,
  Station,
  Mode,
  GeometryCollection,
  LineFeature,
  StationFeature,
  StationNeighbour,
} from "../../../src/lib/types.ts";
import { LINE_COLOURS } from "../../../src/lib/colours.ts";
import { readJson, writeJson, work, data, log } from "../lib/io.ts";
import { slugify, normaliseName } from "../lib/slug.ts";
import { haversineM, decodePolyline, round } from "../lib/geo.ts";

export const HUBS: { slug: string; name: string }[] = [
  { slug: "jernbanetorget", name: "Jernbanetorget" },
  { slug: "majorstuen", name: "Majorstuen" },
];

interface StationDraft {
  id: string;
  name: string;
  lat: number;
  lon: number;
  modes: Set<Mode>;
  lineCodes: Set<string>;
  children: Set<string>;
}

const stationIdOf = (q: RawQuay) => q.stopPlace?.parent?.id ?? q.stopPlace?.id ?? null;

/** Fjerner mønstre som er (ordnede) delsekvenser av et lengre mønster i samme retning. */
function maximalPatterns(patterns: RawJourneyPattern[]): { pattern: RawJourneyPattern; stationIds: string[] }[] {
  const withIds = patterns
    .map((p) => ({ pattern: p, stationIds: dedupeAdjacent(p.quays.map(stationIdOf).filter((x): x is string => !!x)) }))
    .filter((p) => p.stationIds.length >= 2)
    .sort((a, b) => b.stationIds.length - a.stationIds.length);
  const kept: typeof withIds = [];
  for (const cand of withIds) {
    const covered = kept.some((k) => k.pattern.directionType === cand.pattern.directionType && isSubsequence(cand.stationIds, k.stationIds));
    if (!covered) kept.push(cand);
  }
  return kept;
}

function dedupeAdjacent(ids: string[]) {
  return ids.filter((id, i) => i === 0 || ids[i - 1] !== id);
}

function isSubsequence(small: string[], big: string[]) {
  let j = 0;
  for (const s of small) {
    while (j < big.length && big[j] !== s) j++;
    if (j >= big.length) return false;
    j++;
  }
  return true;
}

function parseTime(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 60 + m + (s ?? 0) / 60;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

/** Minutter fra hver stasjon til knutepunkt (median over sample-serviceJourneys på linjen). */
function hubMinutesForLine(line: RawLine, hubIds: Map<string, string>) {
  const result = new Map<string, Map<string, number[]>>(); // stationId → hubSlug → samples
  for (const sj of line.sampleServiceJourneys) {
    const times: { station: string; t: number }[] = [];
    let last = -Infinity;
    for (const pt of sj.passingTimes) {
      let t = parseTime(pt.time);
      while (t < last - 1) t += 24 * 60; // over midnatt
      last = t;
      times.push({ station: pt.stationId, t });
    }
    for (const [hubSlug, hubId] of hubIds) {
      const hubIdx = times.findIndex((x) => x.station === hubId);
      if (hubIdx < 0) continue;
      for (let i = 0; i < hubIdx; i++) {
        const st = times[i].station;
        const minutes = times[hubIdx].t - times[i].t;
        if (minutes <= 0 || minutes > 120) continue;
        const m = result.get(st) ?? new Map<string, number[]>();
        m.set(hubSlug, [...(m.get(hubSlug) ?? []), minutes]);
        result.set(st, m);
      }
    }
  }
  return result;
}

/** Minimum antall avganger over sample-datoene for at et mønster regnes som del av nettverket. */
const MIN_ACTIVE_DEPARTURES = 3;

export async function runStations() {
  const raw = readJson<RawLine[]>(work("lines.raw.json"));

  // 1) Stasjonsutkast
  const drafts = new Map<string, StationDraft>();
  const addStop = (q: RawQuay, line: RawLine) => {
    const sp = q.stopPlace;
    if (!sp) return;
    const id = sp.parent?.id ?? sp.id;
    const d =
      drafts.get(id) ??
      ({
        id,
        name: sp.parent?.name ?? sp.name,
        lat: sp.parent?.latitude ?? sp.latitude,
        lon: sp.parent?.longitude ?? sp.longitude,
        modes: new Set<Mode>(),
        lineCodes: new Set<string>(),
        children: new Set<string>(),
      } satisfies StationDraft);
    d.modes.add(line.transportMode);
    d.lineCodes.add(line.publicCode);
    d.children.add(sp.id);
    drafts.set(id, d);
  };
  for (const line of raw) {
    for (const q of line.quays) addStop(q, line);
    for (const p of line.journeyPatterns) for (const q of p.quays) addStop(q, line);
  }

  // 2) Slugs (unike)
  const slugCount = new Map<string, number>();
  const slugs = new Map<string, string>();
  for (const d of [...drafts.values()].sort((a, b) => a.name.localeCompare(b.name, "nb"))) {
    const base = slugify(d.name);
    const n = (slugCount.get(base) ?? 0) + 1;
    slugCount.set(base, n);
    slugs.set(d.id, n === 1 ? base : `${base}-${n}`);
  }
  const hubIds = new Map<string, string>();
  for (const hub of HUBS) {
    const found = [...drafts.values()].find((d) => d.name === hub.name && d.modes.has("metro"));
    if (found) hubIds.set(hub.slug, found.id);
  }

  // 3) Linjer med stoppsekvenser + geometri
  const lines: Line[] = [];
  const features: (LineFeature | StationFeature)[] = [];
  const neighbours = new Map<string, Record<string, StationNeighbour[]>>();
  const hubSamples = new Map<string, Map<string, number[]>>();

  for (const rl of raw) {
    const activePatterns = rl.journeyPatterns.filter((p) => (rl.activePatternCounts[p.id] ?? 0) >= MIN_ACTIVE_DEPARTURES);
    const keptAll = maximalPatterns(activePatterns.length ? activePatterns : rl.journeyPatterns);
    // Antall avganger som dekkes av hvert maksimalt mønster (inkl. kortere mønstre det dekker)
    const coverage = (k: { stationIds: string[] }) =>
      rl.journeyPatterns.reduce((sum, p) => {
        const ids = dedupeAdjacent(p.quays.map(stationIdOf).filter((x): x is string => !!x));
        return sum + (isSubsequence(ids, k.stationIds) ? rl.activePatternCounts[p.id] ?? 0 : 0);
      }, 0);
    const withCov = keptAll.map((k) => ({ ...k, departures: coverage(k) })).sort((a, b) => b.departures - a.departures || b.stationIds.length - a.stationIds.length);
    const maxDep = withCov[0]?.departures ?? 0;
    // Mønstre med under 5 % av hovedmønsterets avganger regnes som unntakskjøringer og tas ikke med i nettverket
    const kept = withCov.filter((k) => k.departures >= Math.max(MIN_ACTIVE_DEPARTURES, maxDep * 0.05));
    const stale = rl.journeyPatterns.length - activePatterns.length;
    if (stale) log("02-stations", `  linje ${rl.publicCode}: ${stale} mønstre uten avganger i perioden ignorert`);
    for (const k of withCov.filter((x) => !kept.includes(x))) log("02-stations", `  linje ${rl.publicCode}: unntakskjøring utelatt (${k.departures} avg.): ${k.pattern.name}`);
    const colour = LINE_COLOURS[rl.publicCode] ?? { colour: rl.transportMode === "metro" ? "#EC700C" : "#28A2F8", text: "#FFFFFF" };
    // Endestasjoner: fra det lengste mønsteret blant dem med minst 10 % av hovedmønsterets avganger
    // (kortkjøringer som Bjørvika/Korsgata og sjeldne forlengelser er ikke endestasjoner)
    const main = [...kept.filter((k) => k.departures >= maxDep * 0.1)].sort((a, b) => b.stationIds.length - a.stationIds.length)[0] ?? kept[0];
    const termini = new Set<string>(main ? [drafts.get(main.stationIds[0])!.name, drafts.get(main.stationIds[main.stationIds.length - 1])!.name] : []);
    const stopSequences: Line["stopSequences"] = [];
    for (const { pattern, stationIds, departures } of kept) {
      const first = drafts.get(stationIds[0])!.name;
      const lastName = drafts.get(stationIds[stationIds.length - 1])!.name;
      void departures;
      stopSequences.push({ directionType: pattern.directionType, name: `${first} – ${lastName}`, stationIds });
      for (let i = 0; i < stationIds.length; i++) {
        const st = stationIds[i];
        const rec = neighbours.get(st) ?? {};
        const arr = rec[rl.publicCode] ?? [];
        const entry: StationNeighbour = { directionType: pattern.directionType, towards: lastName };
        if (i > 0) entry.prev = stationIds[i - 1];
        if (i < stationIds.length - 1) entry.next = stationIds[i + 1];
        // Samme nabopar fra flere mønstre (kortkjøringer) slås sammen; hovedmønsteret (først) bestemmer «mot»
        const same = arr.find((e) => e.prev === entry.prev && e.next === entry.next);
        if (!same) {
          // Kortkjøring som bare er en delmengde (samme retning, endestasjon underveis) legges ikke til
          const coveredByLonger = arr.some((e) => e.directionType === entry.directionType && e.next === entry.next);
          if (!coveredByLonger) arr.push(entry);
        }
        rec[rl.publicCode] = arr;
        neighbours.set(st, rec);
      }
      if (pattern.pointsOnLink?.points) {
        features.push({
          type: "Feature",
          properties: {
            kind: "line",
            lineCode: rl.publicCode,
            lineId: rl.id,
            mode: rl.transportMode,
            colour: colour.colour,
            direction: pattern.directionType,
          },
          geometry: { type: "LineString", coordinates: decodePolyline(pattern.pointsOnLink.points).map(([x, y]) => [round(x), round(y)]) },
        });
      }
    }
    // Hub-minutter fra sample-serviceJourneys
    for (const [st, m] of hubMinutesForLine(rl, hubIds)) {
      const tgt = hubSamples.get(st) ?? new Map<string, number[]>();
      for (const [hub, xs] of m) tgt.set(hub, [...(tgt.get(hub) ?? []), ...xs]);
      hubSamples.set(st, tgt);
    }
    lines.push({
      id: rl.id,
      publicCode: rl.publicCode,
      mode: rl.transportMode,
      colour: colour.colour,
      textOnColour: colour.text,
      termini: [...termini],
      stopSequences,
    });
    log("02-stations", `  linje ${rl.publicCode}: ${kept.length} mønstre – ${kept.map((k) => `${drafts.get(k.stationIds[0])!.name} – ${drafts.get(k.stationIds[k.stationIds.length - 1])!.name} (${k.stationIds.length} stopp, ${k.departures} avg.)`).join("; ")}`);
  }

  // 3b) Linjer og moduser per stasjon skal kun speile stoppsekvensene som faktisk brukes
  for (const d of drafts.values()) {
    d.lineCodes.clear();
    d.modes.clear();
  }
  for (const l of lines) {
    for (const seq of l.stopSequences) {
      for (const id of seq.stationIds) {
        const d = drafts.get(id);
        if (!d) continue;
        d.lineCodes.add(l.publicCode);
        d.modes.add(l.mode);
      }
    }
  }
  for (const [id, d] of [...drafts]) {
    if (!d.lineCodes.size) {
      log("02-stations", `  stasjon uten aktive linjer utelatt: ${d.name}`);
      drafts.delete(id);
    }
  }

  // 4) Linked-stopp (samme normaliserte navn)
  const all = [...drafts.values()];
  const linked = new Map<string, { stationId: string; distanceM: number }[]>();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const dist = haversineM(a.lat, a.lon, b.lat, b.lon);
      const sameName = normaliseName(a.name) === normaliseName(b.name) && dist <= 500;
      if (sameName) {
        linked.set(a.id, [...(linked.get(a.id) ?? []), { stationId: b.id, distanceM: Math.round(dist) }]);
        linked.set(b.id, [...(linked.get(b.id) ?? []), { stationId: a.id, distanceM: Math.round(dist) }]);
        log("02-stations", `  linked: ${a.name} ↔ ${b.name} (${Math.round(dist)} m)`);
      }
    }
  }

  // 5) Indeks + basis
  const index: StationIndex[] = all
    .map((d) => ({
      id: d.id,
      slug: slugs.get(d.id)!,
      name: d.name,
      lat: round(d.lat),
      lon: round(d.lon),
      modes: [...d.modes].sort(),
      lineCodes: [...d.lineCodes].sort((x, y) => Number(x) - Number(y)),
      linked: linked.get(d.id) ?? [],
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const base: Station[] = index.map((s) => {
    const hubMinutes: Record<string, number | null> = {};
    for (const hub of HUBS) {
      const xs = hubSamples.get(s.id)?.get(hub.slug);
      hubMinutes[hub.slug] = hubIds.get(hub.slug) === s.id ? 0 : xs?.length ? Math.round(median(xs)) : null;
    }
    return {
      ...s,
      childStopPlaceIds: [...drafts.get(s.id)!.children].sort(),
      neighbours: neighbours.get(s.id) ?? {},
      hubMinutes,
      transfers: [],
      accessibility: {
        wheelchairAccess: "UNKNOWN",
        stepFreeAccess: "UNKNOWN",
        liftFreeAccess: "UNKNOWN",
        escalatorFreeAccess: "UNKNOWN",
        perChild: [],
      },
      pois: [],
    };
  });

  for (const s of index) {
    features.push({
      type: "Feature",
      properties: { kind: "station", id: s.id, slug: s.slug, name: s.name, modes: s.modes, lineCodes: s.lineCodes },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    });
  }
  const geometry: GeometryCollection = { type: "FeatureCollection", features };

  writeJson(data("lines.json"), lines);
  writeJson(data("stations.index.json"), index);
  writeJson(data("geometry.geojson"), geometry, false);
  writeJson(data("hubs.json"), HUBS.map((h) => ({ ...h, stationId: hubIds.get(h.slug) ?? null })));
  writeJson(work("stations.base.json"), base, false);

  const withHub = base.filter((b) => Object.values(b.hubMinutes).some((v) => v !== null && v > 0)).length;
  log("02-stations", `${index.length} stasjoner (${index.filter((s) => s.modes.length > 1).length} multimodale), ${withHub} med hub-minutter, ${features.length} geometri-features`);
  return { lines, index, base };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runStations().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
