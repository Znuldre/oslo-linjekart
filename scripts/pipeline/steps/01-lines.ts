/**
 * Steg 01: Hent de 11 T-bane- og trikkelinjene fra Entur Journey Planner med stopp,
 * journey patterns (stoppsekvenser) og geometri, samt aktive serviceJourneys på et utvalg
 * datoer (for å skille dagens nettverk fra utdaterte mønstre og for å beregne reisetid).
 * Skriver .cache/work/lines.raw.json.
 */
import { gql } from "../lib/entur.ts";
import { writeJson, work, log } from "../lib/io.ts";

export interface RawStopPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  parent: { id: string; name: string; latitude: number; longitude: number } | null;
}

export interface RawQuay {
  id: string;
  name?: string;
  publicCode?: string;
  stopPlace: RawStopPlace | null;
}

export interface RawJourneyPattern {
  id: string;
  name: string;
  directionType: string;
  quays: RawQuay[];
  pointsOnLink: { points: string; length: number } | null;
}

export interface RawPassingTime {
  stationId: string; // forelder-StopPlace om den finnes
  time: string; // HH:MM:SS
}

export interface RawServiceJourney {
  id: string;
  journeyPatternId: string;
  date: string;
  passingTimes: RawPassingTime[];
}

export interface RawLine {
  id: string;
  publicCode: string;
  name: string;
  transportMode: "metro" | "tram";
  quays: RawQuay[];
  journeyPatterns: RawJourneyPattern[];
  /** Antall aktive serviceJourneys per mønster summert over sample-datoene */
  activePatternCounts: Record<string, number>;
  /** Utvalg av serviceJourneys (maks N per mønster) med passeringstider */
  sampleServiceJourneys: RawServiceJourney[];
}

const LINES_QUERY = /* GraphQL */ `
  query Lines {
    lines(authorities: ["RUT:Authority:RUT"], transportModes: [metro, tram]) {
      id
      publicCode
      name
      transportMode
      quays {
        id
        name
        publicCode
        stopPlace { id name latitude longitude parent { id name latitude longitude } }
      }
      journeyPatterns {
        id
        name
        directionType
        quays { id stopPlace { id name latitude longitude parent { id name latitude longitude } } }
        pointsOnLink { points length }
      }
    }
  }
`;

const SJ_QUERY = /* GraphQL */ `
  query ActiveServiceJourneys($line: ID!, $date: Date!) {
    serviceJourneys(lines: [$line], activeDates: [$date]) {
      id
      journeyPattern { id }
      passingTimes {
        quay { stopPlace { id parent { id } } }
        departure { time }
        arrival { time }
      }
    }
  }
`;

/** Datoer som dekker både nær framtid og et stykke ut i ruteperioden (ukedager + én lørdag). */
export function sampleDates(from = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const offsets = [1, 2, 5, 14, 28, 42, 63, 84];
  for (const off of offsets) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + off);
    // Skyv til ukedag, unntatt ett innslag som skal være lørdag
    if (off === 5) {
      while (x.getUTCDay() !== 6) x.setUTCDate(x.getUTCDate() + 1);
    } else {
      while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() + 1);
    }
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

const MAX_SJ_PER_PATTERN_PER_DATE = 12;

export async function runLines() {
  const data = await gql<{ lines: Omit<RawLine, "activePatternCounts" | "sampleServiceJourneys">[] }>(LINES_QUERY, {}, { label: "lines" });
  const baseLines = data.lines.filter((l) => l.transportMode === "metro" || l.transportMode === "tram");
  baseLines.sort((a, b) => a.transportMode.localeCompare(b.transportMode) || Number(a.publicCode) - Number(b.publicCode));

  const dates = sampleDates();
  log("01-lines", `sample-datoer: ${dates.join(", ")}`);

  const lines: RawLine[] = [];
  for (const l of baseLines) {
    const counts: Record<string, number> = {};
    const samples: RawServiceJourney[] = [];
    await Promise.all(
      dates.map(async (date) => {
        const res = await gql<{
          serviceJourneys: {
            id: string;
            journeyPattern: { id: string } | null;
            passingTimes: { quay: { stopPlace: { id: string; parent: { id: string } | null } }; departure: { time: string | null } | null; arrival: { time: string | null } | null }[];
          }[];
        }>(SJ_QUERY, { line: l.id, date }, { label: `sj ${l.publicCode} ${date}` });
        const perPattern: Record<string, number> = {};
        for (const sj of res.serviceJourneys) {
          const jp = sj.journeyPattern?.id;
          if (!jp) continue;
          counts[jp] = (counts[jp] ?? 0) + 1;
          perPattern[jp] = (perPattern[jp] ?? 0) + 1;
          if (perPattern[jp] > MAX_SJ_PER_PATTERN_PER_DATE) continue;
          samples.push({
            id: sj.id,
            journeyPatternId: jp,
            date,
            passingTimes: sj.passingTimes
              .map((pt) => ({
                stationId: pt.quay.stopPlace.parent?.id ?? pt.quay.stopPlace.id,
                time: pt.departure?.time ?? pt.arrival?.time ?? "",
              }))
              .filter((pt) => pt.time),
          });
        }
      }),
    );
    lines.push({ ...l, activePatternCounts: counts, sampleServiceJourneys: samples });
  }

  writeJson(work("lines.raw.json"), lines, false);
  log("01-lines", `${lines.length} linjer: ${lines.map((l) => `${l.transportMode[0]}${l.publicCode}`).join(", ")}`);
  for (const l of lines) {
    const active = Object.keys(l.activePatternCounts).length;
    const stops = new Set(l.quays.map((q) => q.stopPlace?.parent?.id ?? q.stopPlace?.id)).size;
    const total = Object.values(l.activePatternCounts).reduce((a, b) => a + b, 0);
    log("01-lines", `  ${l.publicCode.padStart(2)} ${l.transportMode.padEnd(5)} ${stops} stasjoner, ${l.journeyPatterns.length} mønstre (${active} aktive, ${total} avganger på sample-datoene)`);
  }
  return lines;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runLines().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
