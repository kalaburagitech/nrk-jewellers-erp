"use client";

import { use, useEffect, useRef, useState } from "react";
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
import { PAPER, PrintPageStyle, useFitToPaper } from "@/components/print-sheet";

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
  { value: "half-a4", label: "A5 Landscape · NRK Invoice (Default)" },
  { value: "full-a4", label: "A4 Landscape" },
  { value: "thermal", label: "Thermal Receipt" },
] as const;

/** The item table always reserves this many row slots so the totals/footer below it land in the same place regardless of item count — unfilled slots are blank, not bordered. Kept low so a GST bill (with its CGST/SGST/IGST lines) still fits one A5 sheet without shrinking much. */
const MIN_INVOICE_ITEM_ROWS = 5;

/** Printed invoice amounts use whole rupees; weight values keep their precision. */
function formatPaise(paise: number) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** GST lines print to the paisa so CGST + SGST add up exactly. */
function formatPaiseExact(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 150 → " @ 1.5%", 300 → " @ 3.0%"; nothing when lines were taxed at different rates. */
function rateLabel(basisPoints: number | undefined) {
  return basisPoints === undefined ? "" : ` @ ${(basisPoints / 100).toFixed(basisPoints % 10 ? 2 : 1)}%`;
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
  fitZoom: number,
) {
  const [{ default: html2canvas }, { createInvoicePdf }] = await Promise.all([
    import("html2canvas-pro"),
    import("@/lib/invoice-pdf"),
  ]);
  const widthMm =
    template === "full-a4" ? PAPER.a4.widthMm : template === "half-a4" ? PAPER.a5.widthMm : 76;
  // Capture at the same widened layout the printer gets, so PDF and paper match.
  const widthPx = ((template === "thermal" ? widthMm : widthMm / fitZoom) * 96) / 25.4;
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
  const preferences = useQuery(api.appPreferences.get);
  const showGstin = preferences?.printGstin ?? true;
  // Until the user picks a size here, follow the shop default from Settings → Print.
  const [chosenTemplate, setTemplate] = useState<Template | null>(null);
  const template: Template = chosenTemplate ?? preferences?.defaultPrintTemplate ?? "half-a4";
  const [sharing, setSharing] = useState(false);
  // Which uploaded logo URL failed to load (then the bundled logo is shown); a new logo URL starts fresh automatically.
  const [logoFallbackFor, setLogoFallbackFor] = useState<string | null>(null);
  const useHighResolutionLogo = logoFallbackFor !== null && logoFallbackFor === (data?.logoUrl ?? "");
  const setUseHighResolutionLogo = (value: boolean) => setLogoFallbackFor(value ? (data?.logoUrl ?? "") : null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const paper = template === "thermal" ? null : template === "half-a4" ? PAPER.a5 : PAPER.a4;
  // Keeps the whole bill on one A5 (or A4) sheet at full paper width.
  const fit = useFitToPaper(invoiceRef, paper, [data]);

  // Browsers only allow opening a share sheet / popup from a real user gesture, so coming here
  // from the "WhatsApp Share [F4]" shortcut can't fire the share itself — it focuses the button
  // instead, so one more Enter/click finishes what the shortcut started.
  useEffect(() => {
    if (autoShare && data) shareButtonRef.current?.focus();
  }, [autoShare, data]);



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
    gst,
  } = data;
  const cashPayments = payments.filter((p) => p.mode !== "old_gold_exchange");
  const cashReceivedPaise = cashPayments.reduce(
    (sum, p) => sum + p.amountPaise,
    0,
  );
  const grandTotalNetPaise =
    sale.totalPaise - (oldGoldExchange?.exchangeValuePaise ?? 0);
  const balanceDuePaise = Math.max(0, sale.totalPaise - sale.amountPaidPaise);
  const compact = template === "half-a4";
  const cellPad = compact ? "px-1 py-1" : "px-2 py-2";
  const cell = `${cellPad} border border-[#6e5d3a] whitespace-nowrap tabular-nums`;
  const boxPad = compact ? "px-1.5 py-1" : "px-3 py-2";
  const totalPieces = items.reduce((sum, i) => sum + (i.pieces ?? 1), 0);
  const totalGrossMg = items.reduce((sum, i) => sum + i.grossWeightMg, 0);
  const totalNetMg = items.reduce((sum, i) => sum + i.netWeightMg, 0);
  const totalMakingPaise = items.reduce((sum, i) => sum + i.makingChargePaise, 0);
  // "(GST 3%)" when every line was taxed at one rate.
  const totalGstBp = gst?.rates
    ? gst.igstPaise > 0 ? gst.rates.igstBasisPoints : gst.rates.cgstBasisPoints + gst.rates.sgstBasisPoints
    : undefined;
  const totalGstLabel = totalGstBp ? ` (GST ${totalGstBp / 100}%)` : "";
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
        fit.zoom,
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
        ? "w-[202mm] text-sm"
        : "w-[289mm] min-h-[202mm] text-base";

  return (
    <div className="min-h-screen bg-muted/40 py-8 print:min-h-0 print:bg-white print:py-0">
      <style>{`
        @media print {
          html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          [data-invoice-sheet] {
            box-sizing: border-box;
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
        ${template === "thermal" ? "@page { size: 80mm auto; margin: 2mm; }" : ""}
      `}</style>
      {paper && <PrintPageStyle paper={paper} />}

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
            <Printer className="h-4 w-4 mr-1.5" />
            Print A5 Invoice
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        {template !== "thermal" ? (
          <div
            ref={invoiceRef}
            data-invoice-sheet
            data-print-sheet
            data-invoice-compact={compact ? "true" : undefined}
            style={fit.style}
            className={`mx-auto flex flex-col border-2 border-[#6e5d3a] bg-white text-[#13253f] ${compact ? "min-h-[140mm] gap-1 p-1.5" : "min-h-[202mm] gap-3 p-4"} ${widthClass}`}
          >
            <h1 className={`text-center font-bold tracking-[0.35em] text-[#13253f] ${compact ? "-mb-0.5 text-xl" : "text-3xl"}`}>{DOCUMENT_TITLE[sale.documentType] ?? "Invoice"}</h1>
            {sale.status === "cancelled" && (
              <p className="text-center font-bold text-red-700">
                CANCELLED · {sale.cancelReason}
              </p>
            )}

            {/* Shop header card: logo + motto, name, tagline, address, phone; state top-right. */}
            <div className={`flex items-center justify-between border border-[#8a7a55] border-l-4 border-l-[#6e5d3a] bg-[#f6f1e3] ${compact ? "gap-2 px-2 py-1" : "gap-5 px-4 py-3"}`}>
              <div className={`flex min-w-0 flex-1 items-center ${compact ? "gap-3" : "gap-6"}`}>
                <div className={`flex shrink-0 flex-col items-center justify-center bg-white ${compact ? "w-[30mm] py-0.5" : "w-[42mm] py-1.5"}`}>
                  {
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={useHighResolutionLogo ? "/nrk-logo-gold.png" : logoUrl || "/nrk-logo-gold.png"}
                      alt="NRK Jewellers logo"
                      onError={() => setUseHighResolutionLogo(true)}
                      className={`shrink-0 object-contain ${compact ? "h-[15mm] w-[26mm]" : "h-[23mm] w-[38mm]"}`}
                    />
                  }
                  <p className={`mt-0.5 text-center font-serif italic text-[#8a6d2b] ${compact ? "text-[8px]" : "text-sm"}`}>
                    {organization?.motto || BUSINESS_PROFILE_DEFAULTS.motto}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`font-extrabold tracking-tight text-[#13253f] ${compact ? "text-xl" : "text-3xl"}`}>
                    {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
                  </h2>
                  <p className={`font-bold text-[#13253f] ${compact ? "text-[10px]" : "text-lg"}`}>
                    {organization?.tagline || BUSINESS_PROFILE_DEFAULTS.tagline}
                  </p>
                  <p className={`flex items-start gap-1.5 whitespace-pre-line text-[#2b3a52] ${compact ? "text-[8px]" : "text-sm"}`}>
                    <MapPin className={`shrink-0 text-[#6e5d3a] ${compact ? "mt-px h-2.5 w-2.5" : "mt-0.5 h-4 w-4"}`} aria-hidden />
                    <span>{organization?.address || BUSINESS_PROFILE_DEFAULTS.address}</span>
                  </p>
                  <p className={`flex items-center gap-1.5 text-[#2b3a52] ${compact ? "text-[8px]" : "text-sm"}`}>
                    <Phone className={`shrink-0 text-[#6e5d3a] ${compact ? "h-2.5 w-2.5" : "h-4 w-4"}`} aria-hidden />
                    <span>{organization?.phone || BUSINESS_PROFILE_DEFAULTS.phone}</span>
                  </p>
                  {showGstin && sale.isGst && organization?.gstin && (
                    <p className={`font-semibold text-[#2b3a52] ${compact ? "text-[8px]" : "text-sm"}`}>GSTIN: {organization.gstin}</p>
                  )}
                </div>
              </div>
              <p className={`shrink-0 self-start rounded-full border border-[#8a7a55] bg-white font-semibold text-[#13253f] ${compact ? "px-2 py-0.5 text-[8px]" : "px-3 py-1.5 text-sm"}`}>
                State: {sale.isGst
                  ? withGstStateCode(organization?.state || BUSINESS_PROFILE_DEFAULTS.state)
                  : organization?.state || BUSINESS_PROFILE_DEFAULTS.state}
              </p>
            </div>

            {/* Bill To | Invoice Details */}
            <div className={`grid grid-cols-[2fr_1fr] ${compact ? "gap-1 text-[9px]" : "gap-2"}`}>
              <div className={`border border-[#8a7a55] border-l-4 border-l-[#6e5d3a] bg-[#f6f1e3] ${compact ? "px-2 py-1" : "p-3"}`}>
                <p className={`font-bold uppercase tracking-wide text-[#6e5d3a] ${compact ? "text-[9px]" : "text-base"}`}>Bill To</p>
                <p className={`font-bold text-[#13253f] ${compact ? "text-sm" : "text-xl"}`}>{customer?.name}</p>
                {customer?.phone && <p className="text-[#2b3a52]">{customer.phone}</p>}
                {showGstin && customer?.gstin && <p>GSTIN: {customer.gstin}</p>}
              </div>
              <div className={`border border-[#8a7a55] bg-[#f6f1e3] ${compact ? "px-2 py-1" : "p-3"}`}>
                <p className={`font-bold uppercase tracking-wide text-[#6e5d3a] ${compact ? "text-[9px]" : "text-base"}`}>Invoice Details</p>
                <p className="font-bold">No.: {sale.invoiceNumber}</p>
                <p>Date: {new Date(sale.createdAt).toLocaleDateString("en-IN")}</p>
              </div>
            </div>

            <table className="w-full table-fixed border-collapse border-2 border-[#6e5d3a] bg-white leading-tight" data-invoice-items-table>
              <colgroup>
                {["6%", "22%", "8%", "6%", "12%", "12%", "11%", "10%", "13%"].map((width, index) => <col key={index} style={{ width }} />)}
              </colgroup>
              <thead>
                <tr className="bg-[#f3eedf] font-bold text-[#13253f]">
                  <th className={`${cell} text-center`}>Sl.No</th>
                  <th className={`${cell} text-left`}>Description</th>
                  <th className={`${cell} text-center`}>Purity</th>
                  <th className={`${cell} text-center`}>Qty</th>
                  <th className={`${cell} text-center`}>Gross Wt</th>
                  <th className={`${cell} text-center`}>Net Wt</th>
                  <th className={`${cell} text-right`}>Rate(₹)</th>
                  <th className={`${cell} text-right`}>Making(₹)</th>
                  <th className={`${cell} text-right`}>Total(₹)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item._id}>
                    <td className={`${cell} text-center`}>{i + 1}</td>
                    <td className={`${cell} whitespace-normal`}>
                      {item.label}
                      {sale.isGst && item.hsnCode && (
                        <span className="block text-[0.8em] text-[#6e5d3a]">HSN {item.hsnCode}</span>
                      )}
                    </td>
                    <td className={`${cell} text-center`}>{item.purityLabel ?? "—"}</td>
                    <td className={`${cell} text-center`}>{item.pieces ?? 1}</td>
                    <td className={`${cell} text-center`}>{mgToGramsDisplay(item.grossWeightMg)}</td>
                    <td className={`${cell} text-center`}>{mgToGramsDisplay(item.netWeightMg)}</td>
                    <td className={`${cell} text-right`}>
                      {item.unitPricePaise ? `${formatPaise(item.unitPricePaise)}/pc` : formatPaise(item.ratePerGramPaise)}
                    </td>
                    <td className={`${cell} text-right`}>{formatPaise(item.makingChargePaise)}</td>
                    {/* Before tax: GST is shown once, in the tax box below. */}
                    <td className={`${cell} text-right`}>{formatPaise(item.lineTotalPaise - item.lineTaxPaise)}</td>
                  </tr>
                ))}
                {/* Blank filler rows keep the totals below in the same place whatever the item count. */}
                {Array.from({ length: Math.max(0, MIN_INVOICE_ITEM_ROWS - items.length) }, (_, i) => (
                  <tr key={`blank-${i}`}>
                    {Array.from({ length: 9 }, (_, col) => (
                      <td key={col} className={`${cellPad} border-x border-[#6e5d3a]`}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-[#f3eedf] font-bold">
                  <td className={cell} colSpan={3}>Sub Total</td>
                  <td className={`${cell} text-center`}>{totalPieces}</td>
                  <td className={`${cell} text-center`}>{mgToGramsDisplay(totalGrossMg)}</td>
                  <td className={`${cell} text-center`}>{mgToGramsDisplay(totalNetMg)}</td>
                  <td className={cell} />
                  <td className={`${cell} text-right`}>{formatPaise(totalMakingPaise)}</td>
                  <td className={`${cell} text-right`}>{formatPaise(sale.subtotalPaise)}</td>
                </tr>
                {[
                  ...(gst ? [{ label: `Tax${totalGstLabel}`, value: formatPaiseExact(sale.taxPaise), less: false }] : []),
                  ...(sale.discountPaise > 0 ? [{ label: "Discount", value: `-${formatPaiseExact(sale.discountPaise)}`, less: true }] : []),
                  ...((sale.oldItemDeductionPaise ?? 0) > 0
                    ? [{ label: `Old Item Deduction${sale.oldItemDeductionNote ? ` (${sale.oldItemDeductionNote})` : ""}`, value: `-${formatPaiseExact(sale.oldItemDeductionPaise ?? 0)}`, less: true }]
                    : []),
                  ...(oldGoldExchange ? [{ label: "Old Gold / Silver Exchange", value: `-${formatPaiseExact(oldGoldExchange.exchangeValuePaise)}`, less: true }] : []),
                ].map((row) => (
                  <tr key={row.label}>
                    <td className={`${cellPad} border border-[#6e5d3a]`} colSpan={6} />
                    <td className={`${cellPad} border border-[#6e5d3a] bg-[#f3eedf] text-right font-semibold`} colSpan={2}>{row.label}</td>
                    <td className={`${cell} text-right font-semibold ${row.less ? "text-red-600" : ""}`}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Amount in words · payment type · GST breakup (GST bills only) · grand total. */}
            <div data-pdf-keep-together className={`grid items-stretch ${gst ? "grid-cols-[1.3fr_0.8fr_1fr_1fr]" : "grid-cols-[1.6fr_1fr_1.05fr]"} ${compact ? "gap-1 text-[9px]" : "gap-2"}`}>
              <div className={`border border-[#8a7a55] bg-white ${boxPad}`}>
                <p className="font-bold">Amount in words</p>
                <p>{amountInWordsFromPaise(grandTotalNetPaise)}</p>
              </div>
              <div className={`border border-[#8a7a55] bg-white ${boxPad}`}>
                <p className="font-bold">Payment type</p>
                <p>{paymentTypeLabel}</p>
              </div>

              {gst && (
                <div className={`border border-[#8a7a55] bg-white ${boxPad}`}>
                  <TotalsLine label="Taxable Value" value={formatPaiseExact(sale.subtotalPaise)} />
                  {(gst.cgstPaise > 0 || gst.igstPaise === 0) && (
                    <>
                      <TotalsLine label={`CGST${rateLabel(gst.rates?.cgstBasisPoints)}`} value={formatPaiseExact(gst.cgstPaise)} />
                      <TotalsLine label={`SGST${rateLabel(gst.rates?.sgstBasisPoints)}`} value={formatPaiseExact(gst.sgstPaise)} />
                    </>
                  )}
                  {gst.igstPaise > 0 && (
                    <TotalsLine label={`IGST${rateLabel(gst.rates?.igstBasisPoints)}`} value={formatPaiseExact(gst.igstPaise)} />
                  )}
                  <TotalsLine label={`Total Tax${totalGstLabel}`} value={formatPaiseExact(sale.taxPaise)} bold />
                </div>
              )}

              <div className={`border border-[#8a7a55] bg-[#f3eedf] ${boxPad}`}>
                <div className={`flex justify-between gap-2 border-b border-[#8a7a55] font-extrabold text-[#13253f] ${compact ? "pb-0.5 text-[11px]" : "pb-1.5 text-lg"}`}>
                  <span>Grand Total</span>
                  <span className="tabular-nums">{formatPaiseExact(grandTotalNetPaise)}</span>
                </div>
                <div className={`text-[#2b3a52] ${compact ? "pt-0.5" : "pt-1.5"}`}>
                  <TotalsLine label="Amount received" value={formatPaiseExact(cashReceivedPaise)} />
                  <TotalsLine label="Balance due" value={formatPaiseExact(balanceDuePaise)} />
                </div>
              </div>
            </div>

            <div className={`flex items-end justify-between gap-4 ${compact ? "pt-3" : "mt-auto pt-10"}`}>
              <p className={`italic text-[#2b3a52] ${compact ? "text-[7px]" : "text-xs"}`}>
                Note: If item was damaged no exchange and replacement allowed. Ensure your item before leaving shop.
              </p>
              <p className={`shrink-0 rounded-b-md border-b-2 border-[#6e5d3a] text-center font-bold text-[#13253f] ${compact ? "min-w-[45mm] pb-0.5 text-[10px]" : "min-w-[60mm] pb-1 text-lg"}`}>
                For {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={invoiceRef}
            data-invoice-sheet
            style={fit.style}
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
                  {showGstin && organization?.gstin && <>GSTIN: {organization.gstin}</>}
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
              {showGstin && customer?.gstin && (
                <p className="text-gray-500">GSTIN: {customer.gstin}</p>
              )}
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-1">Item</th>
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
                    <td className="py-1 text-right">
                      {mgToGramsDisplay(item.netWeightMg)}
                    </td>
                    <td className="py-1 text-right">
                      {item.unitPricePaise ? `${formatPaise(item.unitPricePaise)}/pc` : formatPaise(item.ratePerGramPaise)}
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
              <div className="flex justify-between">
                <span className="text-gray-500">Discount</span>
                <span>-{formatPaise(sale.discountPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Old item deduction{sale.oldItemDeductionNote ? ` (${sale.oldItemDeductionNote})` : ""}</span>
                <span>-{formatPaise(sale.oldItemDeductionPaise ?? 0)}</span>
              </div>
              {gst && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">CGST{rateLabel(gst.rates?.cgstBasisPoints)}</span>
                    <span>{formatPaiseExact(gst.cgstPaise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">SGST{rateLabel(gst.rates?.sgstBasisPoints)}</span>
                    <span>{formatPaiseExact(gst.sgstPaise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">IGST{rateLabel(gst.rates?.igstBasisPoints)}</span>
                    <span>{formatPaiseExact(gst.igstPaise)}</span>
                  </div>
                </>
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

function TotalsLine({ label, value, bold, less }: { label: string; value: string; bold?: boolean; less?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-bold" : "font-semibold"}`}>
      <span className="min-w-0 tracking-tight">{label}</span>
      <span className={`shrink-0 tabular-nums ${less ? "text-red-600" : ""}`}>{value}</span>
    </div>
  );
}
