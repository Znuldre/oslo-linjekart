import { lineColour } from "@/lib/colours";
import type { Mode } from "@/lib/types";

export function LineBadge({
  code,
  mode,
  size = "md",
  dimmed = false,
  title,
}: {
  code: string;
  mode?: Mode;
  size?: "sm" | "md" | "lg";
  dimmed?: boolean;
  title?: string;
}) {
  const c = lineColour(code, mode);
  return (
    <span
      className={`line-badge line-badge--${size}${dimmed ? " line-badge--dimmed" : ""}`}
      style={{ background: c.colour, color: c.text }}
      title={title}
      aria-label={title}
    >
      {code}
    </span>
  );
}

export function ModeIcon({ mode, label }: { mode: string; label: string }) {
  // Enkle, tydelige ikoner i Ruter-stil (geometriske former)
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (mode) {
    case "metro":
      return (
        <span className="mode-icon mode-icon--metro" title={label}>
          <svg {...common}>
            <circle cx="12" cy="12" r="10" fill="#EC700C" />
            <path d="M8 16V8h2.2l1.8 4 1.8-4H16v8h-1.8v-4.6L12.6 16h-1.2l-1.6-4.6V16Z" fill="#fff" />
          </svg>
        </span>
      );
    case "tram":
      return (
        <span className="mode-icon mode-icon--tram" title={label}>
          <svg {...common}>
            <rect x="2" y="2" width="20" height="20" rx="4" fill="#28A2F8" />
            <path d="M7 8.5A1.5 1.5 0 0 1 8.5 7h7A1.5 1.5 0 0 1 17 8.5v6A1.5 1.5 0 0 1 15.5 16h-7A1.5 1.5 0 0 1 7 14.5Zm1.5 0v3h7v-3ZM9 14a.9.9 0 1 0 0-1.8A.9.9 0 0 0 9 14Zm6 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8ZM9 17h6l1 1.5H8Z" fill="#fff" />
          </svg>
        </span>
      );
    case "bus":
      return (
        <span className="mode-icon mode-icon--bus" title={label}>
          <svg {...common}>
            <rect x="2" y="2" width="20" height="20" rx="4" fill="#E60000" />
            <path d="M6 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-1 1.7V18h-2v-1H9v1H7v-1.3A2 2 0 0 1 6 15Zm2 0v3.5h8V8Zm1 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="#fff" />
          </svg>
        </span>
      );
    case "rail":
      return (
        <span className="mode-icon mode-icon--rail" title={label}>
          <svg {...common}>
            <rect x="2" y="2" width="20" height="20" rx="4" fill="#4D4D4D" />
            <path d="M8 6h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2l1.5 2h-1.8l-1-1.4H9.3l-1 1.4H6.5L8 16a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm0 2v3.5h8V8Zm1.2 6.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm5.6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="#fff" />
          </svg>
        </span>
      );
    case "water":
      return (
        <span className="mode-icon mode-icon--water" title={label}>
          <svg {...common}>
            <rect x="2" y="2" width="20" height="20" rx="4" fill="#6C25B4" />
            <path d="M7 11V8h4V6h2v2h4v3l1.5.7-1.6 4.3H7.1L5.5 11.7Zm2-1v1.5h6V10Zm-3 8c1.3 0 1.8-.8 3-.8s1.7.8 3 .8 1.7-.8 3-.8 1.7.8 3 .8v-1.6c-1.3 0-1.8-.8-3-.8s-1.7.8-3 .8-1.7-.8-3-.8-1.7.8-3 .8Z" fill="#fff" />
          </svg>
        </span>
      );
    default:
      return (
        <span className="mode-icon" title={label}>
          <svg {...common}>
            <circle cx="12" cy="12" r="10" fill="#625371" />
          </svg>
        </span>
      );
  }
}
