"use client";

import { use, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { MessageCircle, Printer } from "lucide-react";
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
  old_gold_exchange: "Old Gold Exchange",
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

export default function PrintInvoicePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = use(params);
  const data = useQuery(api.sales.getInvoiceData, { saleId: saleId as Id<"sales"> });
  const [template, setTemplate] = useState<Template>("full-a4");

  if (data === undefined) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  }

  const { sale, items, customer, organization, oldGoldExchange, payments } = data;

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
          <Button variant="outline" asChild>
            <a
              href={whatsAppShareUrl(customer?.phone, sale.invoiceNumber, sale.totalPaise)}
              target="_blank"
              rel="noopener noreferrer"
              title="Opens WhatsApp with a prefilled message — attach the printed/saved PDF manually"
            >
              <MessageCircle className="h-4 w-4" />
              Share via WhatsApp
            </a>
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      <div className={`mx-auto flex flex-col gap-4 bg-white p-6 shadow-sm print:shadow-none ${widthClass}`}>
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            <h1 className="text-lg font-semibold">{organization?.name ?? "NRK Jewellers"}</h1>
            {organization?.address && <p className="whitespace-pre-line text-muted-foreground">{organization.address}</p>}
            <p className="text-muted-foreground">
              {organization?.phone && <>{organization.phone} · </>}
              {organization?.gstin && <>GSTIN: {organization.gstin}</>}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold">{sale.isGst ? "Tax Invoice" : "Invoice"}</p>
            <p className="text-muted-foreground">{sale.invoiceNumber}</p>
            <p className="text-muted-foreground">{new Date(sale.createdAt).toLocaleDateString("en-IN")}</p>
          </div>
        </div>

        <div>
          <p className="font-medium">Bill To</p>
          <p>{customer?.name}</p>
          {customer?.phone && <p className="text-muted-foreground">{customer.phone}</p>}
          {customer?.gstin && <p className="text-muted-foreground">GSTIN: {customer.gstin}</p>}
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-1">Item</th>
              <th className="py-1 text-right">Net Wt (g)</th>
              <th className="py-1 text-right">Rate/g</th>
              {template !== "thermal" && <th className="py-1 text-right">Making</th>}
              {sale.isGst && <th className="py-1 text-right">Tax</th>}
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className="border-b border-border/60">
                <td className="py-1">{item.label}</td>
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
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatPaise(sale.subtotalPaise)}</span>
          </div>
          {sale.discountPaise > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span>-{formatPaise(sale.discountPaise)}</span>
            </div>
          )}
          {sale.isGst && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatPaise(sale.taxPaise)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Round off</span>
            <span>{formatPaise(sale.roundOffPaise)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <span>Total</span>
            <span>{formatPaise(sale.totalPaise)}</span>
          </div>
          {oldGoldExchange && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Old gold exchange</span>
              <span>-{formatPaise(oldGoldExchange.exchangeValuePaise)}</span>
            </div>
          )}
          {payments.map((p) => (
            <div key={p._id} className="flex justify-between text-muted-foreground">
              <span>Paid ({PAYMENT_MODE_LABEL[p.mode] ?? p.mode})</span>
              <span>{formatPaise(p.amountPaise)}</span>
            </div>
          ))}
          <div className="flex justify-between font-medium">
            <span>Balance</span>
            <span>{formatPaise(sale.totalPaise - sale.amountPaidPaise)}</span>
          </div>
        </div>

        <p className="border-t border-border pt-2 text-muted-foreground">{amountInWordsFromPaise(sale.totalPaise)}</p>

        <p className="pt-4 text-center text-muted-foreground">Thank you for your business!</p>
      </div>
    </div>
  );
}
