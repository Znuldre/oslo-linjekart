"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type MapView = "schematic" | "geo";

export interface MapState {
  lines: Set<string> | null; // null = alle
  view: MapView;
  station: string | null; // node-id (slug)
}

export function useMapState(allLineCodes: string[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo<MapState>(() => {
    const raw = params.get("lines");
    const view = params.get("view") === "geo" ? "geo" : "schematic";
    const station = params.get("station");
    let lines: Set<string> | null = null;
    if (raw !== null) {
      lines = new Set(raw.split(",").filter((c) => allLineCodes.includes(c)));
      if (lines.size === allLineCodes.length) lines = null;
    }
    return { lines, view, station };
  }, [params, allLineCodes]);

  const update = useCallback(
    (patch: Partial<MapState>) => {
      const next = { ...state, ...patch };
      const sp = new URLSearchParams();
      if (next.lines !== null && next.lines.size !== allLineCodes.length) sp.set("lines", allLineCodes.filter((c) => next.lines!.has(c)).join(","));
      if (next.view === "geo") sp.set("view", "geo");
      if (next.station) sp.set("station", next.station);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [state, allLineCodes, router, pathname],
  );

  const activeLines = useMemo(() => state.lines ?? new Set(allLineCodes), [state.lines, allLineCodes]);

  return { state, activeLines, update };
}
