import { jsPDF } from "jspdf";
export type InvoiceTemplate = "full-a4" | "half-a4" | "thermal";
export type ProtectedRange = { start: number; end: number };
export function invoicePaper(
  template: InvoiceTemplate,
  imageWidth: number,
  imageHeight: number,
) {
  if (
    ![imageWidth, imageHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("Invoice image dimensions must be positive");
  if (template === "thermal")
    return {
      width: 80,
      height: Math.max(100, (76 * imageHeight) / imageWidth + 4),
      margin: 2,
    };
  if (template === "half-a4") return { width: 148, height: 210, margin: 10 };
  return { width: 297, height: 210, margin: 10 };
}
/** Page slices are contiguous; short rows and the totals block stay together. */
export function invoicePageSlices(
  height: number,
  capacity: number,
  protectedRanges: ProtectedRange[] = [],
) {
  const slices: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < height;) {
    let end = Math.min(height, start + capacity);
    if (end < height) {
      const crossing = protectedRanges.filter(
        (range) => range.start < end && range.end > end && range.start > start,
      );
      if (crossing.length)
        end = Math.min(...crossing.map((range) => range.start));
    }
    slices.push({ start, end });
    start = end;
  }
  return slices;
}
export function createInvoicePdf(
  image: { dataUrl: string; width: number; height: number },
  template: InvoiceTemplate,
  protectedRanges: ProtectedRange[] = [],
) {
  const paper = invoicePaper(template, image.width, image.height);
  // jsPDF defaults to portrait and swaps custom dimensions unless orientation is explicit.
  const pdf = new jsPDF({
    unit: "mm",
    orientation: paper.width > paper.height ? "landscape" : "portrait",
    format: [paper.width, paper.height],
    compress: true,
  });
  const width = pdf.internal.pageSize.getWidth() - paper.margin * 2;
  const availableHeight = pdf.internal.pageSize.getHeight() - paper.margin * 2;
  const mmPerPixel = width / image.width;
  const slices = invoicePageSlices(
    image.height,
    availableHeight / mmPerPixel,
    protectedRanges,
  );
  slices.forEach((slice, index) => {
    if (index > 0)
      pdf.addPage(
        [paper.width, paper.height],
        paper.width > paper.height ? "landscape" : "portrait",
      );
    pdf.saveGraphicsState();
    pdf.rect(
      paper.margin,
      paper.margin,
      width,
      (slice.end - slice.start) * mmPerPixel,
    );
    pdf.clip();
    pdf.discardPath();
    pdf.addImage(
      image.dataUrl,
      paper.margin,
      paper.margin - slice.start * mmPerPixel,
      width,
      image.height * mmPerPixel,
      "invoice",
      "FAST",
    );
    pdf.restoreGraphicsState();
  });
  return pdf;
}
