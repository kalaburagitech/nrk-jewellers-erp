"use client";

import { useLayoutEffect, useState, type CSSProperties, type DependencyList, type RefObject } from "react";

/**
 * Paper presets for printed bills. Width/height are the printable area (paper
 * minus both margins); the height budget is the printable height less a few mm of
 * safety for printer/browser differences, so the signature line never spills
 * onto a second sheet.
 */
export const PAPER = {
  // A5 landscape = 210 × 148 mm → 202 × 140 mm printable at 4 mm margins.
  a5: { pageSize: "A5 landscape", marginMm: 4, widthMm: 202, heightMm: 140, heightBudgetMm: 134 },
  // A4 landscape = 297 × 210 mm → 289 × 202 mm printable at 4 mm margins.
  a4: { pageSize: "A4 landscape", marginMm: 4, widthMm: 289, heightMm: 202, heightBudgetMm: 194 },
} as const;
export type Paper = (typeof PAPER)[keyof typeof PAPER];

const PX_PER_MM = 96 / 25.4;

/** @page size/margin plus the print resets every bill needs. Render once per print page. */
export function PrintPageStyle({ paper }: { paper: Paper }) {
  return (
    <style>{`
      @page { size: ${paper.pageSize}; margin: ${paper.marginMm}mm; }
      @media print {
        html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
        /* A bill is one sheet: anything past the page is cut, never printed on a second sheet. */
        body { max-height: ${paper.heightMm - 1}mm !important; overflow: hidden !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        [data-print-sheet] { box-sizing: border-box; margin: 0 auto !important; box-shadow: none !important; min-height: 0 !important; break-inside: avoid; page-break-inside: avoid; }
      }
    `}</style>
  );
}

/**
 * Keeps a bill on one sheet. Measures the sheet at the paper's width; if it is
 * taller than the page, scales it down with CSS zoom while widening its layout
 * box by the same factor, so the printed result still spans the full paper
 * width (only shorter text), instead of shrinking into a narrow column.
 */
export function useFitToPaper(ref: RefObject<HTMLElement | null>, paper: Paper | null, deps: DependencyList) {
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    if (!paper) return;
    let cancelled = false;
    const measure = () => {
      const node = ref.current;
      if (!node || cancelled) return;
      // Measure an unconstrained copy so min-height/flex sizing cannot hide overflow.
      const copy = node.cloneNode(true) as HTMLElement;
      Object.assign(copy.style, {
        position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
        zoom: "1", width: `${paper.widthMm}mm`, maxWidth: "none",
        minHeight: "0", height: "auto", maxHeight: "none", justifyContent: "flex-start",
      });
      // Settings → "screen zoom" changes the root font size on screen only; measure at the
      // printed size (16px), or a zoomed-out screen measures short and the bill spills to page 2.
      const root = document.documentElement;
      const screenFontSize = root.style.fontSize;
      root.style.fontSize = "16px";
      document.body.appendChild(copy);
      const naturalPx = Math.max(copy.scrollHeight, copy.getBoundingClientRect().height);
      copy.remove();
      root.style.fontSize = screenFontSize;
      if (naturalPx > 0) setZoom(Math.min(1, (paper.heightBudgetMm * PX_PER_MM) / naturalPx));
    };
    measure();
    // Web fonts can change line heights after first paint.
    void document.fonts?.ready.then(measure);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, ...deps]);

  // Thermal/unsized layouts are never zoomed.
  const effectiveZoom = paper ? zoom : 1;
  const style: CSSProperties | undefined = paper
    ? { width: `${paper.widthMm / effectiveZoom}mm`, maxWidth: "none", zoom: effectiveZoom }
    : undefined;
  return { zoom: effectiveZoom, style };
}
