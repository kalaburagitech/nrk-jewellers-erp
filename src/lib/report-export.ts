import { jsPDF } from "jspdf";

export type ReportTable = {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  /** Column indexes that hold numbers (right-aligned in PDF). */
  numericColumns?: number[];
};

function escapeHtml(value: string | number) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Excel export as an HTML-table workbook (.xls). Excel and LibreOffice open it
 * directly with each table under its own heading — no spreadsheet library needed.
 * Numbers are written as numbers so totals/sums work in Excel.
 */
export function exportExcel(filename: string, heading: string, tables: ReportTable[]) {
  const body = tables
    .map(
      (table) => `
      <h3>${escapeHtml(table.title)}</h3>
      <table border="1" cellspacing="0" cellpadding="4">
        <thead><tr>${table.headers.map((h) => `<th style="background:#f3e8c8">${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${table.rows
          .map((row) => `<tr>${row.map((cell) => (typeof cell === "number" ? `<td x:num style="mso-number-format:'0.00'">${cell}</td>` : `<td>${escapeHtml(cell)}</td>`)).join("")}</tr>`)
          .join("")}</tbody>
      </table><br/>`,
    )
    .join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body><h2>${escapeHtml(heading)}</h2>${body}</body></html>`;
  triggerDownload(new Blob(["﻿", html], { type: "application/vnd.ms-excel" }), `${filename}.xls`);
}

/** Simple paginated table PDF (A4 landscape) with a heading block on the first page. */
export function exportPdf(filename: string, heading: string, subheading: string, tables: ReportTable[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(heading, margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(subheading, margin, y);
  y += 18;

  for (const table of tables) {
    const colCount = table.headers.length;
    const colWidth = (pageWidth - margin * 2) / colCount;
    const numeric = new Set(table.numericColumns ?? []);
    const rowHeight = 14;
    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };
    const drawHeader = () => {
      doc.setFillColor(243, 232, 200);
      doc.rect(margin, y - 10, pageWidth - margin * 2, rowHeight, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      table.headers.forEach((h, i) => {
        const x = margin + i * colWidth + 3;
        doc.text(fit(doc, h, colWidth - 6), numeric.has(i) ? x + colWidth - 6 : x, y, { align: numeric.has(i) ? "right" : "left" });
      });
      y += rowHeight;
      doc.setFont("helvetica", "normal");
    };

    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(table.title, margin, y);
    y += 14;
    drawHeader();
    if (table.rows.length === 0) {
      doc.setFontSize(8);
      doc.text("No records in this period.", margin + 3, y);
      y += rowHeight;
    }
    for (const row of table.rows) {
      if (y + rowHeight > pageHeight - margin) {
        doc.addPage();
        y = margin + 10;
        drawHeader();
      }
      doc.setFontSize(8);
      row.forEach((cell, i) => {
        const text = typeof cell === "number" ? cell.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(cell);
        const x = margin + i * colWidth + 3;
        doc.text(fit(doc, text, colWidth - 6), numeric.has(i) ? x + colWidth - 6 : x, y, { align: numeric.has(i) ? "right" : "left" });
      });
      doc.setDrawColor(230);
      doc.line(margin, y + 4, pageWidth - margin, y + 4);
      y += rowHeight;
    }
    y += 16;
  }
  doc.save(`${filename}.pdf`);
}

function fit(doc: jsPDF, text: string, width: number) {
  if (doc.getTextWidth(text) <= width) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > width) out = out.slice(0, -1);
  return `${out}…`;
}

/** Indian financial years (1 Apr – 31 Mar) as UTC ranges, newest first. */
export function financialYears(count = 6, now = new Date()) {
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const start = year - i;
    return {
      key: `FY${start}-${String((start + 1) % 100).padStart(2, "0")}`,
      label: `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`,
      startDate: Date.UTC(start, 3, 1),
      endDate: Date.UTC(start + 1, 2, 31, 23, 59, 59, 999),
    };
  });
}
