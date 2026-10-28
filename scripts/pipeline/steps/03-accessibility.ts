/**
 * Steg 03: Tilgjengelighet fra Nasjonalt stoppestedsregister (NSR) – barne-stoppesteder og quays.
 * Skriver .cache/work/accessibility.json (stasjons-id → Accessibility).
 */
import type { Station, Accessibility, AccessibilityChild, Limitation } from "../../../src/lib/types.ts";
import { nsrGet } from "../lib/entur.ts";
import { readJson, readJsonIfExists, writeJson, work, content, log } from "../lib/io.ts";

interface NsrLimitation {
  wheelchairAccess?: string;
  stepFreeAccess?: string;
  liftFreeAccess?: string;
  escalatorFreeAccess?: string;
}
interface NsrAssessment {
  limitations?: { accessibilityLimitation?: NsrLimitation };
  mobilityImpairedAccess?: string;
}
interface NsrQuay {
  id: string;
  publicCode?: string;
  accessibilityAssessment?: NsrAssessment;
}
interface NsrStopPlace {
  id: string;
  name?: { value: string };
  transportMode?: string;
  metroSubmode?: string;
  tramSubmode?: string;
  busSubmode?: string;
  accessibilityAssessment?: NsrAssessment;
  quays?: { quayRefOrQuay?: NsrQuay[] };
  keyList?: { keyValue?: { key: string; value?: string }[] };
}

const norm = (v?: string): Limitation => (v === "TRUE" || v === "FALSE" || v === "PARTIAL" ? v : "UNKNOWN");

function aggregate(values: Limitation[]): Limitation {
  const known = values.filter((v) => v !== "UNKNOWN");
  if (!known.length) return "UNKNOWN";
  if (known.every((v) => v === "TRUE")) return "TRUE";
  if (known.every((v) => v === "FALSE")) return "FALSE";
  return "PARTIAL";
}

/** Bruk mest informative kilde: barn-nivå hvis kjent, ellers aggregat av quays. */
function combine(child: Limitation, quays: Limitation[]): Limitation {
  if (child !== "UNKNOWN") return child;
  return aggregate(quays);
}

export async function runAccessibility() {
  const base = readJson<Station[]>(work("stations.base.json"));
  const out: Record<string, Accessibility> = {};
  let known = 0;
  let failed = 0;

  for (const s of base) {
    let children: NsrStopPlace[] = [];
    try {
      // Forelder → barn; monomodalt stopp uten forelder → seg selv
      if (s.childStopPlaceIds.length > 1 || s.childStopPlaceIds[0] !== s.id) {
        children = await nsrGet<NsrStopPlace[]>(`/stop-places/${encodeURIComponent(s.id)}/children`);
      } else {
        children = [await nsrGet<NsrStopPlace>(`/stop-places/${encodeURIComponent(s.id)}`)];
      }
    } catch (e) {
      failed++;
      log("03-accessibility", `  ${s.name}: ${(e as Error).message.slice(0, 120)}`);
      continue;
    }
    const perChild: AccessibilityChild[] = children.map((c) => {
      const lim = c.accessibilityAssessment?.limitations?.accessibilityLimitation ?? {};
      const quays = (c.quays?.quayRefOrQuay ?? []).map((q) => {
        const ql = q.accessibilityAssessment?.limitations?.accessibilityLimitation ?? {};
        return { id: q.id, publicCode: q.publicCode, wheelchairAccess: norm(ql.wheelchairAccess), stepFreeAccess: norm(ql.stepFreeAccess) };
      });
      const modes = [c.transportMode, c.metroSubmode && "metro", c.tramSubmode && "tram", c.busSubmode && "bus"].filter((x): x is string => !!x);
      return {
        id: c.id,
        name: c.name?.value ?? s.name,
        modes: [...new Set(modes.map((m) => m.toLowerCase()))],
        wheelchairAccess: combine(norm(lim.wheelchairAccess), quays.map((q) => q.wheelchairAccess)),
        stepFreeAccess: combine(norm(lim.stepFreeAccess), quays.map((q) => q.stepFreeAccess)),
        liftFreeAccess: norm(lim.liftFreeAccess),
        escalatorFreeAccess: norm(lim.escalatorFreeAccess),
        quays,
      };
    });
    // Kun barn som hører til T-bane/trikk (bussholdeplasser under samme forelder skal ikke farge vurderingen)
    const relevant = perChild.filter((c) => s.childStopPlaceIds.includes(c.id));
    const use = relevant.length ? relevant : perChild;
    const acc: Accessibility = {
      wheelchairAccess: aggregate(use.map((c) => c.wheelchairAccess)),
      stepFreeAccess: aggregate(use.map((c) => c.stepFreeAccess)),
      liftFreeAccess: aggregate(use.map((c) => c.liftFreeAccess)),
      escalatorFreeAccess: aggregate(use.map((c) => c.escalatorFreeAccess)),
      perChild: use,
    };
    out[s.id] = acc;
  }
  // Kuraterte overstyringer (content/accessibility-overrides.json: slug → delvis Accessibility) – NSR mangler ofte data
  const overrides = readJsonIfExists<Record<string, Partial<Accessibility>>>(content("accessibility-overrides.json")) ?? {};
  let overridden = 0;
  for (const s of base) {
    const ov = overrides[s.slug];
    if (ov && out[s.id]) {
      out[s.id] = { ...out[s.id], ...ov, perChild: out[s.id].perChild };
      overridden++;
    }
  }
  for (const acc of Object.values(out)) if (acc.wheelchairAccess !== "UNKNOWN" || acc.stepFreeAccess !== "UNKNOWN") known++;
  if (overridden) log("03-accessibility", `${overridden} stasjoner overstyrt fra content/accessibility-overrides.json`);
  writeJson(work("accessibility.json"), out, false);
  log("03-accessibility", `${Object.keys(out).length} stasjoner, ${known} med kjent rullestol-/trinnfri-status, ${failed} feilet`);
  return out;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runAccessibility().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
