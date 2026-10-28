const MAP: Record<string, string> = { æ: "ae", ø: "o", å: "a", é: "e", è: "e", ü: "u", ö: "o", ä: "a" };

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[æøåéèüöä]/g, (c) => MAP[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalisert navn for sammenligning (uten "stasjon", "T", parenteser). */
export function normaliseName(name: string): string {
  return slugify(
    name
      .replace(/\(.*?\)/g, " ")
      .replace(/\b(stasjon|st\.|holdeplass|T)\b/gi, " ")
      .trim(),
  );
}
