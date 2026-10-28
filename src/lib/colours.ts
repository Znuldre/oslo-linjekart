import type { Mode, TransferMode } from "./types.ts";

/**
 * Linjefarger. T-bane følger Ruters designsystem (ruter-design-skillen).
 * Trikk følger Ruters offisielle linjekart «Trikk» utgave 2025-12 (vedlagt PDF),
 * som avviker fra den eldre fargetabellen i designsystemet (13/19 byttet, 15 ny, 11 utgått).
 */
export const LINE_COLOURS: Record<string, { colour: string; text: string }> = {
  // T-bane
  "1": { colour: "#0073D8", text: "#FFFFFF" },
  "2": { colour: "#EC700C", text: "#FFFFFF" },
  "3": { colour: "#A85FA5", text: "#FFFFFF" },
  "4": { colour: "#004A98", text: "#FFFFFF" },
  "5": { colour: "#02AA35", text: "#FFFFFF" },
  // Trikk (utgave 2025-12)
  "12": { colour: "#A06AAA", text: "#FFFFFF" },
  "13": { colour: "#1B9CE8", text: "#FFFFFF" },
  "15": { colour: "#E9508D", text: "#FFFFFF" },
  "17": { colour: "#ED1B2F", text: "#FFFFFF" },
  "18": { colour: "#F39A1E", text: "#25103A" },
  "19": { colour: "#2FAA5B", text: "#FFFFFF" },
};

export const MODE_COLOURS: Record<Mode | TransferMode, string> = {
  metro: "#EC700C",
  tram: "#28A2F8",
  bus: "#E60000",
  rail: "#4D4D4D",
  water: "#6C25B4",
  coach: "#8B0000",
  other: "#625371",
};

export function lineColour(publicCode: string, mode?: Mode) {
  return LINE_COLOURS[publicCode] ?? { colour: mode ? MODE_COLOURS[mode] : "#625371", text: "#FFFFFF" };
}
