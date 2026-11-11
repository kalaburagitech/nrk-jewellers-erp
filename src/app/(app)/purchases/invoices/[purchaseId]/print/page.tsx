"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { api } from "../../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

export default function PurchaseBillPrintPage({ params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = use(params);
  const data = useQuery(api.purchases.getPrintData, { purchaseId: purchaseId as Id<"purchases"> });
  if (data === undefined) return <p className="p-8 text-sm text-muted-foreground">Loading bill…</p>;
  if (!data) return <p className="p-8 text-sm text-destructive">This purchase bill is unavailable in the current company.</p>;
  const { purchase, items, supplier, organization, payment, logoUrl } = data;

  return <main className="min-h-svh bg-white p-4 text-[#655c36] sm:p-8 print:min-h-0 print:p-0">
    <style>{`@page { size: A5 landscape; margin: 6mm; } @media print { body { background:#fff!important; } .purchase-sheet { box-shadow:none!important; } }`}</style>
    <div className="mx-auto mb-4 flex max-w-[200mm] justify-end print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print purchase bill</Button></div>
    <article className="purchase-sheet mx-auto max-w-[200mm] border border-[#8c7b47] bg-white p-4 text-sm shadow-sm sm:p-6">
      <h1 className="mb-3 text-center text-2xl font-bold">Purchase Bill</h1>
      <header className="flex items-center gap-4 border-2 border-[#8c7b47] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl ?? "/nrk-logo-gold.png"} alt="NRK Jewellers" className="h-[22mm] w-[32mm] object-contain" />
        <div className="min-w-0 flex-1"><h2 className="text-xl font-extrabold">{organization?.name ?? "NRK Jewellers"}</h2><p className="font-semibold">{organization?.tagline ?? "Gold and Silver Merchants"}</p><p className="whitespace-pre-line">{organization?.address}</p><p>{organization?.phone}</p></div>
        <div className="text-right"><p className="font-bold">Bill No.: {purchase.invoiceNumber}</p><p>Date: {new Date(purchase.createdAt).toLocaleDateString("en-IN")}</p></div>
      </header>
      <section className="my-3 border border-[#8c7b47] p-3"><p className="font-bold">Supplier</p><p className="text-base font-semibold">{supplier?.name ?? "Supplier"}</p>{supplier?.phone && <p>{supplier.phone}</p>}{supplier?.gstin && <p>GSTIN: {supplier.gstin}</p>}</section>
      <table className="w-full table-fixed border-collapse border border-[#8c7b47] text-xs sm:text-sm">
        <colgroup><col style={{width:"7%"}}/><col style={{width:"35%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"12%"}}/></colgroup>
        <thead><tr className="bg-[#f4f0df]">{["Sl.No", "Description", "Gross Wt", "Net Wt", "Rate / g", "Making", "Total"].map((label) => <th key={label} className="border border-[#8c7b47] px-1 py-2">{label}</th>)}</tr></thead>
        <tbody>{items.map((item, index) => <tr key={item._id}><td className="border border-[#8c7b47] px-1 py-2 text-center">{index + 1}</td><td className="border border-[#8c7b47] px-1 py-2">{item.label}</td><td className="border border-[#8c7b47] px-1 py-2 text-right">{mgToGramsDisplay(item.grossWeightMg)}</td><td className="border border-[#8c7b47] px-1 py-2 text-right">{mgToGramsDisplay(item.netWeightMg)}</td><td className="border border-[#8c7b47] px-1 py-2 text-right">{formatPaise(item.ratePerGramPaise)}</td><td className="border border-[#8c7b47] px-1 py-2 text-right">{formatPaise(item.makingChargePaise)}</td><td className="border border-[#8c7b47] px-1 py-2 text-right">{formatPaise(item.lineTotalPaise)}</td></tr>)}</tbody>
      </table>
      <footer className="mt-3 ml-auto grid max-w-sm gap-1 border border-[#8c7b47] bg-[#f4f0df] p-3"><p className="flex justify-between"><span>Subtotal</span><strong>{formatPaise(purchase.subtotalPaise)}</strong></p><p className="flex justify-between"><span>Tax</span><strong>{formatPaise(purchase.taxPaise)}</strong></p><p className="flex justify-between border-t border-[#8c7b47] pt-1 text-base"><span>Grand Total</span><strong>{formatPaise(purchase.totalPaise)}</strong></p><p className="flex justify-between"><span>Paid</span><strong>{formatPaise(purchase.amountPaidPaise)}</strong></p><p className="flex justify-between"><span>Balance Due</span><strong>{formatPaise(Math.max(0, purchase.totalPaise - purchase.amountPaidPaise))}</strong></p>{payment?.mode && <p>Payment type: {payment.mode.replaceAll("_", " ")}</p>}</footer>
      <p className="mt-5 text-right font-bold">For {organization?.name ?? "NRK Jewellers"}</p>
    </article>
  </main>;
}
