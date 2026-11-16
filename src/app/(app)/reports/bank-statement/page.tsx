"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodPicker, ReportHeader, ReportTable, SummaryTiles, fmtDate, usePeriod } from "@/components/report-kit";

export default function BankStatementPage() {
  const period = usePeriod();
  const accounts = useQuery(api.cashBank.list);
  const [accountId, setAccountId] = useState("");
  const chosen = accountId || accounts?.find((a) => a.type === "bank")?._id || accounts?.[0]?._id || "";
  const r = useQuery(api.cashReports.accountStatement, chosen ? { ...period.range, accountId: chosen as Id<"bankAccounts"> } : "skip");

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Bank Statement"
        description="Deposits and withdrawals of a bank or cash account with running balance."
        controls={
          <>
            <PeriodPicker state={period} />
            <Select value={chosen} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 w-56" aria-label="Account"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts?.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}{a.type === "cash" ? " (Cash)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />
      {r && (
        <SummaryTiles
          tiles={[
            { label: "Opening Balance", paise: r.openingPaise, tone: "blue" },
            { label: "Total Deposits", paise: r.rows.reduce((a, x) => a + x.depositPaise, 0), tone: "green" },
            { label: "Total Withdrawals", paise: r.rows.reduce((a, x) => a + x.withdrawalPaise, 0), tone: "red" },
            { label: "Closing Balance", paise: r.closingPaise, tone: "amber" },
          ]}
        />
      )}
      <ReportTable
        rows={accounts?.length === 0 ? [] : r?.rows}
        rowKey={(x) => x.id}
        csvName="bank-statement"
        empty={accounts?.length === 0 ? "No bank or cash accounts yet — add one under Cash & Bank." : "No transactions to show"}
        columns={[
          { key: "date", label: "Date", value: (x) => x.date, render: (x) => fmtDate(x.date) },
          { key: "desc", label: "Description", value: (x) => x.description },
          { key: "dep", label: "Deposit", value: (x) => x.depositPaise, money: true, align: "right", total: true },
          { key: "wd", label: "Withdrawal", value: (x) => x.withdrawalPaise, money: true, align: "right", total: true },
          { key: "bal", label: "Balance", value: (x) => x.balancePaise, money: true, align: "right" },
        ]}
      />
    </div>
  );
}
