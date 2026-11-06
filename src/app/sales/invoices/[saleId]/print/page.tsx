"use client";

import { use, useRef, useState } from "react";
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
  { value: "full-a4", label: "Full A4" },
  { value: "half-a4", label: "Half A4" },
  { value: "thermal", label: "Thermal Receipt" },
] as const;

type Template = (typeof TEMPLATES)[number]["value"];

function whatsAppShareUrl(phone: string | undefined, invoiceNumber: string, totalPaise: number) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  const message = `Hello, here is your invoice ${invoiceNumber} for ${formatPaise(totalPaise)} from NRK Jewellers. Thank you for your business!`;
  const base = withCountryCode ? `https://wa.me/${withCountryCode}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

/** Renders the invoice DOM node to a single-page PDF File, for the native share sheet (WhatsApp, etc.) or a manual download. */
async function renderInvoicePdf(node: HTMLElement, invoiceNumber: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
  const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
  const blob = pdf.output("blob");
  return new File([blob], `${invoiceNumber}.pdf`, { type: "application/pdf" });
}

export default function PrintInvoicePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = use(params);
  const data = useQuery(api.sales.getInvoiceData, { saleId: saleId as Id<"sales"> });
  const [template, setTemplate] = useState<Template>("full-a4");
  const [sharing, setSharing] = useState(false);
  const invoiceRef = useRef<HTMLDivElement>(null);

  if (data === undefined) {
    return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  }

  const { sale, items, customer, organization, logoUrl, oldGoldExchange, payments } = data;
  const cashPayments = payments.filter((p) => p.mode !== "old_gold_exchange");
  const cashReceivedPaise = cashPayments.reduce((sum, p) => sum + p.amountPaise, 0);
  const grandTotalNetPaise = sale.totalPaise - (oldGoldExchange?.exchangeValuePaise ?? 0);
  const balanceDuePaise = sale.totalPaise - sale.amountPaidPaise;
  const paymentTypeLabel =
    cashPayments.length > 0
      ? [...new Set(cashPayments.map((p) => PAYMENT_MODE_LABEL[p.mode] ?? p.mode))].join(", ")
      : oldGoldExchange
        ? "Old Gold / Silver Exchange"
        : "Credit";

  async function handleShare() {
    if (!invoiceRef.current) return;
    // Desktop browsers lack navigator.share entirely — open the WhatsApp tab synchronously now
    // (within this click's user-gesture window) so the popup blocker doesn't eat it after the
    // PDF render below finishes asynchronously.
    const supportsFileShare = typeof navigator.share === "function" && typeof navigator.canShare === "function";
    const fallbackWindow = supportsFileShare ? null : window.open("", "_blank", "noopener,noreferrer");
    const whatsAppUrl = whatsAppShareUrl(customer?.phone, sale.invoiceNumber, sale.totalPaise);
    setSharing(true);
    try {
      const file = await renderInvoicePdf(invoiceRef.current, sale.invoiceNumber);
      const message = `Hello, here is your invoice ${sale.invoiceNumber} for ${formatPaise(sale.totalPaise)} from NRK Jewellers. Thank you for your business!`;
      if (supportsFileShare && navigator.canShare?.({ files: [file] })) {
        fallbackWindow?.close();
        await navigator.share({ files: [file], text: message, title: sale.invoiceNumber });
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
    template === "thermal" ? "max-w-[80mm] text-xs" : template === "half-a4" ? "max-w-[105mm] text-sm" : "max-w-[210mm] text-sm";

  return (
    <div className="min-h-screen bg-muted/40 py-8 print:bg-white print:py-0">
      <style>{`
        @page { size: ${template === "thermal" ? "80mm auto" : template === "half-a4" ? "A5" : "A4"}; margin: ${template === "thermal" ? "2mm" : "10mm"}; }
      `}</style>

      <div className="mx-auto flex max-w-[210mm] items-center justify-between px-4 pb-4 print:hidden">
        <Select value={template} onValueChange={(v) => setTemplate(v as Template)}>
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
          <Button variant="outline" onClick={handleShare} disabled={sharing} title="Shares the actual invoice PDF — opens your device's share sheet (WhatsApp, etc.)">
            <MessageCircle className="h-4 w-4" />
            {sharing ? "Preparing PDF…" : "Share via WhatsApp"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {template === "full-a4" ? (
        <div ref={invoiceRef} className={`mx-auto flex flex-col gap-3 bg-white p-6 text-[#13253f] ${widthClass}`}>
          <h1 className="text-center text-3xl font-bold text-[#13406e]">
            {DOCUMENT_TITLE[sale.documentType] ?? (sale.isGst ? "Tax Invoice" : "Invoice")}
          </h1>

          <div className="flex items-center justify-between gap-4 border-2 border-[#13406e] p-4">
            <div className="flex items-center gap-4">
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-20 w-20 object-contain" />
              )}
              <div>
                <h2 className="text-xl font-bold">{organization?.name ?? "NRK Jewellers"}</h2>
                {organization?.tagline && <p className="font-semibold">{organization.tagline}</p>}
                {organization?.motto && <p className="italic text-[#8a6a2f]">{organization.motto}</p>}
                {organization?.address && (
                  <p className="flex items-center gap-1 text-sm text-gray-600">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-pre-line">{organization.address}</span>
                  </p>
                )}
                {organization?.phone && (
                  <p className="flex items-center gap-1 text-sm text-gray-600">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {organization.phone}
                  </p>
                )}
              </div>
            </div>
            {organization?.state && (
              <p className="shrink-0 self-start font-semibold">State: {organization.state}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border border-[#13406e] p-3">
              <p className="font-bold">Bill To:</p>
              <p>{customer?.name}</p>
              {customer?.phone && <p className="text-sm text-gray-600">{customer.phone}</p>}
              {customer?.gstin && <p className="text-sm text-gray-600">GSTIN: {customer.gstin}</p>}
            </div>
            <div className="border border-[#13406e] p-3">
              <p className="font-bold">Invoice Details:</p>
              <p>No.: {sale.invoiceNumber}</p>
              <p>Date: {new Date(sale.createdAt).toLocaleDateString("en-IN")}</p>
            </div>
          </div>

          <table className="w-full border-collapse border border-[#13406e] text-sm">
            <thead>
              <tr className="bg-[#dbe8f7] text-left">
                <th className="border border-[#13406e] px-2 py-1">Sl.No</th>
                <th className="border border-[#13406e] px-2 py-1">Description</th>
                <th className="border border-[#13406e] px-2 py-1">Purity</th>
                <th className="border border-[#13406e] px-2 py-1 text-right">Qty</th>
                <th className="border border-[#13406e] px-2 py-1 text-right">Gross Wt</th>
                <th className="border border-[#13406e] px-2 py-1 text-right">Net Wt</th>
                <th className="border border-[#13406e] px-2 py-1 text-right">Rate(₹)</th>
                <th className="border border-[#13406e] px-2 py-1 text-right">Making(₹)</th>
                {sale.isGst && <th className="border border-[#13406e] px-2 py-1 text-right">Tax(₹)</th>}
                <th className="border border-[#13406e] px-2 py-1 text-right">Total(₹)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item._id}>
                  <td className="border border-[#13406e] px-2 py-1">{i + 1}</td>
                  <td className="border border-[#13406e] px-2 py-1">{item.label}</td>
                  <td className="border border-[#13406e] px-2 py-1">{item.purityLabel ?? "—"}</td>
                  <td className="border border-[#13406e] px-2 py-1 text-right">1</td>
                  <td className="border border-[#13406e] px-2 py-1 text-right">{mgToGramsDisplay(item.grossWeightMg)}</td>
                  <td className="border border-[#13406e] px-2 py-1 text-right">{mgToGramsDisplay(item.netWeightMg)}</td>
                  <td className="border border-[#13406e] px-2 py-1 text-right">{formatPaise(item.ratePerGramPaise)}</td>
                  <td className="border border-[#13406e] px-2 py-1 text-right">{formatPaise(item.makingChargePaise)}</td>
                  {sale.isGst && <td className="border border-[#13406e] px-2 py-1 text-right">{formatPaise(item.lineTaxPaise)}</td>}
                  <td className="border border-[#13406e] px-2 py-1 text-right">{formatPaise(item.lineTotalPaise)}</td>
                </tr>
              ))}
              <tr className="bg-[#dbe8f7] font-bold">
                <td className="border border-[#13406e] px-2 py-1" colSpan={3}>
                  Sub Total
                </td>
                <td className="border border-[#13406e] px-2 py-1 text-right">{items.length}</td>
                <td className="border border-[#13406e] px-2 py-1 text-right">
                  {mgToGramsDisplay(items.reduce((sum, i) => sum + i.grossWeightMg, 0))}
                </td>
                <td className="border border-[#13406e] px-2 py-1 text-right">
                  {mgToGramsDisplay(items.reduce((sum, i) => sum + i.netWeightMg, 0))}
                </td>
                <td className="border border-[#13406e] px-2 py-1" />
                <td className="border border-[#13406e] px-2 py-1 text-right">
                  {formatPaise(items.reduce((sum, i) => sum + i.makingChargePaise, 0))}
                </td>
                {sale.isGst && (
                  <td className="border border-[#13406e] px-2 py-1 text-right">
                    {formatPaise(items.reduce((sum, i) => sum + i.lineTaxPaise, 0))}
                  </td>
                )}
                <td className="border border-[#13406e] px-2 py-1 text-right">
                  {formatPaise(items.reduce((sum, i) => sum + i.lineTotalPaise, 0))}
                </td>
              </tr>
              {sale.discountPaise > 0 && (
                <tr>
                  <td className="border border-[#13406e] px-2 py-1 bg-[#dbe8f7] font-semibold" colSpan={sale.isGst ? 9 : 8}>
                    Discount
                  </td>
                  <td className="border border-[#13406e] px-2 py-1 text-right font-semibold text-red-600">
                    -{formatPaise(sale.discountPaise)}
                  </td>
                </tr>
              )}
              {oldGoldExchange && (
                <tr>
                  <td className="border border-[#13406e] px-2 py-1 bg-[#dbe8f7] font-semibold" colSpan={sale.isGst ? 9 : 8}>
                    Old Item Deduction
                  </td>
                  <td className="border border-[#13406e] px-2 py-1 text-right font-semibold text-red-600">
                    -{formatPaise(oldGoldExchange.exchangeValuePaise)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
            <div className="border border-[#13406e] p-3">
              <p className="font-bold">Amount in words</p>
              <p>{amountInWordsFromPaise(grandTotalNetPaise)}</p>
            </div>
            <div className="border border-[#13406e] p-3">
              <p className="font-bold">Payment type</p>
              <p>{paymentTypeLabel}</p>
            </div>
            <div className="flex flex-col gap-1 border border-[#13406e] bg-[#dbe8f7] p-3">
              <div className="flex justify-between font-bold">
                <span>Grand Total</span>
                <span className="text-[#13406e]">{formatPaise(grandTotalNetPaise)}</span>
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

          <p className="pt-6 text-right font-semibold">For {organization?.name ?? "NRK Jewellers"}</p>
        </div>
      ) : (
        <div
          ref={invoiceRef}
          className={`mx-auto flex flex-col gap-4 bg-white p-6 text-gray-900 shadow-sm print:shadow-none ${widthClass}`}
        >
          <div className="flex items-start justify-between border-b border-gray-200 pb-3">
            <div>
              <h1 className="text-lg font-semibold">{organization?.name ?? "NRK Jewellers"}</h1>
              {organization?.address && <p className="whitespace-pre-line text-gray-500">{organization.address}</p>}
              <p className="text-gray-500">
                {organization?.phone && <>{organization.phone} · </>}
                {organization?.gstin && <>GSTIN: {organization.gstin}</>}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">
                {DOCUMENT_TITLE[sale.documentType] ?? (sale.isGst ? "Tax Invoice" : "Invoice")}
              </p>
              <p className="text-gray-500">{sale.invoiceNumber}</p>
              <p className="text-gray-500">{new Date(sale.createdAt).toLocaleDateString("en-IN")}</p>
            </div>
          </div>

          <div>
            <p className="font-medium">Bill To</p>
            <p>{customer?.name}</p>
            {customer?.phone && <p className="text-gray-500">{customer.phone}</p>}
            {customer?.gstin && <p className="text-gray-500">GSTIN: {customer.gstin}</p>}
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="py-1">Item</th>
                {template !== "thermal" && <th className="py-1 text-right">Gross Wt (g)</th>}
                <th className="py-1 text-right">Net Wt (g)</th>
                <th className="py-1 text-right">Rate/g</th>
                {template !== "thermal" && <th className="py-1 text-right">Making</th>}
                {sale.isGst && <th className="py-1 text-right">Tax</th>}
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id} className="border-b border-gray-200/60">
                  <td className="py-1">{item.label}</td>
                  {template !== "thermal" && <td className="py-1 text-right">{mgToGramsDisplay(item.grossWeightMg)}</td>}
                  <td className="py-1 text-right">{mgToGramsDisplay(item.netWeightMg)}</td>
                  <td className="py-1 text-right">{formatPaise(item.ratePerGramPaise)}</td>
                  {template !== "thermal" && <td className="py-1 text-right">{formatPaise(item.makingChargePaise)}</td>}
                  {sale.isGst && <td className="py-1 text-right">{formatPaise(item.lineTaxPaise)}</td>}
                  <td className="py-1 text-right">{formatPaise(item.lineTotalPaise)}</td>
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
                <span className="text-gray-500">Old gold / silver exchange</span>
                <span>-{formatPaise(oldGoldExchange.exchangeValuePaise)}</span>
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

          <p className="border-t border-gray-200 pt-2 text-gray-500">{amountInWordsFromPaise(sale.totalPaise)}</p>

          <p className="pt-4 text-center text-gray-500">Thank you for your business!</p>
        </div>
      )}
    </div>
  );
}
