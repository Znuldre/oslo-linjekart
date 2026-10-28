"use client";
import type { Line, Mode } from "@/lib/types";
import { lineColour } from "@/lib/colours";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ModeIcon } from "@/components/ui/LineBadge";

export function LayerToggles({
  lines,
  activeLines,
  onChange,
  status,
}: {
  lines: Line[];
  activeLines: Set<string>;
  onChange: (next: Set<string>) => void;
  status?: Record<string, "normal" | "deviation" | "unknown">;
}) {
  const { t } = useI18n();
  const modes: Mode[] = ["metro", "tram"];

  const toggleLine = (code: string) => {
    const next = new Set(activeLines);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };
  const toggleMode = (mode: Mode) => {
    const codes = lines.filter((l) => l.mode === mode).map((l) => l.publicCode);
    const allOn = codes.every((c) => activeLines.has(c));
    const next = new Set(activeLines);
    for (const c of codes) allOn ? next.delete(c) : next.add(c);
    onChange(next);
  };

  return (
    <div className="layer-toggles" role="group" aria-label={t("map.layers")}>
      {modes.map((mode) => {
        const codes = lines.filter((l) => l.mode === mode);
        const onCount = codes.filter((l) => activeLines.has(l.publicCode)).length;
        const allOn = onCount === codes.length;
        return (
          <div key={mode} className="layer-toggles__group">
            <button
              type="button"
              className={`mode-toggle${allOn ? " is-on" : onCount ? " is-partial" : ""}`}
              aria-pressed={allOn}
              onClick={() => toggleMode(mode)}
            >
              <ModeIcon mode={mode} label={t(`mode.${mode}`)} />
              <span>{t(`mode.${mode}`)}</span>
            </button>
            <div className="layer-toggles__lines">
              {codes.map((l) => {
                const on = activeLines.has(l.publicCode);
                const c = lineColour(l.publicCode, l.mode);
                const st = status?.[l.publicCode];
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`line-toggle${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleLine(l.publicCode)}
                    style={{ "--line": c.colour, "--line-text": c.text } as React.CSSProperties}
                    title={`${t("line.title", { code: l.publicCode })}: ${l.termini.join(" – ")}${st === "deviation" ? ` · ${t("map.status.deviation")}` : ""}`}
                  >
                    <span className="line-toggle__badge">{l.publicCode}</span>
                    {st === "deviation" && <span className="line-toggle__dot" aria-label={t("map.status.deviation")} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
