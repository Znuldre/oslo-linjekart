import type { LayoutNode, SchematicLayout } from "../../lib/types.ts";
import { LINE_ORDER } from "../../lib/line-order.ts";

export type Pt = [number, number];

export interface SharedSegment {
  key: string;
  from: LayoutNode;
  to: LayoutNode;
  points: Pt[]; // fra → via… → til, orientert geometrisk (venstre→høyre, ellers topp→bunn)
  lineCodes: string[]; // sortert i linjerekkefølge
}

export const SPACING = 7; // px mellom parallelle linjer
export const STROKE = 5.5;

export const segKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Bygger delte segmenter (ett per nodepar) med lister over linjer som bruker dem. */
export function buildSegments(layout: SchematicLayout): Map<string, SharedSegment> {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const segs = new Map<string, SharedSegment>();
  for (const lp of layout.lines) {
    for (const s of lp.segments) {
      const a = nodeById.get(s.from);
      const b = nodeById.get(s.to);
      if (!a || !b) continue;
      const key = segKey(a.id, b.id);
      let seg = segs.get(key);
      if (!seg) {
        let pts: Pt[] = [[a.x, a.y], ...(s.via ?? []), [b.x, b.y]];
        let from = a;
        let to = b;
        // Geometrisk kanonisk orientering: venstre→høyre, ved lik x topp→bunn
        if (b.x < a.x || (b.x === a.x && b.y < a.y)) {
          pts = [...pts].reverse();
          from = b;
          to = a;
        }
        seg = { key, from, to, points: pts, lineCodes: [] };
        segs.set(key, seg);
      }
      if (!seg.lineCodes.includes(lp.lineCode)) seg.lineCodes.push(lp.lineCode);
    }
  }
  for (const seg of segs.values()) seg.lineCodes.sort((x, y) => LINE_ORDER.indexOf(x) - LINE_ORDER.indexOf(y));
  return segs;
}

/** Parallellforskyver en polylinje med avstand d (positiv = til høyre for retningen). */
export function offsetPolyline(points: Pt[], d: number): Pt[] {
  if (d === 0 || points.length < 2) return points;
  const normals: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }
  return points.map((p, j) => {
    if (j === 0) return [p[0] + normals[0][0] * d, p[1] + normals[0][1] * d];
    if (j === points.length - 1) {
      const n = normals[normals.length - 1];
      return [p[0] + n[0] * d, p[1] + n[1] * d];
    }
    const n1 = normals[j - 1];
    const n2 = normals[j];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const f = d / Math.max(0.35, 1 + dot); // miter, begrenset ved skarpe vinkler
    return [p[0] + (n1[0] + n2[0]) * f, p[1] + (n1[1] + n2[1]) * f];
  });
}

export function toPath(points: Pt[]) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}

/** Sti (flere delstier) for én linje, med sideveis forskyvning der flere linjer deler segment. */
export function linePathD(lineCode: string, segs: Map<string, SharedSegment>, extraOffset = 0): string {
  const parts: string[] = [];
  for (const seg of segs.values()) {
    const i = seg.lineCodes.indexOf(lineCode);
    if (i < 0) continue;
    const k = seg.lineCodes.length;
    const d = (i - (k - 1) / 2) * SPACING + extraOffset;
    parts.push(toPath(offsetPolyline(seg.points, d)));
  }
  return parts.join(" ");
}

export function nodeRadius(node: LayoutNode, lineCount: number) {
  if (node.kind === "interchange" || lineCount > 1) return 6.5;
  if (node.kind === "terminus") return 6;
  return 3.8;
}
