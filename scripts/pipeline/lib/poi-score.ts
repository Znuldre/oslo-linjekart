import type { PoiCategory } from "../../../src/lib/types.ts";

export type OsmTags = Record<string, string>;
export type PoiTier = "A" | "B" | "C";

export interface OsmBounds {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: OsmBounds;
  tags?: OsmTags;
}

/**
 * Overpass-spørringer: kandidater til severdigheter i en bbox (sør,vest,nord,øst). `out bb` gir avgrensningsboks for
 * veier/relasjoner (Overpass tillater bare én geometrimodus, så senterpunkt beregnes fra boksen).
 * Delt i flere lette spørringer for å unngå tidsavbrudd på offentlige speil.
 */
export function elementPosition(e: OsmElement): { lat: number; lon: number } | null {
  if (e.lat !== undefined && e.lon !== undefined) return { lat: e.lat, lon: e.lon };
  if (e.center) return { lat: e.center.lat, lon: e.center.lon };
  if (e.bounds) return { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 };
  return null;
}
export function overpassQueries(bbox: [number, number, number, number]): string[] {
  const b = bbox.join(",");
  const head = `[out:json][timeout:120];`;
  return [
    `${head}
(
  nwr["tourism"~"^(museum|attraction|gallery|zoo|theme_park|viewpoint|aquarium)$"]["name"](${b});
  nwr["historic"~"^(castle|palace|fort|fortress|ruins|city_gate|manor|archaeological_site|church)$"]["name"](${b});
  nwr["building"~"^(cathedral|palace|castle)$"]["name"](${b});
  nwr["man_made"~"^(tower|lighthouse|ski_jump)$"]["name"](${b});
  nwr["natural"~"^(peak|beach)$"]["name"](${b});
  nwr["amenity"~"^(theatre|arts_centre|planetarium|concert_hall|marketplace)$"]["name"](${b});
);
out bb tags;`,
    `${head}
(
  nwr["leisure"~"^(park|garden|nature_reserve|stadium|swimming_area|beach_resort)$"]["name"](${b});
  nwr["natural"="water"]["name"]["wikidata"](${b});
);
out bb tags;`,
    `${head}
(
  nwr["amenity"="place_of_worship"]["name"]["wikidata"](${b});
  nwr["amenity"="place_of_worship"]["name"]["wikipedia"](${b});
);
out bb tags;`,
  ];
}

export function categorise(t: OsmTags): PoiCategory {
  if (t.tourism === "museum") return "museum";
  if (t.tourism === "gallery") return "gallery";
  if (t.tourism === "zoo" || t.tourism === "aquarium" || t.tourism === "theme_park") return "zoo";
  if (t.tourism === "viewpoint" || t.natural === "peak" || t.man_made === "tower") return "viewpoint";
  if (t.amenity === "theatre" || t.amenity === "arts_centre" || t.amenity === "concert_hall") return "theatre";
  if (t.amenity === "place_of_worship" || t.historic === "church" || t.building === "cathedral") return "church";
  if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "nature_reserve" || t.natural === "beach" || t.natural === "water" || t.leisure === "swimming_area" || t.leisure === "beach_resort") return "park";
  if (t.tourism === "attraction" || t.historic || t.building === "palace" || t.building === "castle" || t.man_made || t.leisure === "stadium" || t.amenity === "marketplace") return "attraction";
  return "other";
}

/** Nivå A = severdighet i seg selv, B = park/natur, C = kirke (vises bare når det er lite annet). */
export function tierOf(t: OsmTags): PoiTier | null {
  if (t.tourism && /^(museum|attraction|gallery|zoo|theme_park|viewpoint|aquarium)$/.test(t.tourism)) return "A";
  if (t.historic && /^(castle|palace|fort|fortress|ruins|city_gate|manor|archaeological_site)$/.test(t.historic)) return "A";
  if (t.building === "palace" || t.building === "castle" || t.building === "cathedral") return "A";
  if (t.amenity && /^(theatre|arts_centre|concert_hall|planetarium|marketplace)$/.test(t.amenity)) return "A";
  if (t.man_made === "tower" || t.man_made === "ski_jump" || t.natural === "peak") return "A";
  if (t.leisure === "stadium") return "A";
  if (t.leisure && /^(park|garden|nature_reserve|swimming_area|beach_resort)$/.test(t.leisure)) return "B";
  if (t.natural === "beach" || t.natural === "water") return "B";
  if (t.amenity === "place_of_worship" || t.historic === "church") return "C";
  return null;
}

/** Poengsum innen nivået: hvor kjent/dokumentert stedet er. Kategori-basis dominerer (A 8, B 5, C 3). */
export function baseScore(t: OsmTags): number {
  const tier = tierOf(t);
  let s = tier === "A" ? 8 : tier === "B" ? 5 : tier === "C" ? 3 : 0;
  if (t.wikipedia || t["wikipedia:no"] || t["wikipedia:en"]) s += 2;
  if (t.wikidata) s += 1;
  if (t.image || t.wikimedia_commons) s += 0.5;
  if (t["name:en"]) s += 0.5;
  if (t.heritage) s += 1;
  if (t.tourism === "attraction" || t.tourism === "museum") s += 1;
  if (t.leisure === "nature_reserve") s += 1;
  return s;
}

const SMALL_SQUARE = /\b(plass|plassen|løkka|løkken|hagen|have|haven|park|parken)$/i;

export function isExcluded(t: OsmTags, bounds?: OsmBounds): boolean {
  if (!t.name) return true;
  if (tierOf(t) === null) return true;
  // Overnatting, informasjon, små minnesmerker og kunstverk: ikke severdigheter i denne sammenhengen
  if (t.tourism === "information" || t.tourism === "hotel" || t.tourism === "hostel" || t.tourism === "apartment" || t.tourism === "guest_house") return true;
  if (t.tourism === "artwork" || t.historic === "memorial" || t.historic === "monument") return true;
  if (t.access === "private" || t.disused || t.abandoned || t["disused:tourism"]) return true;
  // Kirker må være dokumentert (Wikipedia eller Wikidata)
  if ((t.amenity === "place_of_worship" || t.historic === "church") && !t.wikipedia && !t.wikidata) return true;
  // Parker/plasser: må være dokumentert og ha utstrekning (punkt-noder er typisk små plasser)
  if (t.leisure === "park" || t.leisure === "garden") {
    if (!t.wikipedia && !t.wikidata) return true;
    if (!bounds) return true; // node uten utstrekning
    if (boundsDiagonalM(bounds) < 150) return true; // for lite til å være et mål i seg selv
    if (/plass(en)?$/i.test(t.name) && boundsDiagonalM(bounds) < 220) return true;
  }
  // Innsjøer og dammer: kun store nok til å være turmål
  if (t.natural === "water") {
    if (!bounds || boundsDiagonalM(bounds) < 350) return true;
    if (t.water && !/^(lake|reservoir)$/.test(t.water)) return true;
  }
  if (t.natural === "peak" && !t.wikidata && !t.wikipedia) return true;
  if (t.tourism === "viewpoint" && !t.wikidata && !t.wikipedia && !t.name) return true;
  if (t.leisure === "stadium" && !t.wikipedia && !t.wikidata) return true;
  if (t.amenity === "theatre" && !t.wikipedia && !t.wikidata) return true;
  return false;
}

export function boundsDiagonalM(b: OsmBounds) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.maxlat - b.minlat);
  const dLon = toRad(b.maxlon - b.minlon) * Math.cos(toRad((b.minlat + b.maxlat) / 2));
  return R * Math.hypot(dLat, dLon);
}

/** Nærmeste punkt i avgrensningsboksen sett fra (lat, lon) – brukes som gangmål for store områder. */
export function nearestPointInBounds(b: OsmBounds, lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.min(b.maxlat, Math.max(b.minlat, lat)), lon: Math.min(b.maxlon, Math.max(b.minlon, lon)) };
}

export { SMALL_SQUARE };
