"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { StationIndex } from "@/lib/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LineBadge } from "@/components/ui/LineBadge";
import { modeOfLine } from "@/lib/line-order";

export function StationSearch({ stations, onPick }: { stations: StationIndex[]; onPick: (s: StationIndex) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const wrap = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 1) return [];
    return stations.filter((s) => s.name.toLowerCase().includes(needle)).sort((a, b) => a.name.toLowerCase().indexOf(needle) - b.name.toLowerCase().indexOf(needle) || a.name.localeCompare(b.name)).slice(0, 8);
  }, [q, stations]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (s: StationIndex) => {
    onPick(s);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={wrap} className="station-search">
      <label htmlFor={id} className="visually-hidden">
        {t("map.search")}
      </label>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={t("map.search.placeholder")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="station-search__list">
          {matches.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""} onMouseDown={() => pick(s)}>
              <span>{s.name}</span>
              <span className="station-search__badges">
                {s.lineCodes.map((c) => (
                  <LineBadge key={c} code={c} mode={modeOfLine(c)} size="sm" />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
