import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLang, makeT, localePath } from "@/lib/i18n";
import { getStationIndex, sortLineCodes } from "@/lib/data";
import { LineBadge } from "@/components/ui/LineBadge";
import { modeOfLine } from "@/lib/line-order";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = makeT(isLang(lang) ? lang : "nb");
  return { title: t("stations.title") };
}

export default async function StationsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = makeT(lang);
  const stations = [...getStationIndex()].sort((a, b) => a.name.localeCompare(b.name, "nb"));
  return (
    <section className="section">
      <div className="container container--wide">
        <h1>{t("stations.title")}</h1>
        <p className="text-secondary">{t("stations.intro", { n: stations.length })}</p>
        <ul className="stations-list">
          {stations.map((s) => (
            <li key={s.id}>
              <Link href={localePath(lang, `/stopp/${s.slug}`)}>
                <span>{s.name}</span>
                <span className="stations-list__badges">
                  {sortLineCodes(s.lineCodes).map((c) => (
                    <LineBadge key={c} code={c} mode={modeOfLine(c)} size="sm" />
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
