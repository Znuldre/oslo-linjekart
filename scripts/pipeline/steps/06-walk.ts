/**
 * Steg 06: Gangtid/-avstand fra stasjon til hver POI med Entur (directMode: foot).
 * Dropper POI med gangavstand > 1200 m. Fallback: estimat (luftlinje × 1,3, 80 m/min).
 * Skriver .cache/work/pois.final.json (stasjons-id → Poi[]).
 */
import type { Station, Poi } from "../../../src/lib/types.ts";
import { gql } from "../lib/entur.ts";
import { haversineM } from "../lib/geo.ts";
import { readJson, writeJson, work, log } from "../lib/io.ts";

const MAX_WALK_M = 1200; // glidebryteren i grensesnittet går 200–1200 m
const MAX_POI = 16;
/** Samme rangering som i steg 05: poeng minus 1 per 100 m gange. */
const rank = (score: number, distM: number) => score - distM / 100;

const QUERY = /* GraphQL */ `
  query Walk($fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!) {
    trip(
      from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
      to: { coordinates: { latitude: $toLat, longitude: $toLon } }
      modes: { directMode: foot }
      numTripPatterns: 1
      walkSpeed: 1.3
    ) {
      tripPatterns { duration distance legs { pointsOnLink { points } } }
    }
  }
`;

export async function runWalk() {
  const base = readJson<Station[]>(work("stations.base.json"));
  const cands = readJson<Record<string, Omit<Poi, "walk">[]>>(work("pois.candidates.json"));
  const out: Record<string, Poi[]> = {};
  let calls = 0;
  let estimates = 0;
  let dropped = 0;

  await Promise.all(
    base.map(async (s) => {
      const list = cands[s.id] ?? [];
      const withWalk: Poi[] = [];
      for (const p of list) {
        const target = p.access ?? { lat: p.lat, lon: p.lon };
        const air = haversineM(s.lat, s.lon, target.lat, target.lon);
        if (air > MAX_WALK_M * 1.05) {
          dropped++;
          continue; // kan aldri bli ≤ 800 m til fots
        }
        let walk: Poi["walk"] | null = null;
        try {
          calls++;
          const res = await gql<{ trip: { tripPatterns: { duration: number; distance: number; legs: { pointsOnLink: { points: string } | null }[] }[] } }>(
            QUERY,
            { fromLat: s.lat, fromLon: s.lon, toLat: target.lat, toLon: target.lon },
            { label: `walk ${s.slug} → ${p.name.nb}`, ttl: 90 * 24 * 3600 * 1000 },
          );
          const tp = res.trip.tripPatterns[0];
          if (tp) walk = { durationS: Math.round(tp.duration), distanceM: Math.round(tp.distance), polyline: tp.legs[0]?.pointsOnLink?.points, source: "entur-foot" };
        } catch {
          /* fallback under */
        }
        if (!walk) {
          estimates++;
          const dist = Math.round(air * 1.3);
          walk = { durationS: Math.round((dist / 80) * 60), distanceM: dist, source: "estimate" };
        }
        if (walk.distanceM > MAX_WALK_M) {
          dropped++;
          continue;
        }
        withWalk.push({ ...p, walk });
      }
      // Kuraterte landemerker først (etter prioritet), deretter nivå A/B/C etter poeng og avstand
      const tierRank = { A: 0, B: 1, C: 2 } as const;
      out[s.id] = withWalk
        .sort((a, b) => rank(b.score, b.walk.distanceM) - rank(a.score, a.walk.distanceM) || tierRank[a.tier ?? "A"] - tierRank[b.tier ?? "A"] || a.walk.distanceM - b.walk.distanceM)
        .slice(0, MAX_POI);
    }),
  );

  writeJson(work("pois.final.json"), out, false);
  const total = Object.values(out).reduce((a, l) => a + l.length, 0);
  log("06-walk", `${calls} gangruter beregnet (${estimates} estimater), ${dropped} POI utenfor ${MAX_WALK_M} m fjernet, ${total} POI igjen på ${Object.values(out).filter((l) => l.length).length} stasjoner`);
  return out;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runWalk().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
