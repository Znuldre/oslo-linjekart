import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLang, makeT, localePath } from "@/lib/i18n";
import { getLines } from "@/lib/data";
import { LineBadge } from "@/components/ui/LineBadge";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = makeT(isLang(lang) ? lang : "nb");
  return { title: t("nav.lines") };
}

export default async function LinesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = makeT(lang);
  const lines = getLines();
  return (
    <section className="section">
      <div className="container container--wide">
        <h1>{t("nav.lines")}</h1>
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
  );
}
