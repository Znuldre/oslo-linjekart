"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Lang } from "@/lib/types";
import { makeT, type Translate } from "@/lib/i18n";

const Ctx = createContext<{ lang: Lang; t: Translate }>({ lang: "nb", t: makeT("nb") });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
