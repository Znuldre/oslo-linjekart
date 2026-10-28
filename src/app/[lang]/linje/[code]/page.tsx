import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLang, makeT, localePath } from "@/lib/i18n";
import { getLines, getStationIndex, sortLineCodes } from "@/lib/data";
import { lineColour } from "@/lib/colours";
import { modeOfLine } from "@/lib/line-order";
import { LineBadge, ModeIcon } from "@/components/ui/LineBadge";
import { LineStatusPanel } from "@/components/live/LineStatusPanel";

export function generateStaticParams() {
  return getLines().map((l) => ({ code: l.publicCode }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string; code: string }> }): Promise<Metadata> {
  const { lang, code } = await params;
  const line = getLines().find((l) => l.publicCode === code);
  const t = makeT(isLang(lang) ? lang : "nb");
  return { title: line ? `${t("line.title", { code })}: ${line.termini.join(" – ")}` : t("nav.lines") };
}

export default async function LinePage({ params }: { params: Promise<{ lang: string; code: string }> }) {
  const { lang, code } = await params;
  if (!isLang(lang)) notFound();
  const line = getLines().find((l) => l.publicCode === code);
  if (!line) notFound();
  const t = makeT(lang);
  const byId = new Map(getStationIndex().map((s) => [s.id, s]));
  const c = lineColour(line.publicCode, line.mode);
  // Vis én sekvens per retning (den lengste)
  const dirs = new Map<string, (typeof line.stopSequences)[number]>();
  for (const s of line.stopSequences) {
    const cur = dirs.get(s.directionType);
    if (!cur || s.stationIds.length > cur.stationIds.length) dirs.set(s.directionType, s);
  }

  return (
    <>
      <section className="station-hero">
        <div className="container container--wide station-hero__inner">
          <nav aria-label="Brødsmuler" className="text-meta">
            <Link href={localePath(lang)}>{t("nav.map")}</Link> › <Link href={localePath(lang, "/linje")}>{t("nav.lines")}</Link>
          </nav>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <LineBadge code={line.publicCode} mode={line.mode} size="lg" />
            <h1>{line.termini.join(" – ")}</h1>
          </div>
          <div className="station-hero__modes">
            <ModeIcon mode={line.mode} label={t(`mode.${line.mode}`)} />
            <span>{t(`mode.${line.mode}`)}</span>
            <Link href={`${localePath(lang)}?lines=${line.publicCode}`} className="btn btn--secondary btn--small">
              {t("station.map.open")} →
            </Link>
          </div>
        </div>
      </section>
      <div className="container container--wide station-grid">
        <div className="station-grid__main">
          <section className="panel" aria-labelledby="stops-h">
            <h2 id="stops-h">{t("line.stops")}</h2>
            <div className="line-dirs">
              {[...dirs.values()].map((seq) => (
                <div key={seq.directionType}>
                  <h3 className="text-small text-secondary" style={{ marginBottom: "0.5rem" }}>
                    {t("line.direction", { name: byId.get(seq.stationIds[seq.stationIds.length - 1])?.name ?? "" })}
                  </h3>
                  <ol className="line-stops" style={{ "--line": c.colour } as React.CSSProperties}>
                    {seq.stationIds.map((id) => {
                      const s = byId.get(id);
                      if (!s) return null;
                      const others = sortLineCodes(s.lineCodes.filter((x) => x !== line.publicCode));
                      return (
                        <li key={id}>
                          <Link href={localePath(lang, `/stopp/${s.slug}`)}>{s.name}</Link>
                          {others.length > 0 && (
                            <span className="line-stops__badges">
                              {others.map((o) => (
                                <LineBadge key={o} code={o} mode={modeOfLine(o)} size="sm" />
                              ))}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="station-grid__side">
          <LineStatusPanel lineId={line.id} lang={lang} />
        </div>
      </div>
    </>
  );
}
