"use client";

import { use, useRef } from "react";
import { useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { api } from "../../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { PAPER, PrintPageStyle, useFitToPaper } from "@/components/print-sheet";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

const cell = "border border-[#8c7b47] px-1 py-[1mm]";

export default function PurchaseBillPrintPage({ params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = use(params);
  const data = useQuery(api.purchases.getPrintData, { purchaseId: purchaseId as Id<"purchases"> });
  const sheetRef = useRef<HTMLElement>(null);
  const fit = useFitToPaper(sheetRef, PAPER.a5, [data]);
  if (data === undefined) return <p className="p-8 text-sm text-muted-foreground">Loading bill…</p>;
  if (!data) return <p className="p-8 text-sm text-destructive">This purchase bill is unavailable in the current company.</p>;
  const { purchase, items, supplier, organization, payment, logoUrl } = data;

  return <div className="overflow-x-auto bg-white text-[#655c36] print:overflow-visible">
    <PrintPageStyle paper={PAPER.a5} />
    <div className="mx-auto mb-4 flex w-[200mm] max-w-full justify-end print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print purchase bill (A5)</Button></div>
    <article ref={sheetRef} data-print-sheet style={fit.style} className="mx-auto flex w-[200mm] flex-col gap-[1.5mm] border border-[#8c7b47] bg-white p-[2.5mm] text-[9px] leading-snug shadow-sm">
      <h1 className="text-center text-base font-bold tracking-[0.2em]">Purchase Bill</h1>
      <header className="flex items-center gap-3 border-2 border-[#8c7b47] px-2 py-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl ?? "/nrk-logo-gold.png"} alt="NRK Jewellers" className="h-[15mm] w-[26mm] shrink-0 object-contain" />
        <div className="min-w-0 flex-1"><h2 className="text-lg font-extrabold leading-tight">{organization?.name ?? "NRK Jewellers"}</h2><p className="font-semibold">{organization?.tagline ?? "Gold and Silver Merchants"}</p><p className="whitespace-pre-line text-[8px]">{organization?.address}</p><p className="text-[8px]">{organization?.phone}</p></div>
        <div className="shrink-0 text-right"><p className="font-bold">Bill No.: {purchase.invoiceNumber}</p>{purchase.supplierBillNumber && <p>Supplier Bill No.: {purchase.supplierBillNumber}</p>}{purchase.stateOfSupply && <p>State of supply: {purchase.stateOfSupply}</p>}<p>Date: {new Date(purchase.createdAt).toLocaleDateString("en-IN")}</p></div>
      </header>
      <section className="border border-[#8c7b47] px-2 py-1"><p className="font-bold uppercase tracking-wider">Supplier</p><p className="text-[11px] font-semibold">{supplier?.name ?? "Supplier"}</p>{(supplier?.phone || supplier?.gstin) && <p>{supplier?.phone}{supplier?.phone && supplier?.gstin ? " · " : ""}{supplier?.gstin && `GSTIN: ${supplier.gstin}`}</p>}</section>
      <table className="w-full table-fixed border-collapse border border-[#8c7b47] leading-tight">
        <colgroup><col style={{width:"7%"}}/><col style={{width:"35%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"12%"}}/></colgroup>
        <thead><tr className="bg-[#f4f0df]">{["Sl.No", "Description", "Gross Wt", "Net Wt", "Rate / g", "Making", "Total"].map((label) => <th key={label} className={cell}>{label}</th>)}</tr></thead>
        <tbody>{items.map((item, index) => <tr key={item._id}><td className={`${cell} text-center`}>{index + 1}</td><td className={cell}>{item.label}</td><td className={`${cell} text-right tabular-nums`}>{mgToGramsDisplay(item.grossWeightMg)}</td><td className={`${cell} text-right tabular-nums`}>{mgToGramsDisplay(item.netWeightMg)}</td><td className={`${cell} text-right tabular-nums`}>{formatPaise(item.ratePerGramPaise)}</td><td className={`${cell} text-right tabular-nums`}>{formatPaise(item.makingChargePaise)}</td><td className={`${cell} text-right tabular-nums`}>{formatPaise(item.lineTotalPaise)}</td></tr>)}</tbody>
      </table>
      <div className="flex items-end justify-between gap-3">
        <p className="pb-1 text-[10px] font-bold">For {organization?.name ?? "NRK Jewellers"}</p>
        <footer className="grid w-[75mm] gap-[0.5mm] border border-[#8c7b47] bg-[#f4f0df] px-2 py-1"><p className="flex justify-between"><span>Subtotal</span><strong>{formatPaise(purchase.subtotalPaise)}</strong></p><p className="flex justify-between"><span>Tax</span><strong>{formatPaise(purchase.taxPaise)}</strong></p>{!!purchase.roundOffPaise && <p className="flex justify-between"><span>Round Off</span><strong>{formatPaise(purchase.roundOffPaise)}</strong></p>}<p className="flex justify-between border-t border-[#8c7b47] pt-[0.5mm] text-[11px]"><span>Grand Total</span><strong>{formatPaise(purchase.totalPaise)}</strong></p><p className="flex justify-between"><span>Paid</span><strong>{formatPaise(purchase.amountPaidPaise)}</strong></p><p className="flex justify-between"><span>Balance Due</span><strong>{formatPaise(Math.max(0, purchase.totalPaise - purchase.amountPaidPaise))}</strong></p>{payment?.mode && <p className="capitalize">Payment type: {payment.mode.replaceAll("_", " ")}</p>}</footer>
      </div>
    </article>
  </div>;
}
