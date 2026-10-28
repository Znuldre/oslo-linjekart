import type { Lang } from "./types.ts";
import nb from "../../content/i18n/nb.json";
import en from "../../content/i18n/en.json";

export const LANGS: Lang[] = ["nb", "en"];
export const DEFAULT_LANG: Lang = "nb";

export type Dictionary = Record<string, string>;
const DICTS: Record<Lang, Dictionary> = { nb: nb as Dictionary, en: en as Dictionary };

export function isLang(x: string | undefined): x is Lang {
  return x === "nb" || x === "en";
}

export function getDictionary(lang: Lang): Dictionary {
  return DICTS[lang] ?? DICTS.nb;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): Translate {
  const dict = getDictionary(lang);
  const fallback = DICTS.nb;
  return (key, vars) => {
    let s = dict[key] ?? fallback[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** Velger nb/en-tekst fra et L10n-objekt; faller tilbake til det andre språket når ønsket språk mangler. */
export function pick(l10n: { nb: string; en?: string } | undefined, lang: Lang): string {
  if (!l10n) return "";
  if (lang === "en") return l10n.en || l10n.nb || "";
  return l10n.nb || l10n.en || "";
}

export const localePath = (lang: Lang, path = "") => `/${lang}${path.startsWith("/") ? path : `/${path}`}`.replace(/\/+$/, "") + "/";

/** basePath for statisk hosting under en undermappe (f.eks. GitHub Pages). next/link legger den på selv; rene <a>-lenker må bruke withBase. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const withBase = (path: string) => `${BASE_PATH}${path}`;

export const htmlLang = (lang: Lang) => (lang === "nb" ? "nb" : "en");
export const dateLocale = (lang: Lang) => (lang === "nb" ? "nb-NO" : "en-GB");
