"use client";
/** Nettleser-klient for Entur (Journey Planner v3, Geocoder v3, Mobility v2). CORS er åpent. */

export const ET_CLIENT_NAME = process.env.NEXT_PUBLIC_ET_CLIENT_NAME || "kehus-linjekart";
const JP_URL = "https://api.entur.io/journey-planner/v3/graphql";
const MOBILITY_URL = "https://api.entur.io/mobility/v2/graphql";
const GEOCODER_URL = "https://api.entur.io/geocoder/v3/autocomplete";

async function graphql<T>(url: string, query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": ET_CLIENT_NAME },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!res.ok) throw new Error(`Entur svarte ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Tomt svar fra Entur");
  return json.data;
}

export const jp = <T>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal) => graphql<T>(JP_URL, query, variables, signal);
export const mobility = <T>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal) => graphql<T>(MOBILITY_URL, query, variables, signal);

/* ---------- Typer ---------- */

export type Severity = "noImpact" | "normal" | "slight" | "severe" | "verySevere" | "undefined" | "unknown" | "verySlight";

export interface Situation {
  id: string;
  severity: Severity;
  summary: { value: string; language: string | null }[];
  description: { value: string; language: string | null }[];
  validityPeriod: { startTime: string | null; endTime: string | null } | null;
  infoLinks: { uri: string; label: string | null }[] | null;
  affects?: { lines: { publicCode: string }[] };
}

export interface LineStatus {
  id: string;
  publicCode: string;
  situations: Situation[];
}

export interface EstimatedCall {
  realtime: boolean;
  cancellation: boolean;
  aimedDepartureTime: string;
  expectedDepartureTime: string;
  destinationDisplay: { frontText: string };
  quay: { id: string; publicCode: string | null; name: string };
  serviceJourney: { id: string; line: { id: string; publicCode: string; transportMode: string } };
  situations: Situation[];
}

export const SITUATION_FIELDS = `
  id
  severity
  summary { value language }
  description { value language }
  validityPeriod { startTime endTime }
  infoLinks { uri label }
`;

/* ---------- Spørringer ---------- */

export async function fetchLineStatus(lineIds: string[], signal?: AbortSignal): Promise<LineStatus[]> {
  const q = `query LineStatus($ids: [ID]) { lines(ids: $ids) { id publicCode situations { ${SITUATION_FIELDS} } } }`;
  const d = await jp<{ lines: LineStatus[] }>(q, { ids: lineIds }, signal);
  return d.lines;
}

export interface StopLive {
  situations: Situation[];
  estimatedCalls: EstimatedCall[];
}

export async function fetchStopLive(stopPlaceId: string, numberOfDepartures = 12, signal?: AbortSignal): Promise<StopLive> {
  const q = `query StopLive($id: String!, $n: Int!) {
    stopPlace(id: $id) {
      situations { ${SITUATION_FIELDS} }
      estimatedCalls(numberOfDepartures: $n, timeRange: 10800, whiteListedModes: [metro, tram], arrivalDeparture: departures) {
        realtime
        cancellation
        aimedDepartureTime
        expectedDepartureTime
        destinationDisplay { frontText }
        quay { id publicCode name }
        serviceJourney { id line { id publicCode transportMode } }
        situations { ${SITUATION_FIELDS} }
      }
    }
  }`;
  const d = await jp<{ stopPlace: StopLive | null }>(q, { id: stopPlaceId, n: numberOfDepartures }, signal);
  return d.stopPlace ?? { situations: [], estimatedCalls: [] };
}

export interface TripLeg {
  mode: string;
  distance: number;
  duration: number;
  expectedStartTime: string;
  expectedEndTime: string;
  fromPlace: { name: string; quay: { id: string; publicCode: string | null } | null };
  toPlace: { name: string; quay: { id: string; publicCode: string | null } | null };
  line: { id: string; publicCode: string; transportMode: string; name: string } | null;
  toEstimatedCall: { destinationDisplay: { frontText: string } } | null;
  fromEstimatedCall: { destinationDisplay: { frontText: string } } | null;
  intermediateEstimatedCalls: { quay: { name: string } }[];
}

export interface TripPattern {
  duration: number;
  walkDistance: number;
  expectedStartTime: string;
  expectedEndTime: string;
  legs: TripLeg[];
}

export interface TripTo {
  name: string;
  place?: string; // NSR-id
  coordinates?: { latitude: number; longitude: number };
}

export async function fetchTrip(fromPlaceId: string, to: TripTo, signal?: AbortSignal): Promise<TripPattern[]> {
  const q = `query Trip($from: Location!, $to: Location!) {
    trip(from: $from, to: $to, numTripPatterns: 5, walkSpeed: 1.3) {
      tripPatterns {
        duration walkDistance expectedStartTime expectedEndTime
        legs {
          mode distance duration expectedStartTime expectedEndTime
          fromPlace { name quay { id publicCode } }
          toPlace { name quay { id publicCode } }
          line { id publicCode transportMode name }
          fromEstimatedCall { destinationDisplay { frontText } }
          toEstimatedCall { destinationDisplay { frontText } }
          intermediateEstimatedCalls { quay { name } }
        }
      }
    }
  }`;
  const toLoc = to.place ? { place: to.place, name: to.name } : { coordinates: to.coordinates, name: to.name };
  const d = await jp<{ trip: { tripPatterns: TripPattern[] } }>(q, { from: { place: fromPlaceId }, to: toLoc }, signal);
  return d.trip.tripPatterns;
}

/** Normalisert treff fra Entur Geocoder v3 (layers: stopPlace, address, poi, groupOfStopPlaces). */
export interface GeocoderFeature {
  id: string;
  name: string; // kort navn
  label: string; // navn med sted, f.eks. «Jernbanetorget, Oslo»
  layer: "stopPlace" | "address" | "poi" | "groupOfStopPlaces" | string;
  categories: string[];
  locality?: string;
  lat: number;
  lon: number;
}

interface GeocoderV3Feature {
  geometry: { coordinates: [number, number] };
  properties: {
    id: string;
    layer: string;
    names?: { default?: string; display?: string };
    categories?: string[];
    address?: { locality?: string; streetName?: string };
  };
}

export async function geocode(text: string, focus: { lat: number; lon: number }, lang: string, signal?: AbortSignal): Promise<GeocoderFeature[]> {
  const params = new URLSearchParams({
    q: text,
    lat: String(focus.lat),
    lon: String(focus.lon),
    radius: "40", // km – hold treffene rundt Oslo-området
    limit: "8",
    lang: lang === "nb" ? "no" : "en",
    layers: "stopPlace,address,poi",
  });
  const res = await fetch(`${GEOCODER_URL}?${params}`, { headers: { "ET-Client-Name": ET_CLIENT_NAME }, signal });
  if (!res.ok) throw new Error(`Geocoder svarte ${res.status}`);
  const json = (await res.json()) as { features?: GeocoderV3Feature[] };
  return (json.features ?? []).map((f) => ({
    id: f.properties.id,
    name: f.properties.names?.default ?? f.properties.names?.display ?? f.properties.id,
    label: f.properties.names?.display ?? f.properties.names?.default ?? f.properties.id,
    layer: f.properties.layer,
    categories: f.properties.categories ?? [],
    locality: f.properties.address?.locality,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

export interface MobilitySnapshot {
  scooters: { operator: string; count: number; nearestM: number }[];
  bikeStations: { name: string; bikes: number; docks: number; distanceM: number; operator: string }[];
}

export async function fetchMobility(lat: number, lon: number, signal?: AbortSignal): Promise<MobilitySnapshot> {
  const q = `query Mobility($lat: Float!, $lon: Float!) {
    vehicles(lat: $lat, lon: $lon, range: 300, formFactors: [SCOOTER, SCOOTER_STANDING, SCOOTER_SEATED], count: 200) {
      lat lon system { name { translation { value } } }
    }
    stations(lat: $lat, lon: $lon, range: 400, count: 10) {
      name { translation { value } } lat lon numBikesAvailable numDocksAvailable system { name { translation { value } } }
    }
  }`;
  const d = await mobility<{
    vehicles: { lat: number; lon: number; system: { name: { translation: { value: string }[] } } }[];
    stations: { name: { translation: { value: string }[] }; lat: number; lon: number; numBikesAvailable: number; numDocksAvailable: number; system: { name: { translation: { value: string }[] } } }[];
  }>(q, { lat, lon }, signal);
  const dist = (a: number, b: number) => haversine(lat, lon, a, b);
  const byOp = new Map<string, { count: number; nearestM: number }>();
  for (const v of d.vehicles ?? []) {
    const op = shortOperator(v.system?.name?.translation?.[0]?.value ?? "?");
    const cur = byOp.get(op) ?? { count: 0, nearestM: Infinity };
    cur.count++;
    cur.nearestM = Math.min(cur.nearestM, dist(v.lat, v.lon));
    byOp.set(op, cur);
  }
  return {
    scooters: [...byOp.entries()].map(([operator, v]) => ({ operator, count: v.count, nearestM: Math.round(v.nearestM) })).sort((a, b) => b.count - a.count),
    bikeStations: (d.stations ?? [])
      .filter((s) => /bysykkel/i.test(s.system?.name?.translation?.[0]?.value ?? ""))
      .map((s) => ({
        name: s.name?.translation?.[0]?.value ?? "",
        bikes: s.numBikesAvailable,
        docks: s.numDocksAvailable,
        distanceM: Math.round(dist(s.lat, s.lon)),
        operator: s.system?.name?.translation?.[0]?.value ?? "",
      }))
      .sort((a, b) => a.distanceM - b.distanceM),
  };
}

function shortOperator(name: string) {
  if (/bolt/i.test(name)) return "Bolt";
  if (/ryde/i.test(name)) return "Ryde";
  if (/voi/i.test(name)) return "Voi";
  return name;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Plukker tekst på ønsket språk fra Enturs flerspråklige felt. */
export function pickLang(values: { value: string; language: string | null }[] | undefined, lang: string): string {
  if (!values?.length) return "";
  const want = lang === "nb" ? ["no", "nb", "nob", "nor"] : ["en", "eng"];
  return values.find((v) => v.language && want.includes(v.language))?.value ?? values.find((v) => !v.language)?.value ?? values[0].value;
}

export function isDisruptive(severity: Severity) {
  return severity === "slight" || severity === "severe" || severity === "verySevere";
}
