import { describe, expect, it } from "vitest";
import {
  createInvoicePdf,
  invoicePageSlices,
  invoicePaper,
} from "./invoice-pdf";
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
describe("invoice PDF export", () => {
  it("keeps a landscape invoice on A4 landscape instead of a portrait media box", () => {
    const pdf = createInvoicePdf(
      { dataUrl: pixel, width: 2246, height: 1400 },
      "full-a4",
    );
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(297, 1);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(210, 1);
    expect(pdf.getNumberOfPages()).toBe(1);
  });
  it("uses landscape A5 dimensions for half A4 and a full-length 80 mm receipt", () => {
    const half = createInvoicePdf(
      { dataUrl: pixel, width: 2000, height: 1000 },
      "half-a4",
    );
    expect(half.internal.pageSize.getWidth()).toBeCloseTo(210, 1);
    expect(half.internal.pageSize.getHeight()).toBeCloseTo(148, 1);
    const thermal = createInvoicePdf(
      { dataUrl: pixel, width: 760, height: 2000 },
      "thermal",
    );
    expect(thermal.internal.pageSize.getWidth()).toBeCloseTo(80, 1);
    expect(thermal.internal.pageSize.getHeight()).toBeCloseTo(204, 1);
    expect(thermal.getNumberOfPages()).toBe(1);
  });
  it("adds pages for long invoices without dropping the final content", () => {
    const pdf = createInvoicePdf(
      { dataUrl: pixel, width: 1000, height: 2500 },
      "full-a4",
    );
    expect(pdf.getNumberOfPages()).toBe(4);
    const slices = invoicePageSlices(2500, 600);
    expect(slices[0].start).toBe(0);
    expect(slices.at(-1)?.end).toBe(2500);
    slices
      .slice(1)
      .forEach((slice, i) => expect(slice.start).toBe(slices[i].end));
  });
  it("moves a row or totals block to the next page instead of splitting it", () => {
    expect(invoicePageSlices(1500, 700, [{ start: 650, end: 750 }])).toEqual([
      { start: 0, end: 650 },
      { start: 650, end: 1350 },
      { start: 1350, end: 1500 },
    ]);
  });
  it("still progresses when a single row exceeds one page", () => {
    expect(
      invoicePageSlices(1500, 700, [{ start: 0, end: 1500 }]),
    ).toHaveLength(3);
  });
  it("rejects invalid source image dimensions", () => {
    expect(() => invoicePaper("full-a4", 0, 1400)).toThrow("positive");
  });
});
