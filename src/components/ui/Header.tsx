import Link from "next/link";
import type { Lang } from "@/lib/types";
import { makeT, localePath } from "@/lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";

export function Header({ lang }: { lang: Lang }) {
  const t = makeT(lang);
  return (
    <header className="site-header">
      <div className="container container--wide site-header__inner">
        <Link href={localePath(lang)} className="site-logo" aria-label={t("site.title")}>
          <span className="site-logo__mark" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28">
              <rect width="28" height="28" rx="7" fill="#EC700C" />
              <rect x="6" y="6" width="16" height="16" rx="4" fill="#28A2F8" />
              <path d="M9.5 10.5h9v2.2h-3.4V19h-2.2v-6.3H9.5Z" fill="#fff" />
            </svg>
          </span>
          <span className="site-logo__text">
            <strong>Oslo</strong> {t("nav.map").toLowerCase()}
          </span>
        </Link>
        <nav className="site-nav" aria-label="Hovedmeny">
          <Link href={localePath(lang)}>{t("nav.map")}</Link>
          <Link href={localePath(lang, "/stopp")}>{t("nav.stations")}</Link>
          <Link href={localePath(lang, "/linje")}>{t("nav.lines")}</Link>
        </nav>
        <LanguageSwitch lang={lang} />
      </div>
    </header>
  );
}
