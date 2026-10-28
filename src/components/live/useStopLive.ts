"use client";
import { useEffect, useState } from "react";
import { fetchLineStatus, fetchStopLive, type LineStatus, type StopLive } from "@/lib/entur-client";

export function useStopLive(stopPlaceIds: string[], lineIds: string[], intervalMs = 30_000) {
  const [live, setLive] = useState<{ stop: StopLive; lines: LineStatus[]; updatedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopKey = stopPlaceIds.join(",");
  const lineKey = lineIds.join(",");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const ids = stopKey.split(",").filter(Boolean);
    const lines = lineKey.split(",").filter(Boolean);
    const load = async () => {
      if (document.hidden) {
        timer = setTimeout(load, intervalMs);
        return;
      }
      try {
        const [stops, lineStatus] = await Promise.all([Promise.all(ids.map((id) => fetchStopLive(id, 16, ctrl.signal))), lines.length ? fetchLineStatus(lines, ctrl.signal) : Promise.resolve([])]);
        if (cancelled) return;
        const merged: StopLive = {
          situations: dedupe(stops.flatMap((s) => s.situations)),
          estimatedCalls: stops.flatMap((s) => s.estimatedCalls).sort((a, b) => a.expectedDepartureTime.localeCompare(b.expectedDepartureTime)),
        };
        setLive({ stop: merged, lines: lineStatus, updatedAt: Date.now() });
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled) timer = setTimeout(load, intervalMs);
    };
    load();
    const onVis = () => {
      if (!document.hidden) {
        if (timer) clearTimeout(timer);
        load();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [stopKey, lineKey, intervalMs]);

  return { live, error, loading: live === null && !error };
}

function dedupe<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
