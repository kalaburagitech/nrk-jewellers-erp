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
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { amountInWordsFromPaise } from "@/lib/amount-in-words";
import { BUSINESS_PROFILE_DEFAULTS } from "@/lib/business-profile-defaults";
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
  { value: "full-a4", label: "A4 Landscape · Reference Layout" },
  { value: "half-a4", label: "Half A4" },
  { value: "thermal", label: "Thermal Receipt" },
] as const;

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
    template === "full-a4" ? 289 : template === "half-a4" ? 128 : 76;
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
  const [template, setTemplate] = useState<Template>("full-a4");
  const [sharing, setSharing] = useState(false);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);

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
        ? "w-[128mm] text-sm"
        : "w-[289mm] min-h-[202mm] text-base";

  return (
    <div className="min-h-screen bg-muted/40 py-8 print:min-h-0 print:bg-white print:py-0">
      <style>{`
        @media print {
          html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
          [data-invoice-sheet] { margin: 0 auto; box-shadow: none; }
          [data-invoice-sheet] thead { display: table-header-group; }
          [data-pdf-keep-together] { break-inside: avoid; }
        }
        @page { size: ${template === "thermal" ? "80mm auto" : template === "half-a4" ? "A5" : "A4 landscape"}; margin: ${template === "thermal" ? "2mm" : template === "half-a4" ? "10mm" : "4mm"}; }
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
        {template === "full-a4" ? (
          <div
            ref={invoiceRef}
            data-invoice-sheet
            className={`mx-auto flex min-h-[202mm] flex-col justify-between gap-3 bg-white p-4 text-[#13253f] ${widthClass}`}
          >
            {sale.status === "cancelled" && (
              <p className="text-center font-bold text-red-700">
                CANCELLED · {sale.cancelReason}
              </p>
            )}
            <h1 className="text-center text-3xl font-extrabold tracking-[0.16em] text-[#191919]">
              {DOCUMENT_TITLE[sale.documentType] ?? "Invoice"}
            </h1>

            <div className="flex items-center justify-between gap-5 border-2 border-[#78613a] border-l-[7px] bg-[#faf7ef] px-5 py-4">
              <div className="flex min-w-0 items-center gap-5">
                {
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl || "/nrk-logo-gold.png"}
                    alt="NRK Jewellers logo"
                    className="h-28 w-44 shrink-0 rounded-md border border-[#f1e6cd] bg-white p-2 object-contain"
                  />
                }
                <div className="min-w-0">
                  <h2 className="text-2xl font-extrabold tracking-tight text-[#28231b]">
                    {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
                  </h2>
                  <p className="text-lg font-semibold text-[#494033]">
                    {organization?.tagline || BUSINESS_PROFILE_DEFAULTS.tagline}
                  </p>
                  <p className="my-1 inline-block border-y border-[#bd974f]/60 py-1 font-serif text-xl italic text-[#8a6726]">
                    {organization?.motto || BUSINESS_PROFILE_DEFAULTS.motto}
                  </p>
                  {
                    <p className="flex items-center gap-1 text-sm text-gray-600">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="whitespace-pre-line">
                        {organization?.address || BUSINESS_PROFILE_DEFAULTS.address}
                      </span>
                    </p>
                  }
                  {
                    <p className="flex items-center gap-1 text-sm text-gray-600">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      {organization?.phone || BUSINESS_PROFILE_DEFAULTS.phone}
                    </p>
                  }
                </div>
              </div>
              {
                <p className="shrink-0 self-start rounded-full border border-[#ddcfad] bg-white px-3 py-1.5 text-sm font-semibold text-[#494033]">
                  State: {organization?.state || BUSINESS_PROFILE_DEFAULTS.state}
                </p>
              }
            </div>

            <div className="grid grid-cols-[3fr_1fr] gap-3">
              <div className="border border-[#78613a] border-l-4 border-l-[#bd974f] bg-[#fcfaf5] p-3">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#655a46]">Bill To</p>
                <p className="text-lg font-bold text-[#28231b]">{customer?.name}</p>
                {customer?.phone && (
                  <p className="text-sm text-gray-600">{customer.phone}</p>
                )}
                {customer?.gstin && (
                  <p className="text-sm text-gray-600">
                    GSTIN: {customer.gstin}
                  </p>
                )}
              </div>
              <div className="border border-[#78613a] bg-[#fcfaf5] p-3">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#655a46]">Invoice Details</p>
                <p className="font-bold text-[#28231b]">No.: {sale.invoiceNumber}</p>
                <p>
                  Date: {new Date(sale.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>

            <table className="w-full border-collapse border border-[#78613a] text-sm">
              <thead>
                <tr className="bg-[#f1e6cd] text-left text-[#28231b]">
                  <th className="border border-[#78613a] px-2 py-1">Sl.No</th>
                  <th className="border border-[#78613a] px-2 py-1">
                    Description
                  </th>
                  <th className="border border-[#78613a] px-2 py-1">Purity</th>
                  <th className="border border-[#78613a] px-2 py-1 text-right">
                    Qty
                  </th>
                  <th className="border border-[#78613a] px-2 py-1 text-right">
                    Gross Wt
                  </th>
                  <th className="border border-[#78613a] px-2 py-1 text-right">
                    Net Wt
                  </th>
                  <th className="border border-[#78613a] px-2 py-1 text-right">
                    Rate(₹)
                  </th>
                  <th className="border border-[#78613a] px-2 py-1 text-right">
                    Making(₹)
                  </th>
                  {sale.isGst && (
                    <th className="border border-[#78613a] px-2 py-1 text-right">
                      Tax(₹)
                    </th>
                  )}
                  <th className="border border-[#78613a] px-2 py-1 text-right">
                    Total(₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item._id}>
                    <td className="border border-[#78613a] px-2 py-1">
                      {i + 1}
                    </td>
                    <td className="border border-[#78613a] px-2 py-1">
                      {item.label}
                    </td>
                    <td className="border border-[#78613a] px-2 py-1">
                      {item.purityLabel ?? "—"}
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      1
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      {mgToGramsDisplay(item.grossWeightMg)}
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      {mgToGramsDisplay(item.netWeightMg)}
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      {formatPaise(item.ratePerGramPaise)}
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      {formatPaise(item.makingChargePaise)}
                    </td>
                    {sale.isGst && (
                      <td className="border border-[#78613a] px-2 py-1 text-right">
                        {formatPaise(item.lineTaxPaise)}
                      </td>
                    )}
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      {formatPaise(item.lineTotalPaise)}
                    </td>
                  </tr>
                ))}
                {items.length < 5 && (
                  <tr aria-hidden="true">
                    {Array.from({ length: sale.isGst ? 10 : 9 }, (_, i) => (
                      <td key={i} className="h-12 border border-[#78613a]" />
                    ))}
                  </tr>
                )}
                <tr className="bg-[#f1e6cd] font-bold">
                  <td className="border border-[#78613a] px-2 py-1" colSpan={3}>
                    Sub Total
                  </td>
                  <td className="border border-[#78613a] px-2 py-1 text-right">
                    {items.length}
                  </td>
                  <td className="border border-[#78613a] px-2 py-1 text-right">
                    {mgToGramsDisplay(
                      items.reduce((sum, i) => sum + i.grossWeightMg, 0),
                    )}
                  </td>
                  <td className="border border-[#78613a] px-2 py-1 text-right">
                    {mgToGramsDisplay(
                      items.reduce((sum, i) => sum + i.netWeightMg, 0),
                    )}
                  </td>
                  <td className="border border-[#78613a] px-2 py-1" />
                  <td className="border border-[#78613a] px-2 py-1 text-right">
                    {formatPaise(
                      items.reduce((sum, i) => sum + i.makingChargePaise, 0),
                    )}
                  </td>
                  {sale.isGst && (
                    <td className="border border-[#78613a] px-2 py-1 text-right">
                      {formatPaise(
                        items.reduce((sum, i) => sum + i.lineTaxPaise, 0),
                      )}
                    </td>
                  )}
                  <td className="border border-[#78613a] px-2 py-1 text-right">
                    {formatPaise(
                      items.reduce((sum, i) => sum + i.lineTotalPaise, 0),
                    )}
                  </td>
                </tr>
                {sale.discountPaise > 0 && (
                  <tr>
                    <td
                      className="border border-[#78613a] px-2 py-1 bg-[#f1e6cd] font-semibold"
                      colSpan={sale.isGst ? 9 : 8}
                    >
                      Discount
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right font-semibold text-red-600">
                      -{formatPaise(sale.discountPaise)}
                    </td>
                  </tr>
                )}
                {oldGoldExchange && (
                  <tr>
                    <td
                      className="border border-[#78613a] px-2 py-1 bg-[#f1e6cd] font-semibold"
                      colSpan={sale.isGst ? 9 : 8}
                    >
                      Old Item Deduction
                    </td>
                    <td className="border border-[#78613a] px-2 py-1 text-right font-semibold text-red-600">
                      -{formatPaise(oldGoldExchange.exchangeValuePaise)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div
              data-pdf-keep-together
              className="grid grid-cols-[2fr_1fr_1fr] gap-4"
            >
              <div className="border border-[#78613a] p-3">
                <p className="font-bold">Amount in words</p>
                <p>{amountInWordsFromPaise(grandTotalNetPaise)}</p>
              </div>
              <div className="border border-[#78613a] p-3">
                <p className="font-bold">Payment type</p>
                <p>{paymentTypeLabel}</p>
              </div>
              <div className="flex flex-col gap-1 border border-[#78613a] bg-[#f1e6cd] p-3">
                <div className="flex justify-between border-b border-[#78613a]/20 pb-1 text-lg font-extrabold">
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

            <p className="mt-auto pt-6 text-right font-semibold">
              For {organization?.name || BUSINESS_PROFILE_DEFAULTS.name}
            </p>
          </div>
        ) : (
          <div
            ref={invoiceRef}
            data-invoice-sheet
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
