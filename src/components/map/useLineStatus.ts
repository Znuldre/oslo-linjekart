"use client";
import { useEffect, useState } from "react";
import { fetchLineStatus, isDisruptive, type LineStatus } from "@/lib/entur-client";

export type StatusMap = Record<string, "normal" | "deviation" | "unknown">;

export function useLineStatus(lineIds: string[], intervalMs = 60_000) {
  const [statuses, setStatuses] = useState<LineStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = lineIds.join(",");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const load = async () => {
      if (document.hidden) {
        timer = setTimeout(load, intervalMs);
        return;
      }
      try {
        const res = await fetchLineStatus(key.split(","), ctrl.signal);
        if (!cancelled) {
          setStatuses(res);
          setError(null);
        }
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
  }, [key, intervalMs]);

  const map: StatusMap = {};
  if (statuses) for (const s of statuses) map[s.publicCode] = s.situations.some((x) => isDisruptive(x.severity)) ? "deviation" : "normal";
  return { statuses, statusMap: map, loading: statuses === null && !error, error };
}
