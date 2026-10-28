"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Lang } from "@/lib/types";
import { LANGS, makeT } from "@/lib/i18n";

function Inner({ lang }: { lang: Lang }) {
  const pathname = usePathname() || `/${lang}/`;
  const params = useSearchParams();
  const qs = params.toString();
  const t = makeT(lang);
  return (
    <nav className="lang-switch" aria-label={t("nav.language")}>
      {LANGS.map((l) => {
        const href = pathname.replace(/^\/(nb|en)(?=\/|$)/, `/${l}`) + (qs ? `?${qs}` : "");
        return (
          <Link key={l} href={href} hrefLang={l} lang={l} aria-current={l === lang ? "true" : undefined} className={l === lang ? "is-active" : ""}>
            {l.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}

export function LanguageSwitch({ lang }: { lang: Lang }) {
  return (
    <Suspense fallback={<span className="lang-switch" />}>
      <Inner lang={lang} />
    </Suspense>
  );
}
