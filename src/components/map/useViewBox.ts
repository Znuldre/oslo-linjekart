"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_ZOOM = 0.6; // andel av full bredde (kan zoome litt ut)
const MAX_ZOOM = 10; // ganger inn

export function useViewBox(full: ViewBox, wheelZoom = true) {
  const [vb, setVb] = useState<ViewBox>(full);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragState = useRef<{ moved: boolean; startVb: ViewBox; startMid: { x: number; y: number }; startDist: number } | null>(null);
  const suppressClick = useRef(false);

  const clamp = useCallback(
    (next: ViewBox): ViewBox => {
      const minW = full.w / MAX_ZOOM;
      const maxW = full.w / MIN_ZOOM;
      let w = Math.min(maxW, Math.max(minW, next.w));
      const ratio = full.h / full.w;
      let h = w * ratio;
      // Hold kartet innenfor et romslig område rundt fullvisning
      const pad = full.w * 0.5;
      const x = Math.min(full.x + full.w + pad - w, Math.max(full.x - pad, next.x));
      const y = Math.min(full.y + full.h + pad - h, Math.max(full.y - pad, next.y));
      return { x, y, w, h };
    },
    [full],
  );

  /** Skjerm-px → SVG-koordinat */
  const toSvg = useCallback(
    (clientX: number, clientY: number, box: ViewBox) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const scale = Math.max(box.w / rect.width, box.h / rect.height); // preserveAspectRatio meet
      const offX = (rect.width - box.w / scale) / 2;
      const offY = (rect.height - box.h / scale) / 2;
      return { x: box.x + (clientX - rect.left - offX) * scale, y: box.y + (clientY - rect.top - offY) * scale };
    },
    [],
  );

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setVb((cur) => {
        const rect = svgRef.current?.getBoundingClientRect();
        const cx = clientX ?? (rect ? rect.left + rect.width / 2 : 0);
        const cy = clientY ?? (rect ? rect.top + rect.height / 2 : 0);
        const p = toSvg(cx, cy, cur);
        const w = cur.w / factor;
        const h = cur.h / factor;
        return clamp({ x: p.x - (p.x - cur.x) / factor, y: p.y - (p.y - cur.y) / factor, w, h });
      });
    },
    [clamp, toSvg],
  );

  // Hjul-zoom må registreres som ikke-passiv lytter for å kunne stoppe sidens scrolling
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !wheelZoom) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, wheelZoom]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];
      const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
      const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
      dragState.current = { moved: false, startVb: vb, startMid: mid, startDist: dist };
    },
    [vb],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(e.pointerId) || !dragState.current) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];
      const st = dragState.current;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scale = Math.max(st.startVb.w / rect.width, st.startVb.h / rect.height);
      const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
      const dx = mid.x - st.startMid.x;
      const dy = mid.y - st.startMid.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) st.moved = true;
      let next: ViewBox = { ...st.startVb, x: st.startVb.x - dx * scale, y: st.startVb.y - dy * scale };
      if (pts.length > 1 && st.startDist > 0) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const factor = dist / st.startDist;
        const p = toSvg(mid.x, mid.y, next);
        next = { x: p.x - (p.x - next.x) / factor, y: p.y - (p.y - next.y) / factor, w: next.w / factor, h: next.h / factor };
        st.moved = true;
      }
      setVb(clamp(next));
    },
    [clamp, toSvg],
  );

  const onPointerUp = useCallback((e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (dragState.current?.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
    if (pointers.current.size === 0) dragState.current = null;
  }, []);

  const reset = useCallback(() => setVb(full), [full]);

  const centerOn = useCallback(
    (x: number, y: number, zoom = 3) => {
      const w = full.w / zoom;
      const h = full.h / zoom;
      setVb(clamp({ x: x - w / 2, y: y - h / 2, w, h }));
    },
    [full, clamp],
  );

  useEffect(() => setVb(full), [full]);

  return { vb, svgRef, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }, zoomAt, reset, centerOn, suppressClick };
}
