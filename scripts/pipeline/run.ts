/**
 * Orkestrator for datapipelinen.
 *   node scripts/pipeline/run.ts             – alle steg
 *   node scripts/pipeline/run.ts --step 2    – ett steg
 *   node scripts/pipeline/run.ts --from 5    – fra og med steg
 *   --force                                  – ignorer HTTP-cache
 */
import { httpStats } from "./lib/http.ts";

type Step = { n: number; name: string; run: () => Promise<unknown> | unknown };

const steps: Step[] = [
  { n: 1, name: "lines", run: async () => (await import("./steps/01-lines.ts")).runLines() },
  { n: 2, name: "stations", run: async () => (await import("./steps/02-stations.ts")).runStations() },
  { n: 3, name: "accessibility", run: async () => (await import("./steps/03-accessibility.ts")).runAccessibility() },
  { n: 4, name: "transfers", run: async () => (await import("./steps/04-transfers.ts")).runTransfers() },
  { n: 5, name: "pois", run: async () => (await import("./steps/05-pois.ts")).runPois() },
  { n: 6, name: "walk", run: async () => (await import("./steps/06-walk.ts")).runWalk() },
  { n: 8, name: "emit", run: async () => (await import("./steps/08-emit.ts")).runEmit() },
];

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : null;
};
const only = argValue("--step");
const from = argValue("--from");

const selected = steps.filter((s) => (only !== null ? s.n === only : from !== null ? s.n >= from : true));

const t0 = Date.now();
for (const step of selected) {
  const t = Date.now();
  console.log(`\n=== Steg ${step.n}: ${step.name} ===`);
  try {
    await step.run();
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND" && only === null) {
      console.warn(`  (steg ${step.n} ikke implementert enda – hopper over)`);
      continue;
    }
    throw err;
  }
  console.log(`  ferdig på ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
const st = httpStats();
console.log(`\nPipeline ferdig på ${((Date.now() - t0) / 1000).toFixed(1)} s. HTTP: ${st.hits} cache-treff, ${st.misses} kall, ${st.errors} feil.`);
