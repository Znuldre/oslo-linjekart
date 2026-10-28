import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Lang, Limitation, Station, StationIndex, TransferMode } from "@/lib/types";
import { isLang, makeT, localePath } from "@/lib/i18n";
import { getHubs, getLayout, getLines, getStation, getStationIndex, getStationSlugs, sortLineCodes } from "@/lib/data";
import { MODE_COLOURS, lineColour } from "@/lib/colours";
import { modeOfLine } from "@/lib/line-order";
import { LineBadge, ModeIcon } from "@/components/ui/LineBadge";
import { StationLive } from "@/components/live/StationLive";
import { TripPlanner } from "@/components/live/TripPlanner";
import { MobilityWidget } from "@/components/live/MobilityWidget";
import { PoiList } from "@/components/station/PoiList";
import { StationMiniMap } from "@/components/station/StationMiniMap";

export function generateStaticParams() {
  return getStationSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const station = getStation(slug);
  if (!station || !isLang(lang)) return {};
  const t = makeT(lang);
  const modes = station.modes.map((m) => t(`mode.${m}`)).join(" / ");
  return {
    title: `${station.name} (${modes})`,
    description: `${station.name}: ${t("station.lines")} ${station.lineCodes.join(", ")}. ${t("site.description")}`,
  };
}

export default async function StationPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();
  const station = getStation(slug);
  if (!station) notFound();
  const t = makeT(lang);
  const lines = getLines();
  const index = getStationIndex();
  const byId = new Map(index.map((s) => [s.id, s]));
  const layout = getLayout();
  const hubs = getHubs();
  const stationLines = lines.filter((l) => station.lineCodes.includes(l.publicCode));

  return (
    <>
      <section className="station-hero">
        <div className="container container--wide station-hero__inner">
          <nav aria-label="Brødsmuler" className="text-meta">
            <Link href={localePath(lang)}>{t("nav.map")}</Link> › <Link href={localePath(lang, "/stopp")}>{t("nav.stations")}</Link>
          </nav>
          <h1>{station.name}</h1>
          <div className="station-hero__modes">
            {station.modes.map((m) => (
              <ModeIcon key={m} mode={m} label={t(`mode.${m}`)} />
            ))}
            <span className="station-hero__badges">
              {sortLineCodes(station.lineCodes).map((c) => (
                <Link key={c} href={localePath(lang, `/linje/${c}`)} aria-label={t("line.title", { code: c })}>
                  <LineBadge code={c} mode={modeOfLine(c)} />
                </Link>
              ))}
            </span>
          </div>
          {station.linked.length > 0 && (
            <p className="text-small">
              {t("station.linked")}:{" "}
              {station.linked.map((l, i) => {
                const other = byId.get(l.stationId);
                return other ? (
                  <span key={l.stationId}>
                    {i > 0 && ", "}
                    <Link href={localePath(lang, `/stopp/${other.slug}`)}>
                      {other.name} ({other.modes.map((m) => t(`mode.${m}`)).join("/")}, {l.distanceM} m)
                    </Link>
                  </span>
                ) : null;
              })}
            </p>
          )}
        </div>
      </section>

      <div className="container container--wide station-grid">
        <div className="station-grid__main">
          <StationLive stopPlaceIds={[station.id]} lineIds={stationLines.map((l) => l.id)} lineCodes={station.lineCodes} lang={lang} />
          <TripPlanner stationId={station.id} stationName={station.name} lat={station.lat} lon={station.lon} lang={lang} />
          <PoiList pois={station.pois} lang={lang} />
        </div>
        <div className="station-grid__side">
          <FactsBox station={station} lang={lang} hubs={hubs} lines={stationLines} />
          <Neighbours station={station} byId={byId} lang={lang} />
          <Transfers station={station} lang={lang} />
          <MobilityWidget lat={station.lat} lon={station.lon} />
          <StationMiniMap layout={layout} lines={lines} stations={index} stationId={station.id} lang={lang} />
        </div>
      </div>
    </>
  );
}

function FactsBox({ station, lang, hubs, lines }: { station: Station; lang: Lang; hubs: { slug: string; name: string; stationId: string | null }[]; lines: { publicCode: string; termini: string[]; mode: "metro" | "tram" }[] }) {
  const t = makeT(lang);
  const a = station.accessibility;
  const rows: [string, Limitation][] = [
    [t("station.accessibility.wheelchair"), a.wheelchairAccess],
    [t("station.accessibility.stepFree"), a.stepFreeAccess],
    [t("station.accessibility.lift"), a.liftFreeAccess],
    [t("station.accessibility.escalator"), a.escalatorFreeAccess],
  ];
  return (
    <section className="panel" aria-labelledby="facts-h">
      <h2 id="facts-h">{t("station.facts")}</h2>
      <dl className="facts">
        <div>
          <dt>{t("station.facts.modes")}</dt>
          <dd>{station.modes.map((m) => t(`mode.${m}`)).join(", ")}</dd>
        </div>
        <div>
          <dt>{t("station.facts.lines")}</dt>
          <dd style={{ display: "grid", gap: "0.3rem" }}>
            {lines.map((l) => (
              <span key={l.publicCode} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <LineBadge code={l.publicCode} mode={l.mode} size="sm" /> <span className="text-small">{l.termini.join(" – ")}</span>
              </span>
            ))}
          </dd>
        </div>
        {hubs
          .filter((h) => h.stationId)
          .map((h) => {
            const min = station.hubMinutes[h.slug];
            return (
              <div key={h.slug}>
                <dt>{t("station.facts.hub", { hub: h.name })}</dt>
                <dd>{h.stationId === station.id ? t("station.facts.hub.here") : min === null || min === undefined ? t("station.facts.hub.transfer") : t("station.facts.hub.min", { min })}</dd>
              </div>
            );
          })}
        <div>
          <dt>{t("station.facts.accessibility")}</dt>
          <dd>
            <div className="access-grid">
              {rows.map(([label, v]) => (
                <span key={label} style={{ display: "contents" }}>
                  <span>{label}</span>
                  <span className={`access--${v}`}>{t(`station.accessibility.${v}`)}</span>
                </span>
              ))}
            </div>
            <p className="text-meta" style={{ marginTop: "0.5rem" }}>
              {t("station.accessibility.source")}
            </p>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Neighbours({ station, byId, lang }: { station: Station; byId: Map<string, StationIndex>; lang: Lang }) {
  const t = makeT(lang);
  const codes = sortLineCodes(Object.keys(station.neighbours));
  if (!codes.length) return null;
  const link = (id?: string) => {
    const s = id ? byId.get(id) : undefined;
    return s ? <Link href={localePath(lang, `/stopp/${s.slug}`)}>{s.name}</Link> : <span className="text-meta">{t("station.neighbours.end")}</span>;
  };
  return (
    <section className="panel" aria-labelledby="nb-h">
      <h2 id="nb-h">{t("station.neighbours")}</h2>
      <div className="neighbours">
        {codes.map((c) => (
          <div key={c} className="neighbours__line">
            <LineBadge code={c} mode={modeOfLine(c)} />
            <div className="neighbours__dirs">
              {station.neighbours[c].map((n, i) => (
                <div key={i} className="neighbours__dir">
                  <span className="text-meta">{t("station.neighbours.towards", { name: n.towards })}</span>
                  <span>
                    {link(n.prev)} ← <strong>{station.name}</strong> → {link(n.next)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Transfers({ station, lang }: { station: Station; lang: Lang }) {
  const t = makeT(lang);
  const groups = new Map<TransferMode, typeof station.transfers>();
  for (const tr of station.transfers) groups.set(tr.mode, [...(groups.get(tr.mode) ?? []), tr]);
  const order: TransferMode[] = ["metro", "tram", "bus", "rail", "water", "coach", "other"];
  return (
    <section className="panel" aria-labelledby="tr-h">
      <h2 id="tr-h">{t("station.transfers")}</h2>
      {groups.size === 0 ? (
        <p className="text-secondary">{t("station.transfers.empty")}</p>
      ) : (
        <div className="transfers">
          {order
            .filter((m) => groups.has(m))
            .map((m) => {
              const items = groups.get(m)!;
              const codes = [...new Set(items.flatMap((i) => i.lines.map((l) => l.publicCode)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
              const nearest = Math.min(...items.map((i) => i.distanceM));
              return (
                <div key={m} className="transfers__group">
                  <ModeIcon mode={m} label={t(`mode.${m}`)} />
                  <div>
                    <div className="transfers__lines">
                      {codes.map((c) =>
                        m === "metro" || m === "tram" ? (
                          <LineBadge key={c} code={c} mode={m} size="sm" />
                        ) : (
                          <span key={c} className="transfer-badge" style={{ background: MODE_COLOURS[m] ?? lineColour(c).colour }}>
                            {c}
                          </span>
                        ),
                      )}
                    </div>
                    <span className="text-meta">
                      {items.map((i) => i.name).filter((v, i, a) => a.indexOf(v) === i).join(", ")} · {nearest === 0 ? t("station.transfers.here") : t("station.transfers.distance", { distance: nearest })}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </section>
  );
}

export const dynamicParams = false;
