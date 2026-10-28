/**
 * Steg 05: Severdigheter per stasjon.
 *  1. Én Overpass bbox-spørring for Oslo-området (med avgrensningsbokser).
 *  2. Kuraterte landemerker (content/pois/landmarks.json) kobles til OSM-elementer eller Wikipedia-koordinater.
 *  3. OSM-kandidater filtreres i tre nivåer (A severdighet, B park/natur, C kirke), støy og deler av større
 *     attraksjoner fjernes (content/pois/osm-exclude.json).
 *  4. Tilordning til stasjoner innen 1 400 m luftlinje til nærmeste kant; nivåbasert utvalg per stasjon.
 *  5. Berikelse fra Wikipedia/Wikidata (utdrag, bilde, engelsk navn). Overstyringer per stopp i content/poi-overrides/.
 * Skriver .cache/work/pois.candidates.json (stasjons-id → Poi uten gangtid). Steg 06 beregner gangtid til `access`.
 */
import { existsSync } from "node:fs";
import type { Station, Poi, PoiOverride, L10n, Landmark, PoiCategory } from "../../../src/lib/types.ts";
import { fetchJson, Limiter, TTL } from "../lib/http.ts";
import { haversineM, round } from "../lib/geo.ts";
import { readJson, readJsonIfExists, writeJson, work, content, listJson, log } from "../lib/io.ts";
import { overpassQueries, elementPosition, categorise, baseScore, isExcluded, tierOf, nearestPointInBounds, boundsDiagonalM, type OsmElement, type PoiTier } from "../lib/poi-score.ts";

const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const overpassLimiter = new Limiter(1, 2000);
const wikiLimiter = new Limiter(3, 120);

const RADIUS_M = 1400; // luftlinje til nærmeste kant; steg 06 krever ≤ 1200 m gange
const MAX_PER_STATION = 24;
const TIER_LIMITS = { A: 14, B: 4, C: 2 };
const LANDMARK_SCORE = 20;
/** Rangering per stasjon: poeng minus 1 per 100 m, så et nært lokalt mål kan slå et fjernere hovedlandemerke. */
export const rank = (score: number, distM: number) => score - distM / 100;

type Candidate = Omit<Poi, "walk"> & { tier: PoiTier; osmKey?: string; nameKey: string };

interface WikiSummary {
  title: string;
  extract?: string;
  thumbnail?: { source: string; width: number; height: number };
  coordinates?: { lat: number; lon: number };
  type?: string;
}

interface WikidataEntity {
  entities: Record<
    string,
    {
      labels?: Record<string, { value: string }>;
      sitelinks?: Record<string, { title: string }>;
      claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
    }
  >;
}

async function overpassOne(q: string) {
  let lastErr: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      return await fetchJson<{ elements: OsmElement[] }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        ttl: TTL.overpass,
        limiter: overpassLimiter,
        retries: 2,
        label: `overpass ${url}`,
      });
    } catch (e) {
      lastErr = e;
      log("05-pois", `  Overpass feilet på ${url}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  throw lastErr;
}

/** Kjører delspørringene og slår sammen elementene (dedupliseres på type/id). */
async function overpass(bbox: [number, number, number, number]) {
  const merged = new Map<string, OsmElement>();
  for (const q of overpassQueries(bbox)) {
    const res = await overpassOne(q);
    for (const e of res.elements) merged.set(`${e.type}/${e.id}`, e);
    log("05-pois", `  delspørring: ${res.elements.length} elementer`);
  }
  return { elements: [...merged.values()] };
}

async function wikiSummary(lang: "no" | "en", title: string): Promise<WikiSummary | null> {
  try {
    const s = await fetchJson<WikiSummary>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, {
      ttl: TTL.wikimedia,
      limiter: wikiLimiter,
      retries: 1,
      label: `wiki ${lang}:${title}`,
    });
    if (s?.type === "disambiguation") return null;
    if (s?.extract) return s;
  } catch {
    /* fall tilbake til action-API under */
  }
  // REST-summary svarer «Internal error» for enkelte artikler (ofte omdirigeringer) – bruk action-API som reserve
  try {
    const params = new URLSearchParams({
      action: "query",
      prop: "extracts|pageimages|coordinates",
      exintro: "1",
      explaintext: "1",
      redirects: "1",
      piprop: "thumbnail",
      pithumbsize: "640",
      titles: title,
      format: "json",
      formatversion: "2",
    });
    const r = await fetchJson<{ query?: { pages?: { title: string; missing?: boolean; extract?: string; thumbnail?: { source: string; width: number; height: number }; coordinates?: { lat: number; lon: number }[] }[] } }>(
      `https://${lang}.wikipedia.org/w/api.php?${params}`,
      { ttl: TTL.wikimedia, limiter: wikiLimiter, retries: 1, label: `wiki-api ${lang}:${title}` },
    );
    const page = r.query?.pages?.[0];
    if (!page || page.missing || !page.extract) return null;
    if (/kan (vise|referere) til|may refer to/i.test(page.extract.slice(0, 200))) return null; // flertydig side
    const extract = page.extract.split("\n")[0].trim();
    return { title: page.title, extract, thumbnail: page.thumbnail, coordinates: page.coordinates?.[0], type: "standard" };
  } catch {
    return null;
  }
}

async function wikidata(q: string) {
  try {
    const d = await fetchJson<WikidataEntity>(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`, { ttl: TTL.wikimedia, limiter: wikiLimiter, retries: 2, label: `wikidata ${q}` });
    return d.entities[q] ?? null;
  } catch {
    return null;
  }
}

const commonsThumb = (file: string, width = 640) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/, "").replace(/ /g, "_"))}?width=${width}`;
const nameKey = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-zæøå0-9]+/g, " ").trim();

/** Beriker en kandidat med Wikipedia-utdrag, bilde og engelsk navn (muterer). */
async function enrich(c: Candidate, tags: Record<string, string> | undefined, forcedWikipedia?: { nb?: string; en?: string }) {
  let nbTitle = forcedWikipedia?.nb;
  let enTitle = forcedWikipedia?.en;
  if (tags) {
    if (tags.wikipedia) {
      const [l, ...rest] = tags.wikipedia.split(":");
      const title = rest.join(":");
      if ((l === "no" || l === "nb") && !nbTitle) nbTitle = title;
      else if (l === "en" && !enTitle) enTitle = title;
    }
    if (tags["wikipedia:en"] && !enTitle) enTitle = tags["wikipedia:en"].replace(/^en:/, "");
    if (tags["wikipedia:no"] && !nbTitle) nbTitle = tags["wikipedia:no"].replace(/^no:/, "");
    if (tags.wikidata) c.wikidata = tags.wikidata;
    if (tags.website || tags["contact:website"]) c.website ??= tags.website ?? tags["contact:website"];
  }
  let wdImage: string | undefined;
  if (c.wikidata && (!nbTitle || !enTitle || !c.name.en)) {
    const e = await wikidata(c.wikidata);
    if (e) {
      nbTitle ??= e.sitelinks?.nowiki?.title ?? e.sitelinks?.nbwiki?.title;
      enTitle ??= e.sitelinks?.enwiki?.title;
      if (!c.name.en && e.labels?.en?.value && e.labels.en.value !== c.name.nb) c.name.en = e.labels.en.value;
      const p18 = e.claims?.P18?.[0]?.mainsnak.datavalue?.value;
      if (typeof p18 === "string") wdImage = p18;
    }
  }
  const [nb, en] = await Promise.all([nbTitle ? wikiSummary("no", nbTitle) : null, enTitle ? wikiSummary("en", enTitle) : null]);
  if (nb || en) c.wikipedia = { nb: nb?.title ?? nbTitle, en: en?.title ?? enTitle };
  // Sammendrag per språk; UI faller tilbake til det andre språket når ett mangler
  if (!c.summary && (nb?.extract || en?.extract)) c.summary = { nb: nb?.extract ?? "", en: en?.extract };
  if (!c.image) {
    const thumb = nb?.thumbnail?.source ?? en?.thumbnail?.source;
    if (thumb) c.image = { url: thumb.replace(/\/\d+px-/, "/640px-"), attribution: "Wikimedia Commons" };
    else if (wdImage) c.image = { url: commonsThumb(wdImage), attribution: "Wikimedia Commons" };
    else if (tags?.image && /^https?:\/\/(upload|commons)\.wikimedia\.org/.test(tags.image)) c.image = { url: tags.image, attribution: "Wikimedia Commons" };
  }
  if (!c.name.en && en?.title && en.title !== c.name.nb) c.name.en = en.title;
  return { nb, en };
}

export async function runPois() {
  const base = readJson<Station[]>(work("stations.base.json"));
  const exclude = readJsonIfExists<{ ids?: string[]; names?: string[] }>(content("pois", "osm-exclude.json")) ?? {};
  const excludeIds = new Set(exclude.ids ?? []);
  const excludeNames = new Set((exclude.names ?? []).map(nameKey));
  const landmarks = readJsonIfExists<{ landmarks: Landmark[] }>(content("pois", "landmarks.json"))?.landmarks ?? [];

  // 1) Overpass
  const lats = base.map((s) => s.lat);
  const lons = base.map((s) => s.lon);
  const pad = 0.014;
  const bbox: [number, number, number, number] = [Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad];
  const { elements } = await overpass(bbox);
  log("05-pois", `${elements.length} OSM-elementer i bbox`);
  const byOsmId = new Map(elements.map((e) => [`${e.type}/${e.id}`, e]));
  const byOsmName = new Map<string, OsmElement[]>();
  for (const e of elements) {
    const n = e.tags?.name;
    if (n) byOsmName.set(n, [...(byOsmName.get(n) ?? []), e]);
  }
  const elPos = (e: OsmElement) => {
    const p = elementPosition(e);
    return { lat: p?.lat, lon: p?.lon };
  };

  // 2) Kuraterte landemerker → kandidater med LANDMARK_SCORE
  const landmarkCands: Candidate[] = [];
  const landmarkOsmKeys = new Set<string>();
  const landmarkNameKeys = new Set<string>();
  for (const lm of landmarks) {
    let el: OsmElement | undefined;
    if (lm.osm) el = byOsmId.get(lm.osm);
    if (!el && lm.osmName) {
      const list = (byOsmName.get(lm.osmName) ?? []).filter((e) => e.bounds).sort((a, b) => boundsDiagonalM(b.bounds!) - boundsDiagonalM(a.bounds!));
      el = list[0] ?? byOsmName.get(lm.osmName)?.[0];
    }
    if (lm.osm && !el) log("05-pois", `  landemerke ${lm.id}: OSM ${lm.osm} ikke funnet i uttrekket – bruker Wikipedia`);
    const c: Candidate = {
      id: `curated:${lm.id}`,
      name: { ...lm.name },
      category: lm.category,
      lat: lm.lat ?? NaN,
      lon: lm.lon ?? NaN,
      score: LANDMARK_SCORE + lm.priority,
      tier: "A",
      priority: lm.priority,
      source: "curated",
      nameKey: nameKey(lm.name.nb),
      wikidata: lm.wikidata,
      website: lm.website,
    };
    if (el) {
      const p = elPos(el);
      if (p.lat !== undefined && p.lon !== undefined) {
        c.lat = p.lat;
        c.lon = p.lon;
      }
      c.osmKey = `${el.type}/${el.id}`;
      landmarkOsmKeys.add(c.osmKey);
      if (el.bounds) (c as Candidate & { bounds?: OsmElement["bounds"] }).bounds = el.bounds;
    }
    const { nb, en } = await enrich(c, el?.tags, lm.wikipedia);
    // Håndskrevet sammendrag: brukes når Wikipedia mangler, eller alltid når `summaryWins` er satt (f.eks. omdirigeringer)
    if (lm.summary && (!c.summary || lm.summaryWins)) c.summary = lm.summary;
    if (Number.isNaN(c.lat)) {
      const coord = nb?.coordinates ?? en?.coordinates;
      if (coord) {
        c.lat = coord.lat;
        c.lon = coord.lon;
      } else {
        log("05-pois", `  landemerke ${lm.id}: fant ingen koordinater (verken OSM eller Wikipedia) – utelatt`);
        continue;
      }
    }
    if (lm.access) c.access = lm.access;
    c.lat = round(c.lat);
    c.lon = round(c.lon);
    landmarkNameKeys.add(c.nameKey);
    landmarkCands.push(c);
  }
  log("05-pois", `${landmarkCands.length}/${landmarks.length} landemerker plassert (${landmarkCands.filter((c) => c.image).length} med bilde)`);

  // 3) OSM-kandidater
  const osmCands: (Candidate & { bounds?: OsmElement["bounds"]; tags: Record<string, string> })[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const key = `${el.type}/${el.id}`;
    if (landmarkOsmKeys.has(key)) continue; // representert av landemerket
    if (excludeIds.has(`osm:${key}`) || excludeNames.has(nameKey(t.name ?? ""))) continue;
    if (isExcluded(t, el.bounds)) continue;
    if (landmarkNameKeys.has(nameKey(t.name))) continue; // samme navn som et landemerke
    const p = elPos(el);
    if (p.lat === undefined || p.lon === undefined) continue;
    const tier = tierOf(t)!;
    const name: L10n = { nb: t["name:nb"] ?? t["name:no"] ?? t.name };
    if (t["name:en"] && t["name:en"] !== name.nb) name.en = t["name:en"];
    osmCands.push({
      id: `osm:${key}`,
      name,
      category: categorise(t),
      lat: round(p.lat),
      lon: round(p.lon),
      score: baseScore(t),
      tier,
      source: "osm",
      nameKey: nameKey(t.name),
      osmKey: key,
      bounds: el.bounds,
      tags: t,
    });
  }
  // Samme sted er ofte kartlagt både som punkt og område (f.eks. kirke = node med tourism=attraction + bygning med
  // wikidata). Slå sammen på navn innen 300 m: behold det best dokumenterte elementet, men høyeste poeng og «beste» nivå.
  const docScore = (c: (typeof osmCands)[number]) => (c.tags.wikipedia ? 4 : 0) + (c.tags.wikidata ? 2 : 0) + (c.tags.image ? 1 : 0) + (c.bounds ? 0.5 : 0);
  const groups = new Map<string, (typeof osmCands)[number][]>();
  for (const c of osmCands) groups.set(c.nameKey, [...(groups.get(c.nameKey) ?? []), c]);
  const deduped: typeof osmCands = [];
  for (const list of groups.values()) {
    const remaining = [...list];
    while (remaining.length) {
      const seed = remaining.shift()!;
      const cluster = [seed, ...remaining.filter((c) => haversineM(seed.lat, seed.lon, c.lat, c.lon) < 300)];
      for (const c of cluster) if (c !== seed) remaining.splice(remaining.indexOf(c), 1);
      const best = [...cluster].sort((a, b) => docScore(b) - docScore(a) || b.score - a.score)[0];
      best.score = Math.max(...cluster.map((c) => c.score));
      if (cluster.some((c) => c.tier === "A")) best.tier = "A";
      if (!best.bounds) best.bounds = cluster.find((c) => c.bounds)?.bounds;
      deduped.push(best);
    }
  }
  osmCands.length = 0;
  osmCands.push(...deduped);
  log("05-pois", `${osmCands.length} OSM-kandidater etter filtrering og sammenslåing (A ${osmCands.filter((c) => c.tier === "A").length}, B ${osmCands.filter((c) => c.tier === "B").length}, C ${osmCands.filter((c) => c.tier === "C").length})`);

  // 4) Tilordning per stasjon: avstand til nærmeste kant, nivåbasert utvalg
  type Assigned = { cand: Candidate & { bounds?: OsmElement["bounds"] }; access: { lat: number; lon: number }; dist: number };
  const perStation = new Map<string, Assigned[]>();
  const all: (Candidate & { bounds?: OsmElement["bounds"] })[] = [...landmarkCands, ...osmCands];
  for (const s of base) {
    const near: Assigned[] = [];
    for (const c of all) {
      const access = c.access ?? (c.bounds && boundsDiagonalM(c.bounds) > 150 ? nearestPointInBounds(c.bounds, s.lat, s.lon) : { lat: c.lat, lon: c.lon });
      const dist = haversineM(s.lat, s.lon, access.lat, access.lon);
      if (dist <= RADIUS_M) near.push({ cand: c, access, dist });
    }
    near.sort((a, b) => rank(b.cand.score, b.dist) - rank(a.cand.score, a.dist) || a.dist - b.dist);
    // Dedupliser på navn (landemerke + OSM-element for samme sted)
    const seen = new Set<string>();
    const picked: Assigned[] = [];
    const counts = { A: 0, B: 0, C: 0 };
    for (const x of near) {
      if (seen.has(x.cand.nameKey)) continue;
      const tier = x.cand.tier;
      if (counts[tier] >= TIER_LIMITS[tier]) continue;
      seen.add(x.cand.nameKey);
      picked.push(x);
      counts[tier]++;
      if (picked.length >= MAX_PER_STATION) break;
    }
    perStation.set(s.id, picked);
  }

  // 5) Berikelse av OSM-kandidater som faktisk brukes
  const used = new Map<string, Candidate & { tags?: Record<string, string> }>();
  for (const list of perStation.values()) for (const { cand } of list) if (cand.source === "osm") used.set(cand.id, cand as Candidate & { tags?: Record<string, string> });
  log("05-pois", `${used.size} unike OSM-POI å berike`);
  let i = 0;
  await Promise.all(
    [...used.values()].map(async (c) => {
      await enrich(c, c.tags);
      if (c.wikipedia) c.score += 1;
      if (c.image) c.score += 1;
      if (++i % 100 === 0) log("05-pois", `  beriket ${i}/${used.size}`);
    }),
  );

  // 6) Endelig kandidatliste per stasjon + overstyringer
  const out: Record<string, Omit<Poi, "walk">[]> = {};
  const strip = (c: Candidate, access: { lat: number; lon: number }): Omit<Poi, "walk"> => {
    const { nameKey: _n, osmKey: _o, ...rest } = c as Candidate & { tags?: unknown; bounds?: unknown };
    void _n;
    void _o;
    delete (rest as { tags?: unknown }).tags;
    delete (rest as { bounds?: unknown }).bounds;
    const poi: Omit<Poi, "walk"> = { ...rest, category: rest.category as PoiCategory };
    if (Math.abs(access.lat - c.lat) > 1e-6 || Math.abs(access.lon - c.lon) > 1e-6) poi.access = { lat: round(access.lat), lon: round(access.lon) };
    return poi;
  };
  for (const s of base) {
    let list = (perStation.get(s.id) ?? [])
      // OSM-elementer: nivå A må ha bilde eller Wikipedia, nivå B og C må ha Wikipedia-omtale (bilde er en bonus)
      .filter(({ cand }) => cand.source === "curated" || (cand.tier === "A" ? cand.image || cand.wikipedia : cand.wikipedia && cand.summary))
      .map(({ cand, access, dist }) => ({ poi: strip(cand, access), dist }))
      .sort((a, b) => rank(b.poi.score, b.dist) - rank(a.poi.score, a.dist))
      .map((x) => x.poi);
    // Kirker vises bare når stasjonen har få andre severdigheter
    const others = list.filter((p) => p.tier !== "C").length;
    if (others >= 5) list = list.filter((p) => p.tier !== "C");
    const ovPath = content("poi-overrides", `${s.slug}.json`);
    const ov = existsSync(ovPath) ? readJsonIfExists<PoiOverride>(ovPath) : null;
    if (ov) {
      if (ov.remove?.length) list = list.filter((p) => !ov.remove!.includes(p.id));
      if (ov.patch) list = list.map((p) => (ov.patch![p.id] ? ({ ...p, ...ov.patch![p.id] } as typeof p) : p));
      if (ov.add?.length) for (const a of ov.add) list.push({ ...a, source: "curated", score: a.score ?? LANDMARK_SCORE });
      if (ov.pin?.length) list.sort((a, b) => Number(ov.pin!.includes(b.id)) - Number(ov.pin!.includes(a.id)) || b.score - a.score);
    }
    out[s.id] = list;
  }
  writeJson(work("pois.candidates.json"), out, false);
  const counts = Object.values(out).map((l) => l.length);
  log("05-pois", `${counts.reduce((a, b) => a + b, 0)} POI-kandidater, ${counts.filter((c) => c > 0).length}/${base.length} stasjoner, overstyringer: ${listJson(content("poi-overrides")).length}`);
  return out;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runPois().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
