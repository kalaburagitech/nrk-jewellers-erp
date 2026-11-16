"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodPicker, ReportHeader, ReportTable, fmtDate, usePeriod } from "@/components/report-kit";
import { downloadCsv } from "@/lib/csv-export";
import { formatPaise } from "@/lib/money";

export default function PartyStatementPage() {
  return (
    <Suspense>
      <PartyStatement />
    </Suspense>
  );
}

function PartyStatement() {
  const params = useSearchParams();
  const period = usePeriod("this-fy");
  const parties = useQuery(api.partyReports.allParties);
  const [party, setParty] = useState(params.get("party") ?? "");
  const [partyType, partyId] = party.split(":") as ["customer" | "supplier", string];
  const report = useQuery(api.partyReports.partyStatement, party ? { ...period.range, partyType, partyId } : "skip");

  const customers = parties?.filter((p) => p.partyType === "customer") ?? [];
  const suppliers = parties?.filter((p) => p.partyType === "supplier") ?? [];
  const balanceLabel = partyType === "supplier" ? "Total Payable" : "Total Receivable";

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Party Statement"
        description={report ? `${report.party.name}${report.party.phone ? ` · ${report.party.phone}` : ""}` : "Every bill and payment with a party, with running balance."}
        controls={
          <>
            <PeriodPicker state={period} />
            <Select value={party} onValueChange={setParty}>
              <SelectTrigger className="h-9 w-64" aria-label="Select party">
                <SelectValue placeholder="Select Party" />
              </SelectTrigger>
              <SelectContent>
                {customers.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Customers</SelectLabel>
                    {customers.map((p) => <SelectItem key={p.id} value={`customer:${p.id}`}>{p.name}</SelectItem>)}
                  </SelectGroup>
                )}
                {suppliers.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Suppliers</SelectLabel>
                    {suppliers.map((p) => <SelectItem key={p.id} value={`supplier:${p.id}`}>{p.name}</SelectItem>)}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </>
        }
        onExcel={
          report
            ? () =>
                downloadCsv(
                  `party-statement-${report.party.name}`,
                  ["Date", "Txn Type", "Ref No.", "Total", "Debit", "Credit", "Balance"],
                  report.rows.map((r) => [fmtDate(r.date), r.txnType, r.ref, r.totalPaise / 100, r.debitPaise / 100, r.creditPaise / 100, r.balancePaise / 100]),
                )
            : undefined
        }
      />

      {!party ? (
        <div className="rounded-xl border bg-card py-20 text-center text-muted-foreground">Select a party to see their statement.</div>
      ) : (
        <>
          {report && (
            <p className="text-sm text-muted-foreground">
              Opening balance on {fmtDate(period.range.startDate)}: <span className="font-semibold text-foreground">{formatPaise(report.openingBalancePaise)}</span>
            </p>
          )}
          <ReportTable
            rows={report === null ? [] : report?.rows}
            rowKey={(r) => r.id}
            columns={[
              { key: "date", label: "Date", value: (r) => r.date, render: (r) => fmtDate(r.date) },
              { key: "type", label: "Txn Type", value: (r) => r.txnType, render: (r) => <span className="capitalize">{r.txnType}</span> },
              { key: "ref", label: "Ref No.", value: (r) => r.ref },
              { key: "total", label: "Total", value: (r) => r.totalPaise, money: true, align: "right" },
              { key: "debit", label: "Debit", value: (r) => r.debitPaise, money: true, align: "right", total: true },
              { key: "credit", label: "Credit", value: (r) => r.creditPaise, money: true, align: "right", total: true },
              { key: "balance", label: partyType === "supplier" ? "Payable Balance" : "Receivable Balance", value: (r) => r.balancePaise, money: true, align: "right" },
            ]}
          />
          {report && (
            <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="mb-3 font-semibold">Party Statement Summary</p>
                <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                  <Stat label="Total Sale" sub="Sale − Sale Return" paise={report.summary.totalSalePaise} />
                  <Stat label="Total Purchase" sub="Purchase − Purchase Return" paise={report.summary.totalPurchasePaise} />
                  <Stat label="Total Money-In" paise={report.summary.moneyInPaise} />
                  <Stat label="Total Money-Out" paise={report.summary.moneyOutPaise} />
                </div>
              </div>
              <div className="border-t pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <p className="text-sm font-semibold">{balanceLabel}</p>
                <p className="text-2xl font-semibold text-emerald-600 tabular-nums">{formatPaise(report.closingBalancePaise)}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, sub, paise }: { label: string; sub?: string; paise: number }) {
  return (
    <div>
      <p>
        {label}: <span className="font-semibold tabular-nums">{formatPaise(paise)}</span>
      </p>
      {sub && <p className="text-xs text-muted-foreground">({sub})</p>}
    </div>
  );
}
