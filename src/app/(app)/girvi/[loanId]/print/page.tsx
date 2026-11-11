"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { api } from "../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Id } from "../../../../../../convex/_generated/dataModel";

export default function GirviPrintPage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = use(params);
  const data = useQuery(api.girvi.getPrintData, { id: loanId as Id<"girviLoans"> });
  if (data === undefined) return <p className="p-8 text-sm text-muted-foreground">Loading Girvi ticket…</p>;
  if (!data) return <p className="p-8 text-sm text-destructive">This ticket is unavailable in the current company.</p>;
  const { loan, organization, logoUrl, receipts } = data;
  const outstanding = Math.max(0, loan.principalPaise - loan.principalRepaidPaise);
  return <main className="min-h-svh bg-white p-4 text-[#655c36] sm:p-8 print:min-h-0 print:p-0">
    <style>{`@page { size: A5 landscape; margin: 6mm; } @media print { body { background:#fff!important; } }`}</style>
    <div className="mx-auto mb-4 flex max-w-[200mm] justify-end print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print Girvi bill</Button></div>
    <article className="mx-auto max-w-[200mm] border border-[#8c7b47] bg-white p-4 text-sm sm:p-6">
      <h1 className="mb-3 text-center text-2xl font-bold">Girvi Pledge Receipt</h1>
      <header className="flex items-center gap-4 border-2 border-[#8c7b47] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={logoUrl ?? "/nrk-logo-gold.png"} alt="NRK Jewellers" className="h-[22mm] w-[32mm] object-contain" />
        <div className="min-w-0 flex-1"><h2 className="text-xl font-extrabold">{organization?.name ?? "NRK Jewellers"}</h2><p className="font-semibold">{organization?.tagline ?? "Gold and Silver Merchants"}</p><p className="whitespace-pre-line">{organization?.address}</p><p>{organization?.phone}</p></div>
        <div className="text-right"><p className="font-bold">Ticket: {loan.ticketNumber}</p><p>Issued: {new Date(loan.issuedAt).toLocaleDateString("en-IN")}</p><p>Status: <span className="capitalize">{loan.status}</span></p></div>
      </header>
      <section className="my-3 grid grid-cols-2 gap-3">
        <div className="border border-[#8c7b47] p-3"><p className="font-bold">Customer</p><p className="text-base font-semibold">{loan.customerName}</p><p>{loan.phone}</p></div>
        <div className="border border-[#8c7b47] p-3"><p className="font-bold">Pledged metal</p><p className="capitalize">{loan.metal} · {loan.description}</p><p>Weight: {mgToGramsDisplay(loan.weightMg)} g</p>{loan.pieceCount !== undefined && <p>Pieces: {loan.pieceCount} pcs</p>}<p>Storage: {loan.storageLocation}</p></div>
      </section>
      <section className="grid grid-cols-3 gap-3">
        <div className="border border-[#8c7b47] p-3"><p className="font-semibold">Loan principal</p><p className="text-lg font-bold">{formatPaise(loan.principalPaise)}</p></div>
        <div className="border border-[#8c7b47] p-3"><p className="font-semibold">Monthly interest</p><p className="text-lg font-bold">{(loan.monthlyInterestBasisPoints / 100).toFixed(2)}%</p></div>
        <div className="border border-[#8c7b47] bg-[#f4f0df] p-3"><p className="font-semibold">Principal due</p><p className="text-lg font-bold">{formatPaise(outstanding)}</p></div>
      </section>
      <p className="mt-3 border border-[#8c7b47] p-3">Due date: <strong>{new Date(loan.dueAt).toLocaleDateString("en-IN")}</strong></p>
      <h3 className="mb-2 mt-4 font-bold">Repayment history</h3>
      <table className="w-full border-collapse border border-[#8c7b47] text-sm"><thead><tr className="bg-[#f4f0df]">{["Date", "Principal received", "Interest received"].map((label) => <th key={label} className="border border-[#8c7b47] p-2 text-left">{label}</th>)}</tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt._id}><td className="border border-[#8c7b47] p-2">{new Date(receipt.createdAt).toLocaleDateString("en-IN")}</td><td className="border border-[#8c7b47] p-2">{formatPaise(receipt.principalPaise)}</td><td className="border border-[#8c7b47] p-2">{formatPaise(receipt.interestPaise)}</td></tr>)}{receipts.length === 0 && <tr><td colSpan={3} className="border border-[#8c7b47] p-2 text-center">No repayments recorded.</td></tr>}</tbody></table>
      <p className="mt-5 text-right font-bold">For {organization?.name ?? "NRK Jewellers"}</p>
    </article>
  </main>;
}
