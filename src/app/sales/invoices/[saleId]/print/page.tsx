"use client";

import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { MapPin, MessageCircle, Phone, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { amountInWordsFromPaise } from "@/lib/amount-in-words";
import { BUSINESS_PROFILE_DEFAULTS } from "@/lib/business-profile-defaults";
import { withGstStateCode } from "@/lib/gst-state-codes";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const PAYMENT_MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  old_gold_exchange: "Old Gold / Silver Exchange",
};

const DOCUMENT_TITLE: Record<string, string> = {
  quotation: "Quotation",
  proforma_invoice: "Proforma Invoice",
  sales_return: "Sales Return",
  credit_note: "Credit Note",
  delivery_challan: "Delivery Challan",
  sales_order: "Sales Order",
};

const TEMPLATES = [
  { value: "half-a4", label: "A5 Landscape · NRK Invoice" },
  { value: "full-a4", label: "A4 Landscape" },
  { value: "thermal", label: "Thermal Receipt" },
] as const;

/** The A5 item table always reserves this many row slots so the totals/footer below it land in the same place regardless of item count — unfilled slots are blank, not bordered. Kept low enough to leave real margin below the 138mm page budget for what a physical printer adds (most browsers print a URL/date header and page-number footer by default unless that's turned off in the print dialog). */
const MIN_INVOICE_ITEM_ROWS = 5;

/** Printed invoice amounts use whole rupees; weight values keep their precision. */
function formatPaise(paise: number) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

type Template = (typeof TEMPLATES)[number]["value"];

function whatsAppShareUrl(
  phone: string | undefined,
  invoiceNumber: string,
  totalPaise: number,
) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  const message = `Hello, here is your invoice ${invoiceNumber} for ${formatPaise(totalPaise)} from NRK Jewellers. Thank you for your business!`;
  const base = withCountryCode
    ? `https://wa.me/${withCountryCode}`
    : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

/** Capture at paper width, independent of phone viewport, and fit the complete image to the PDF. */
async function renderInvoicePdf(
  node: HTMLElement,
  invoiceNumber: string,
  template: Template,
) {
  const [{ default: html2canvas }, { createInvoicePdf }] = await Promise.all([
    import("html2canvas-pro"),
    import("@/lib/invoice-pdf"),
  ]);
  const widthMm =
    template === "full-a4" ? 289 : template === "half-a4" ? 200 : 76;
  const widthPx = (widthMm * 96) / 25.4;
  const protectedRanges: Array<{ start: number; end: number }> = [];
  await document.fonts.ready;
  await Promise.all(
    Array.from(node.querySelectorAll("img")).map((img) =>
      img.decode().catch(() => undefined),
    ),
  );
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    windowWidth: Math.ceil(widthPx + 64),
    scrollX: 0,
    scrollY: 0,
    onclone: (_document, clonedNode) => {
      clonedNode.style.width = `${widthPx}px`;
      clonedNode.style.maxWidth = "none";
      clonedNode.style.zoom = "1";
      const bounds = clonedNode.getBoundingClientRect();
      clonedNode
        .querySelectorAll("tr, [data-pdf-keep-together]")
        .forEach((element) => {
          const rect = element.getBoundingClientRect();
          protectedRanges.push({
            start: (rect.top - bounds.top) * 2,
            end: (rect.bottom - bounds.top) * 2,
          });
        });
    },
  });
  const pdf = createInvoicePdf(
    {
      dataUrl: canvas.toDataURL("image/jpeg", 0.96),
      width: canvas.width,
      height: canvas.height,
    },
    template,
    protectedRanges,
  );
  return new File([pdf.output("blob")], `${invoiceNumber}.pdf`, {
    type: "application/pdf",
  });
}

export default function PrintInvoicePage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  const { saleId } = use(params);
  const searchParams = useSearchParams();
  const autoShare = searchParams.get("autoShare") === "1";
  const data = useQuery(api.sales.getInvoiceData, {
    saleId: saleId as Id<"sales">,
  });
  const [template, setTemplate] = useState<Template>("half-a4");
  const [sharing, setSharing] = useState(false);
  const [useHighResolutionLogo, setUseHighResolutionLogo] = useState(false);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  // Fit the layout to the selected paper's printable height to avoid splitting a bill.
  const [fitZoom, setFitZoom] = useState(1);

  // Browsers only allow opening a share sheet / popup from a real user gesture, so coming here
  // from the "WhatsApp Share [F4]" shortcut can't fire the share itself — it focuses the button
  // instead, so one more Enter/click finishes what the shortcut started.
  useEffect(() => {
    if (autoShare && data) shareButtonRef.current?.focus();
  }, [autoShare, data]);

  useEffect(() => {
    setUseHighResolutionLogo(false);
  }, [data?.logoUrl]);

  // Keep the entire full-A4 invoice on one landscape page. The whole layout
  // scales together when more rows are added so the totals and footer stay with it.
  useLayoutEffect(() => {
    if (template === "thermal" || !data) return;
    const node = invoiceRef.current;
    if (!node) return;
    // Measure an unconstrained copy so min-height/flex sizing cannot hide
    // overflow from the item rows being added to the invoice.
    const measureNode = node.cloneNode(true) as HTMLDivElement;
    measureNode.style.position = "fixed";
    measureNode.style.left = "-10000px";
    measureNode.style.top = "0";
    measureNode.style.visibility = "hidden";
    measureNode.style.zoom = "1";
    measureNode.style.minHeight = "0";
    measureNode.style.height = "auto";
    measureNode.style.maxHeight = "none";
    measureNode.style.justifyContent = "flex-start";
    document.body.appendChild(measureNode);
    const naturalHeightPx = Math.max(
      measureNode.scrollHeight,
      measureNode.getBoundingClientRect().height,
    );
    measureNode.remove();
    // Leave a few millimetres of safety for browser/printer printable-area
    // differences so the note and signature don't get pushed onto page two.
    const printableHeightPx = (template === "half-a4" ? 132 : 194) * (96 / 25.4);
    setFitZoom(Math.min(1, printableHeightPx / naturalHeightPx));
  }, [template, data]);

  if (data === undefined) {
    return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  }

  const {
    sale,
    items,
    customer,
    organization,
    logoUrl,
    oldGoldExchange,
    payments,
  } = data;
  const cashPayments = payments.filter((p) => p.mode !== "old_gold_exchange");
  const cashReceivedPaise = cashPayments.reduce(
    (sum, p) => sum + p.amountPaise,
    0,
  );
  const grandTotalNetPaise =
    sale.totalPaise - (oldGoldExchange?.exchangeValuePaise ?? 0);
  const balanceDuePaise = Math.max(0, sale.totalPaise - sale.amountPaidPaise);
  const paymentTypeLabel =
    cashPayments.length > 0
      ? [
          ...new Set(
            cashPayments.map((p) => PAYMENT_MODE_LABEL[p.mode] ?? p.mode),
          ),
        ].join(", ")
      : oldGoldExchange
        ? "Old Gold / Silver Exchange"
        : "Credit";

  async function handleShare() {
    if (!invoiceRef.current) return;
    // Desktop browsers lack navigator.share entirely — open the WhatsApp tab synchronously now
    // (within this click's user-gesture window) so the popup blocker doesn't eat it after the
    // PDF render below finishes asynchronously.
    const supportsFileShare =
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function";
    const fallbackWindow = supportsFileShare
      ? null
      : window.open("", "_blank", "noopener,noreferrer");
    const whatsAppUrl = whatsAppShareUrl(
      customer?.phone,
      sale.invoiceNumber,
      sale.totalPaise,
    );
    setSharing(true);
    try {
      const file = await renderInvoicePdf(
        invoiceRef.current,
        sale.invoiceNumber,
        template,
      );
      const message = `Hello, here is your invoice ${sale.invoiceNumber} for ${formatPaise(sale.totalPaise)} from NRK Jewellers. Thank you for your business!`;
      if (supportsFileShare && navigator.canShare?.({ files: [file] })) {
        fallbackWindow?.close();
        await navigator.share({
          files: [file],
          text: message,
          title: sale.invoiceNumber,
        });
        return;
      }
      // No native file-share support (most desktop browsers) — download the PDF and open WhatsApp with the message prefilled.
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      if (fallbackWindow) fallbackWindow.location.href = whatsAppUrl;
      else window.open(whatsAppUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        fallbackWindow?.close();
        return;
      }
      if (fallbackWindow) fallbackWindow.location.href = whatsAppUrl;
      else window.open(whatsAppUrl, "_blank", "noopener,noreferrer");
    } finally {
      setSharing(false);
    }
  }

  const widthClass =
    template === "thermal"
      ? "w-[76mm] text-xs"
      : template === "half-a4"
        ? "w-[200mm] text-sm"
        : "w-[289mm] min-h-[202mm] text-base";

  return (
    <div className="min-h-screen bg-muted/40 py-8 print:min-h-0 print:bg-white print:py-0">
      <style>{`
        @media print {
          html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          [data-invoice-sheet] {
            box-sizing: border-box;
            width: ${template === "half-a4" ? "200mm" : "289mm"} !important;
            min-height: 0 !important;
            max-height: none !important;
            margin: 0 auto;
            box-shadow: none;
            break-inside: avoid;
            page-break-inside: avoid;
            background: #fff !important;
          }
          [data-invoice-sheet] thead { display: table-header-group; }
          [data-pdf-keep-together] { break-inside: avoid; }
        }
        [data-invoice-compact="true"] [data-invoice-items-table] th,
        [data-invoice-compact="true"] [data-invoice-items-table] td {
          padding: 1mm 0.7mm !important;
          font-size: 7pt !important;
        }
        [data-invoice-compact="true"] [data-pdf-keep-together] > div {
          padding: 1.2mm !important;
        }
        @page { size: ${template === "thermal" ? "80mm auto" : template === "half-a4" ? "A5 landscape" : "A4 landscape"}; margin: ${template === "thermal" ? "2mm" : template === "half-a4" ? "5mm" : "4mm"}; }
      `}</style>

      <div className="mx-auto flex max-w-[297mm] items-center justify-between px-4 pb-4 print:hidden">
        <Select
          value={template}
          onValueChange={(v) => setTemplate(v as Template)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            ref={shareButtonRef}
            variant="outline"
            onClick={handleShare}
            disabled={sharing}
            title="Shares the actual invoice PDF — opens your device's share sheet (WhatsApp, etc.)"
          >
            <MessageCircle className="h-4 w-4" />
            {sharing ? "Preparing PDF…" : "Share via WhatsApp"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        {template !== "thermal" ? (
          <div
            ref={invoiceRef}
            data-invoice-sheet
            data-invoice-compact={template === "half-a4" ? "true" : undefined}
            style={{ zoom: fitZoom }}
            className={`mx-auto flex flex-col bg-white text-[#13253f] ${template === "half-a4" ? "min-h-[138mm] gap-1 p-2" : "min-h-[202mm] gap-3 p-4"} ${widthClass}`}
          >
            <h1 className={`-mb-1 text-center font-bold tracking-[0.3em] text-[#13253f] ${template === "half-a4" ? "text-lg" : "text-2xl"}`}>{DOCUMENT_TITLE[sale.documentType] ?? "Invoice"}</h1>
            {sale.status === "cancelled" && (
              <p className="text-center font-bold text-red-700">
                CANCELLED · {sale.cancelReason}
              </p>
            )}
            <div className={`flex items-center justify-between border border-[#655c36] border-l-4 border-l-[#655c36] bg-[#f8f5ea] ${template === "half-a4" ? "gap-2 px-2 py-1" : "gap-5 px-4 py-3"}`}>
              <div className={`flex min-w-0 flex-1 ${template === "half-a4" ? "items-center gap-2" : "items-center gap-5"}`}>
                <div className={`flex shrink-0 flex-col items-center justify-center bg-white px-2 py-1 ${template === "half-a4" ? "w-[32mm]" : "w-[43mm] pr-4"}`}>
                  {
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={useHighResolutionLogo ? "/nrk-logo-gold.png" : logoUrl || "/nrk-logo-gold.png"}
                      alt="NRK Jewellers logo"
                      onLoad={(event) => {
                        if (event.currentTarget.naturalWidth < 1200 && logoUrl && !useHighResolutionLogo) {
                          setUseHighResolutionLogo(true);
                        }
                      }}
                      onError={() => setUseHighResolutionLogo(true)}
                      className={`shrink-0 object-contain ${template === "half-a4" ? "h-[16mm] w-[28mm]" : "h-[23mm] w-[38mm]"}`}
                    />
                  }
                <p className={`mt-1 text-center font-serif italic text-[#655c36] ${template === "half-a4" ? "text-[9px]" : "text-base"}`}>
                    {organization?.motto || BUSINESS_PROFILE_DEFAULTS.motto}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`font-extrabold tracking-tight text-[#13253f] ${template === "half-a4" ? "text-xl" : "text-3xl"}`}>
                    {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
                  </h2>
                  <p className={`font-bold text-[#13253f] ${template === "half-a4" ? "text-[10px]" : "text-lg"}`}>
                    {organization?.tagline || BUSINESS_PROFILE_DEFAULTS.tagline}
                  </p>
                  <p className={`flex items-center gap-1 text-gray-600 ${template === "half-a4" ? "text-[8px]" : "text-sm"}`}>
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-pre-line">
                      {organization?.address || BUSINESS_PROFILE_DEFAULTS.address}
                    </span>
                  </p>
                  <p className={`flex items-center gap-1 text-gray-600 ${template === "half-a4" ? "text-[8px]" : "text-sm"}`}>
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {organization?.phone || BUSINESS_PROFILE_DEFAULTS.phone}
                  </p>
                </div>
              </div>
              {
                <p className={`shrink-0 self-start rounded-full border border-[#655c36]/40 bg-white font-semibold text-[#13253f] ${template === "half-a4" ? "px-2 py-1 text-[8px]" : "px-3 py-1.5 text-sm"}`}>
                  State: {withGstStateCode(organization?.state || BUSINESS_PROFILE_DEFAULTS.state)}
                </p>
              }
            </div>

            <div className={`grid grid-cols-[3fr_1fr] ${template === "half-a4" ? "gap-1" : "gap-3"}`}>
              <div className={`border border-[#655c36] border-l-4 border-l-[#655c36] bg-[#f4f0df] ${template === "half-a4" ? "p-2" : "p-3"}`}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#655a46]">Bill To</p>
                <p className={`font-bold text-[#28231b] ${template === "half-a4" ? "text-sm" : "text-lg"}`}>{customer?.name}</p>
                {customer?.phone && (
                  <p className={`text-gray-600 ${template === "half-a4" ? "text-[9px]" : "text-sm"}`}>{customer.phone}</p>
                )}
                {customer?.gstin && (
                  <p className={`text-gray-600 ${template === "half-a4" ? "text-[9px]" : "text-sm"}`}>
                    GSTIN: {customer.gstin}
                  </p>
                )}
              </div>
              <div className={`border border-[#655c36] bg-[#f8f5ea] ${template === "half-a4" ? "p-2 text-[9px]" : "p-3"}`}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#655a46]">Invoice Details</p>
                <p className="font-bold text-[#28231b]">No.: {sale.invoiceNumber}</p>
                <p>
                  Date: {new Date(sale.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>

            <table className="w-full table-fixed border-collapse border border-[#655c36] leading-tight" data-invoice-items-table>
              <colgroup>
                {(sale.isGst
                  ? ["5%", "20%", "10%", "6%", "9%", "9%", "10%", "11%", "10%", "10%"]
                  : ["5%", "24%", "12%", "6%", "10%", "10%", "11%", "11%", "11%"]
                ).map((width, index) => <col key={index} style={{ width }} />)}
              </colgroup>
              <thead>
                <tr className="bg-[#f4f0df] text-center font-bold text-[#13253f]">
                  <th className="border border-[#655c36] px-1 py-2">Sl.No</th>
                  <th className="border border-[#655c36] px-1 py-2 text-left">
                    Description
                  </th>
                  <th className="border border-[#655c36] px-1 py-2">Purity</th>
                  <th className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                    Qty
                  </th>
                  <th className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                    Gross Wt
                  </th>
                  <th className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                    Net Wt
                  </th>
                  <th className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                    Rate(₹)
                  </th>
                  <th className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                    Making(₹)
                  </th>
                  {sale.isGst && (
                    <th className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                      Tax(₹)
                    </th>
                  )}
                  <th className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                    Total(₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item._id}>
                    <td className="border border-[#655c36] px-1 py-2">
                      {i + 1}
                    </td>
                    <td className="border border-[#655c36] px-1 py-2">
                      {item.label}
                    </td>
                    <td className="border border-[#655c36] px-1 py-2">
                      {item.purityLabel ?? "—"}
                    </td>
                    <td className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                      1
                    </td>
                    <td className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                      {mgToGramsDisplay(item.grossWeightMg)}
                    </td>
                    <td className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                      {mgToGramsDisplay(item.netWeightMg)}
                    </td>
                    <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatPaise(item.ratePerGramPaise)}
                    </td>
                    <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatPaise(item.makingChargePaise)}
                    </td>
                    {sale.isGst && (
                      <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                        {formatPaise(item.lineTaxPaise)}
                      </td>
                    )}
                    <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatPaise(item.lineTotalPaise)}
                    </td>
                  </tr>
                ))}
                {/* Blank filler rows reserve the same table height regardless of item
                    count, so the totals/footer below never shift up or down. The
                    column guides (vertical borders) carry through so it still reads
                    as the same table, but there are no horizontal row lines across
                    the blank space — just empty space within the columns. */}
                {Array.from({ length: Math.max(0, MIN_INVOICE_ITEM_ROWS - items.length) }, (_, i) => (
                  <tr key={`blank-${i}`}>
                    {Array.from({ length: sale.isGst ? 10 : 9 }, (_, col) => (
                      <td key={col} className="border-x border-[#655c36] px-1 py-2">
                        &nbsp;
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-[#f4f0df] font-bold">
                  <td className="border border-[#655c36] px-1 py-2" colSpan={3}>
                    Sub Total
                  </td>
                  <td className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                    {items.length}
                  </td>
                  <td className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                    {mgToGramsDisplay(
                      items.reduce((sum, i) => sum + i.grossWeightMg, 0),
                    )}
                  </td>
                  <td className="border border-[#655c36] px-1 py-2 text-center whitespace-nowrap tabular-nums">
                    {mgToGramsDisplay(
                      items.reduce((sum, i) => sum + i.netWeightMg, 0),
                    )}
                  </td>
                  <td className="border border-[#655c36] px-1 py-2" />
                  <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatPaise(
                      items.reduce((sum, i) => sum + i.makingChargePaise, 0),
                    )}
                  </td>
                  {sale.isGst && (
                    <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatPaise(
                        items.reduce((sum, i) => sum + i.lineTaxPaise, 0),
                      )}
                    </td>
                  )}
                  <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatPaise(
                      items.reduce((sum, i) => sum + i.lineTotalPaise, 0),
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border border-[#655c36] px-1 py-2" colSpan={sale.isGst ? 7 : 6} />
                  <td className="whitespace-nowrap border border-[#655c36] bg-[#f4f0df] px-1 py-2 text-right text-[0.85em] font-semibold tracking-tight" colSpan={2}>
                    Discount
                  </td>
                  <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums font-semibold text-red-600">
                    -{formatPaise(sale.discountPaise)}
                  </td>
                </tr>
                {oldGoldExchange && (
                  <tr>
                    <td className="border border-[#655c36] px-1 py-2" colSpan={sale.isGst ? 7 : 6} />
                    <td className="whitespace-nowrap border border-[#655c36] bg-[#f4f0df] px-1 py-2 text-right text-[0.85em] font-semibold tracking-tight" colSpan={2}>
                      Old Item Deduction
                    </td>
                    <td className="border border-[#655c36] px-1 py-2 text-right whitespace-nowrap tabular-nums font-semibold text-red-600">
                      -{formatPaise(oldGoldExchange.exchangeValuePaise)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div
              data-pdf-keep-together
                className={`grid grid-cols-[1.9fr_1fr_1fr] ${template === "half-a4" ? "gap-1 text-[9px]" : "gap-3"}`}
            >
              <div className={`border border-[#655c36] ${template === "half-a4" ? "p-1.5" : "p-3"}`}>
                <p className="font-bold">Amount in words</p>
                <p>{amountInWordsFromPaise(grandTotalNetPaise)}</p>
              </div>
              <div className={`border border-[#655c36] ${template === "half-a4" ? "p-1.5" : "p-3"}`}>
                <p className="font-bold">Payment type</p>
                <p>{paymentTypeLabel}</p>
              </div>
              <div className={`flex flex-col border border-[#655c36] bg-[#f4f0df] ${template === "half-a4" ? "gap-0.5 p-1.5" : "gap-1 p-3"}`}>
                <div className={`flex justify-between border-b border-[#655c36]/20 pb-1 font-extrabold ${template === "half-a4" ? "text-[10px]" : "text-lg"}`}>
                  <span>Grand Total</span>
                  <span className="text-[#191919]">
                    {formatPaise(grandTotalNetPaise)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Amount received</span>
                  <span>{formatPaise(cashReceivedPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Balance due</span>
                  <span>{formatPaise(balanceDuePaise)}</span>
                </div>
              </div>
            </div>

            <div className={`flex items-end justify-between ${template === "half-a4" ? "gap-2 pt-1" : "gap-4 pt-6"}`}>
              <p className={`italic text-gray-600 ${template === "half-a4" ? "text-[7px]" : "text-xs"}`}>
                Note: If item was damaged no exchange and replacement
                allowed. Ensure your item before leaving shop.
              </p>
              <p className={`shrink-0 rounded-sm border-b-2 border-[#655c36] bg-white font-extrabold tracking-tight text-[#13253f] ${template === "half-a4" ? "mb-1 px-2 py-1 text-[10px]" : "mb-2 px-4 py-2 text-lg"}`}>
                For {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={invoiceRef}
            data-invoice-sheet
            style={{ zoom: template === "thermal" ? 1 : fitZoom }}
            className={`mx-auto flex flex-col gap-4 bg-white p-6 text-gray-900 shadow-sm print:shadow-none ${widthClass}`}
          >
            <div className="flex items-start justify-between border-b border-gray-200 pb-3">
              <div>
                <h1 className="text-lg font-semibold">
                  {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
                </h1>
                {organization?.address && (
                  <p className="whitespace-pre-line text-gray-500">
                    {organization.address}
                  </p>
                )}
                <p className="text-gray-500">
                  {organization?.phone && <>{organization.phone} · </>}
                  {organization?.gstin && <>GSTIN: {organization.gstin}</>}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {DOCUMENT_TITLE[sale.documentType] ?? "Invoice"}
                </p>
                <p className="text-gray-500">{sale.invoiceNumber}</p>
                <p className="text-gray-500">
                  {new Date(sale.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>

            <div>
              <p className="font-medium">Bill To</p>
              <p>{customer?.name}</p>
              {customer?.phone && (
                <p className="text-gray-500">{customer.phone}</p>
              )}
              {customer?.gstin && (
                <p className="text-gray-500">GSTIN: {customer.gstin}</p>
              )}
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-1">Item</th>
                  {template !== "thermal" && (
                    <th className="py-1 text-right">Gross Wt (g)</th>
                  )}
                  <th className="py-1 text-right">Net Wt (g)</th>
                  <th className="py-1 text-right">Rate/g</th>
                  {template !== "thermal" && (
                    <th className="py-1 text-right">Making</th>
                  )}
                  {sale.isGst && <th className="py-1 text-right">Tax</th>}
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id} className="border-b border-gray-200/60">
                    <td className="py-1">{item.label}</td>
                    {template !== "thermal" && (
                      <td className="py-1 text-right">
                        {mgToGramsDisplay(item.grossWeightMg)}
                      </td>
                    )}
                    <td className="py-1 text-right">
                      {mgToGramsDisplay(item.netWeightMg)}
                    </td>
                    <td className="py-1 text-right">
                      {formatPaise(item.ratePerGramPaise)}
                    </td>
                    {template !== "thermal" && (
                      <td className="py-1 text-right">
                        {formatPaise(item.makingChargePaise)}
                      </td>
                    )}
                    {sale.isGst && (
                      <td className="py-1 text-right">
                        {formatPaise(item.lineTaxPaise)}
                      </td>
                    )}
                    <td className="py-1 text-right">
                      {formatPaise(item.lineTotalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto flex w-full max-w-xs flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{formatPaise(sale.subtotalPaise)}</span>
              </div>
              {sale.discountPaise > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Discount</span>
                  <span>-{formatPaise(sale.discountPaise)}</span>
                </div>
              )}
              {sale.isGst && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Tax</span>
                  <span>{formatPaise(sale.taxPaise)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Round off</span>
                <span>{formatPaise(sale.roundOffPaise)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
                <span>Total</span>
                <span>{formatPaise(sale.totalPaise)}</span>
              </div>
              {oldGoldExchange && (
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    Old gold / silver exchange
                  </span>
                  <span>
                    -{formatPaise(oldGoldExchange.exchangeValuePaise)}
                  </span>
                </div>
              )}
              {payments.map((p) => (
                <div key={p._id} className="flex justify-between text-gray-500">
                  <span>Paid ({PAYMENT_MODE_LABEL[p.mode] ?? p.mode})</span>
                  <span>{formatPaise(p.amountPaise)}</span>
                </div>
              ))}
              <div className="flex justify-between font-medium">
                <span>Balance</span>
                <span>{formatPaise(balanceDuePaise)}</span>
              </div>
            </div>

            <p className="border-t border-gray-200 pt-2 text-gray-500">
              {amountInWordsFromPaise(sale.totalPaise)}
            </p>

            <p className="pt-4 text-center text-gray-500">
              Thank you for your business!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
