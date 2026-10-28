import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { tid } from "@/lib/fonts";
import { LANGS, isLang, makeT, htmlLang } from "@/lib/i18n";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import "@/styles/tokens.css";
import "@/styles/globals.css";
import "@/styles/components.css";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = makeT(isLang(lang) ? lang : "nb");
  return {
    title: { default: t("site.title"), template: `%s – ${t("site.title")}` },
    description: t("site.description"),
    openGraph: { type: "website", siteName: t("site.title"), locale: lang === "nb" ? "nb_NO" : "en_GB" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#170e20" },
  ],
};

const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})();`;

export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = makeT(lang);
  return (
    <html lang={htmlLang(lang)} dir="ltr" className={tid.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <I18nProvider lang={lang}>
          <a href="#hovedinnhold" className="skip-link">
            {t("nav.skip")}
          </a>
          <Header lang={lang} />
          <main id="hovedinnhold">{children}</main>
          <Footer lang={lang} />
        </I18nProvider>
      </body>
    </html>
  );
}
