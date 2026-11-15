"use client";

import { use, useRef } from "react";
import { useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { api } from "../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { PAPER, PrintPageStyle, useFitToPaper } from "@/components/print-sheet";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const box = "border border-[#8c7b47] px-2 py-1";
const cell = "border border-[#8c7b47] px-1.5 py-[0.8mm]";

export default function GirviPrintPage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = use(params);
  const data = useQuery(api.girvi.getPrintData, { id: loanId as Id<"girviLoans"> });
  const sheetRef = useRef<HTMLElement>(null);
  const fit = useFitToPaper(sheetRef, PAPER.a5, [data]);
  if (data === undefined) return <p className="p-8 text-sm text-muted-foreground">Loading Girvi ticket…</p>;
  if (!data) return <p className="p-8 text-sm text-destructive">This ticket is unavailable in the current company.</p>;
  const { loan, organization, logoUrl, receipts } = data;
  const outstanding = Math.max(0, loan.principalPaise - loan.principalRepaidPaise);
  return <div className="overflow-x-auto bg-white text-[#655c36] print:overflow-visible">
    <PrintPageStyle paper={PAPER.a5} />
    <div className="mx-auto mb-4 flex w-[200mm] max-w-full justify-end print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print Girvi bill (A5)</Button></div>
    <article ref={sheetRef} data-print-sheet style={fit.style} className="mx-auto flex w-[200mm] flex-col gap-[1.5mm] border border-[#8c7b47] bg-white p-[2.5mm] text-[9px] leading-snug shadow-sm">
      <h1 className="text-center text-base font-bold tracking-[0.2em]">Girvi Pledge Receipt</h1>
      <header className="flex items-center gap-3 border-2 border-[#8c7b47] px-2 py-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl ?? "/nrk-logo-gold.png"} alt="NRK Jewellers" className="h-[15mm] w-[26mm] shrink-0 object-contain" />
        <div className="min-w-0 flex-1"><h2 className="text-lg font-extrabold leading-tight">{organization?.name ?? "NRK Jewellers"}</h2><p className="font-semibold">{organization?.tagline ?? "Gold and Silver Merchants"}</p><p className="whitespace-pre-line text-[8px]">{organization?.address}</p><p className="text-[8px]">{organization?.phone}</p></div>
        <div className="shrink-0 text-right"><p className="font-bold">Ticket: {loan.ticketNumber}</p><p>Issued: {new Date(loan.issuedAt).toLocaleDateString("en-IN")}</p><p>Due: <strong>{new Date(loan.dueAt).toLocaleDateString("en-IN")}</strong></p><p>Status: <span className="capitalize">{loan.status}</span></p></div>
      </header>
      <section className="grid grid-cols-2 gap-[1.5mm]">
        <div className={box}><p className="font-bold uppercase tracking-wider">Customer</p><p className="text-[11px] font-semibold">{loan.customerName}</p><p>{loan.phone}</p></div>
        <div className={box}><p className="font-bold uppercase tracking-wider">Pledged metal</p><p className="capitalize">{loan.metal} · {loan.description}</p><p>Weight: {mgToGramsDisplay(loan.weightMg)} g{loan.pieceCount !== undefined && <> · Pieces: {loan.pieceCount} pcs</>} · Storage: {loan.storageLocation}</p></div>
      </section>
      <section className="grid grid-cols-3 gap-[1.5mm]">
        <div className={box}><p className="font-semibold">Loan principal</p><p className="text-[12px] font-bold">{formatPaise(loan.principalPaise)}</p></div>
        <div className={box}><p className="font-semibold">Monthly interest</p><p className="text-[12px] font-bold">{(loan.monthlyInterestBasisPoints / 100).toFixed(2)}%</p></div>
        <div className={`${box} bg-[#f4f0df]`}><p className="font-semibold">Principal due</p><p className="text-[12px] font-bold">{formatPaise(outstanding)}</p></div>
      </section>
      <table className="w-full border-collapse border border-[#8c7b47] leading-tight">
        <thead><tr className="bg-[#f4f0df]"><th colSpan={3} className={`${cell} text-left`}>Repayment history</th></tr><tr className="bg-[#f4f0df]">{["Date", "Principal received", "Interest received"].map((label) => <th key={label} className={`${cell} text-left`}>{label}</th>)}</tr></thead>
        <tbody>{receipts.map((receipt) => <tr key={receipt._id}><td className={cell}>{new Date(receipt.createdAt).toLocaleDateString("en-IN")}</td><td className={`${cell} tabular-nums`}>{formatPaise(receipt.principalPaise)}</td><td className={`${cell} tabular-nums`}>{formatPaise(receipt.interestPaise)}</td></tr>)}{receipts.length === 0 && <tr><td colSpan={3} className={`${cell} text-center`}>No repayments recorded.</td></tr>}</tbody>
      </table>
      <div className="flex items-end justify-between gap-3 pt-[3mm]">
        <p className="border-t border-[#8c7b47] px-3 pt-[0.5mm]">Customer signature</p>
        <p className="text-[10px] font-bold">For {organization?.name ?? "NRK Jewellers"}</p>
      </div>
    </article>
  </div>;
}
