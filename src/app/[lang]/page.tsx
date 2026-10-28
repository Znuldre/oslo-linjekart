import Link from "next/link";
import { notFound } from "next/navigation";
import { isLang, makeT, localePath } from "@/lib/i18n";
import { getLayout, getLines, getStationIndex } from "@/lib/data";
import { MapExplorer } from "@/components/map/MapExplorer";
import { LineBadge } from "@/components/ui/LineBadge";

export default async function MapPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = makeT(lang);
  const lines = getLines();
  const stations = getStationIndex();
  const layout = getLayout();

  return (
    <>
      <section className="hero">
        <div className="container container--wide hero__inner">
          <h1>{t("site.title")}</h1>
          <p className="hero__tagline">{t("site.tagline")}</p>
        </div>
      </section>
      <div className="container container--wide">
        <MapExplorer layout={layout} lines={lines} stations={stations} lang={lang} />
      </div>
      <section className="section">
        <div className="container container--wide">
          <h2>{t("nav.lines")}</h2>
          <ul className="line-list">
            {lines.map((l) => (
              <li key={l.id}>
                <Link href={localePath(lang, `/linje/${l.publicCode}`)} className="line-list__item">
                  <LineBadge code={l.publicCode} mode={l.mode} size="lg" />
                  <span>
                    <span className="line-list__name">{l.termini.join(" – ")}</span>
                    <span className="text-meta">
                      {t(`mode.${l.mode}`)} · {t("line.stops").toLowerCase()}: {new Set(l.stopSequences.flatMap((s) => s.stationIds)).size}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
