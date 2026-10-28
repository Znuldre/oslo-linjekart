export const LINE_ORDER = ["1", "2", "3", "4", "5", "12", "13", "15", "17", "18", "19"];
export const sortLineCodes = (codes: Iterable<string>) => [...codes].sort((a, b) => LINE_ORDER.indexOf(a) - LINE_ORDER.indexOf(b));
export const modeOfLine = (code: string): "metro" | "tram" => (Number(code) <= 5 ? "metro" : "tram");
