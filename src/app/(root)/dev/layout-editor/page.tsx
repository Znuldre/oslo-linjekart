import { notFound } from "next/navigation";
import { getLayout, getLines, getStationIndex } from "@/lib/data";
import { LayoutEditor } from "@/components/dev/LayoutEditor";
import "@/styles/components.css";

export const metadata = { title: "Layout-editor (dev)", robots: { index: false } };

/** Utviklerverktøy: dra noder, juster etiketter, kopier JSON. Bare tilgjengelig når NEXT_PUBLIC_LAYOUT_EDITOR=1. */
export default function LayoutEditorPage() {
  if (process.env.NEXT_PUBLIC_LAYOUT_EDITOR !== "1") notFound();
  return <LayoutEditor layout={getLayout()} lines={getLines()} stations={getStationIndex()} />;
}
