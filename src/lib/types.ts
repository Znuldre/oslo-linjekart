/** Delt datamodell for pipeline (scripts/) og UI (src/). Kun "erasable" TypeScript – kjøres direkte av Node 24. */

export type Mode = "metro" | "tram";
export type TransferMode = "bus" | "rail" | "water" | "tram" | "metro" | "coach" | "other";
export type Lang = "nb" | "en";
export type L10n = { nb: string; en?: string };

export interface Line {
  id: string; // RUT:Line:1
  publicCode: string; // "1", "12"
  mode: Mode;
  colour: string; // hex med #
  textOnColour: string;
  termini: string[]; // stasjonsnavn, avledet fra journeyPatterns
  /** Lengste mønster per retning; stationIds er sammenslåtte stasjons-id-er (forelder-StopPlace) */
  stopSequences: { directionType: string; name: string; stationIds: string[] }[];
}

export interface LinkedStation {
  stationId: string;
  distanceM: number;
}

export interface StationIndex {
  id: string; // NSR:StopPlace:… (forelder om den finnes)
  slug: string;
  name: string;
  lat: number;
  lon: number;
  modes: Mode[];
  lineCodes: string[];
  linked: LinkedStation[];
}

export type Limitation = "TRUE" | "FALSE" | "PARTIAL" | "UNKNOWN";

export interface AccessibilityChild {
  id: string;
  name: string;
  modes: string[];
  wheelchairAccess: Limitation;
  stepFreeAccess: Limitation;
  liftFreeAccess: Limitation;
  escalatorFreeAccess: Limitation;
  quays: { id: string; publicCode?: string; wheelchairAccess: Limitation; stepFreeAccess: Limitation }[];
}

export interface Accessibility {
  wheelchairAccess: Limitation;
  stepFreeAccess: Limitation;
  liftFreeAccess: Limitation;
  escalatorFreeAccess: Limitation;
  perChild: AccessibilityChild[];
}

export interface Transfer {
  mode: TransferMode;
  stopPlaceId: string;
  name: string;
  distanceM: number;
  lines: { publicCode: string; name?: string; lineId: string }[];
}

export type PoiCategory =
  | "museum"
  | "attraction"
  | "park"
  | "gallery"
  | "theatre"
  | "monument"
  | "viewpoint"
  | "church"
  | "zoo"
  | "other";

export interface PoiWalk {
  durationS: number;
  distanceM: number;
  polyline?: string;
  source: "entur-foot" | "estimate";
}

export interface Poi {
  id: string; // osm:node/123 | osm:way/456 | curated:xyz
  name: L10n;
  category: PoiCategory;
  lat: number;
  lon: number;
  /** Gangmål når det avviker fra lat/lon (nærmeste kant av et område eller en inngang) */
  access?: { lat: number; lon: number };
  score: number;
  tier?: "A" | "B" | "C";
  priority?: number; // 1–3 for kuraterte landemerker
  walk: PoiWalk;
  image?: { url: string; attribution: string };
  summary?: L10n;
  wikipedia?: { nb?: string; en?: string }; // artikkeltitler
  wikidata?: string;
  website?: string;
  source: "osm" | "curated";
}

export interface PoiOverride {
  add?: Omit<Poi, "walk">[];
  remove?: string[];
  patch?: Record<string, Partial<Poi>>;
  pin?: string[];
}

/** Kuratert landemerke (content/pois/landmarks.json). Koordinater hentes fra OSM (osm/osmName) eller Wikipedia. */
export interface Landmark {
  id: string;
  osm?: string; // "way/123"
  osmName?: string; // eksakt OSM-navn (f.eks. innsjøer)
  name: L10n;
  category: PoiCategory;
  priority: 1 | 2 | 3;
  wikipedia?: { nb?: string; en?: string };
  wikidata?: string;
  lat?: number;
  lon?: number;
  access?: { lat: number; lon: number };
  website?: string;
  summary?: L10n;
  /** Bruk det håndskrevne sammendraget selv om Wikipedia finnes */
  summaryWins?: boolean;
}

export interface StationNeighbour {
  directionType: string;
  towards: string; // endestasjonsnavn
  prev?: string; // stasjons-id
  next?: string;
}

export interface Station extends StationIndex {
  childStopPlaceIds: string[];
  neighbours: Record<string, StationNeighbour[]>; // lineCode → per retning
  hubMinutes: Record<string, number | null>; // hub-slug → minutter
  transfers: Transfer[];
  accessibility: Accessibility;
  pois: Poi[];
  wikipedia?: { nb?: string; en?: string };
}

/* ---------- Skjematisk layout ---------- */

export type LabelRotate = 0 | 45 | -45 | 90 | -90;

export interface LayoutNode {
  id: string; // stabil node-id (slug for enkeltstasjon)
  stationIds: string[];
  x: number;
  y: number;
  kind: "stop" | "interchange" | "terminus";
  label: { anchor: "start" | "end" | "middle"; dx: number; dy: number; rotate: LabelRotate };
}

export interface LineSegment {
  from: string; // node-id
  to: string; // node-id
  via?: [number, number][];
}

export interface LinePath {
  lineCode: string;
  offset: number; // px sideveis forskyvning for parallelle løp
  segments: LineSegment[];
}

export interface SchematicLayout {
  viewBox: [number, number];
  grid: number;
  nodes: LayoutNode[];
  lines: LinePath[];
}

/* ---------- Geometri for geografisk kart ---------- */

export interface LineFeature {
  type: "Feature";
  properties: { kind: "line"; lineCode: string; lineId: string; mode: Mode; colour: string; direction: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export interface StationFeature {
  type: "Feature";
  properties: { kind: "station"; id: string; slug: string; name: string; modes: Mode[]; lineCodes: string[] };
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface GeometryCollection {
  type: "FeatureCollection";
  features: (LineFeature | StationFeature)[];
}
