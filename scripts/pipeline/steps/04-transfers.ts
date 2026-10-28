/**
 * Steg 04: Bytte til andre linjer (buss, tog, båt, og andre T-bane-/trikkestopp) innen 300 m.
 * Bruker JP `nearest` rundt hver stasjon. Skriver .cache/work/transfers.json (stasjons-id → Transfer[]).
 */
import type { Station, Transfer, TransferMode } from "../../../src/lib/types.ts";
import { gql } from "../lib/entur.ts";
import { readJson, writeJson, work, log } from "../lib/io.ts";

const QUERY = /* GraphQL */ `
  query Nearby($lat: Float!, $lon: Float!) {
    nearest(latitude: $lat, longitude: $lon, maximumDistance: 300, maximumResults: 40, filterByPlaceTypes: [stopPlace], filterByInUse: true) {
      edges {
        node {
          distance
          place {
            ... on StopPlace {
              id
              name
              transportMode
              parent { id }
              quays { id lines { id publicCode name transportMode authority { id } } }
            }
          }
        }
      }
    }
  }
`;

interface NearestResult {
  nearest: {
    edges: {
      node: {
        distance: number;
        place: {
          id: string;
          name: string;
          transportMode: string[] | null;
          parent: { id: string } | null;
          quays: { id: string; lines: { id: string; publicCode: string; name: string; transportMode: string; authority: { id: string } | null }[] }[];
        } | null;
      };
    }[];
  };
}

const toMode = (m: string): TransferMode => {
  switch (m) {
    case "bus":
      return "bus";
    case "rail":
      return "rail";
    case "water":
      return "water";
    case "tram":
      return "tram";
    case "metro":
      return "metro";
    case "coach":
      return "coach";
    default:
      return "other";
  }
};

export async function runTransfers() {
  const base = readJson<Station[]>(work("stations.base.json"));
  const out: Record<string, Transfer[]> = {};
  let total = 0;

  await Promise.all(
    base.map(async (s) => {
      const res = await gql<NearestResult>(QUERY, { lat: s.lat, lon: s.lon }, { label: `nearest ${s.slug}` });
      const own = new Set([s.id, ...s.childStopPlaceIds]);
      const byKey = new Map<string, Transfer>(); // mode|stopPlaceId
      const seenLines = new Map<TransferMode, Set<string>>(); // linjer allerede listet ved nærmere stopp
      const edges = [...res.nearest.edges].sort((a, b) => a.node.distance - b.node.distance);
      for (const e of edges) {
        const p = e.node.place;
        if (!p) continue;
        const parentId = p.parent?.id ?? p.id;
        const distance = own.has(p.id) || own.has(parentId) ? 0 : Math.round(e.node.distance);
        // Linjer gruppert per modus på dette stoppestedet
        const linesByMode = new Map<TransferMode, Map<string, { publicCode: string; name?: string; lineId: string }>>();
        for (const q of p.quays) {
          for (const l of q.lines) {
            if (!l.publicCode) continue;
            const mode = toMode(l.transportMode);
            // Stasjonens egne T-bane-/trikkelinjer er ikke «bytte», heller ikke ved nabostopp
            if ((mode === "metro" || mode === "tram") && s.lineCodes.includes(l.publicCode)) continue;
            // Linjer som allerede er listet ved et nærmere stopp gjentas ikke
            const seen = seenLines.get(mode) ?? new Set<string>();
            if (seen.has(l.publicCode)) continue;
            const m = linesByMode.get(mode) ?? new Map();
            m.set(l.publicCode, { publicCode: l.publicCode, name: l.name, lineId: l.id });
            linesByMode.set(mode, m);
          }
        }
        for (const [mode, lines] of linesByMode) {
          const seen = seenLines.get(mode) ?? new Set<string>();
          for (const code of lines.keys()) seen.add(code);
          seenLines.set(mode, seen);
        }
        for (const [mode, lines] of linesByMode) {
          if (!lines.size) continue;
          const key = `${mode}|${parentId}`;
          const cur = byKey.get(key);
          if (cur) {
            for (const l of lines.values()) if (!cur.lines.some((x) => x.publicCode === l.publicCode)) cur.lines.push(l);
            cur.distanceM = Math.min(cur.distanceM, distance);
          } else {
            byKey.set(key, { mode, stopPlaceId: parentId, name: p.name, distanceM: distance, lines: [...lines.values()] });
          }
        }
      }
      const transfers = [...byKey.values()]
        .map((t) => ({ ...t, lines: t.lines.sort((a, b) => a.publicCode.localeCompare(b.publicCode, undefined, { numeric: true })) }))
        .sort((a, b) => a.distanceM - b.distanceM);
      out[s.id] = transfers;
      total += transfers.length;
    }),
  );

  writeJson(work("transfers.json"), out, false);
  const withBus = Object.values(out).filter((t) => t.some((x) => x.mode === "bus")).length;
  const withRail = Object.values(out).filter((t) => t.some((x) => x.mode === "rail")).length;
  log("04-transfers", `${Object.keys(out).length} stasjoner, ${total} byttemuligheter (${withBus} med buss, ${withRail} med tog)`);
  return out;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runTransfers().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
