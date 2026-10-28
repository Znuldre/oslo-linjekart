import type { Lang } from "@/lib/types";
import { makeT } from "@/lib/i18n";

export function Footer({ lang }: { lang: Lang }) {
  const t = makeT(lang);
  return (
    <footer className="site-footer">
      <div className="container container--wide site-footer__inner">
        <p className="text-small">{t("footer.disclaimer")}</p>
        <p className="text-meta">
          {t("footer.data")}{" "}
          <a href="https://developer.entur.no" rel="noopener">
            developer.entur.no
          </a>
          {" · "}
          <a href="https://www.openstreetmap.org/copyright" rel="noopener">
            OpenStreetMap
          </a>
          {" · "}
          <a href="https://reise.ruter.no" rel="noopener">
            {t("footer.ruter")}
          </a>
        </p>
      </div>
    </footer>
  );
}
