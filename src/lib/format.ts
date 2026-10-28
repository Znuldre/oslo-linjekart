import type { Lang } from "./types";

export function formatTime(iso: string, lang: Lang) {
  return new Date(iso).toLocaleTimeString(lang === "nb" ? "nb-NO" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function minutesUntil(iso: string, now = Date.now()) {
  return Math.round((new Date(iso).getTime() - now) / 60000);
}

export function formatMinutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

export function formatDistance(m: number, lang: Lang) {
  if (m >= 1000) return `${(m / 1000).toLocaleString(lang === "nb" ? "nb-NO" : "en-GB", { maximumFractionDigits: 1 })} km`;
  return `${Math.round(m / 10) * 10} m`;
}
