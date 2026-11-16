"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodPicker, ReportHeader, ReportTable, fmtDate, usePeriod } from "@/components/report-kit";

const TYPES = ["Sale", "Sale Return", "Purchase", "Purchase Return", "Expense"];

export default function AllTransactionsPage() {
  const period = usePeriod();
  const [type, setType] = useState("all");
  const rows = useQuery(api.partyReports.dayBook, period.range)?.filter((r) => type === "all" || r.txnType === type);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="All Transactions"
        description="Every sale, purchase, return and expense in the period."
        controls={
          <>
            <PeriodPicker state={period} />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9 w-48" aria-label="Transaction type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Transactions</SelectItem>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        csvName="all-transactions"
        columns={[
          { key: "date", label: "Date", value: (r) => r.date, render: (r) => fmtDate(r.date) },
          { key: "ref", label: "Ref No.", value: (r) => r.ref },
          { key: "name", label: "Party Name", value: (r) => r.name },
          { key: "type", label: "Type", value: (r) => r.txnType },
          { key: "total", label: "Total", value: (r) => r.totalPaise, money: true, align: "right", total: true },
          { key: "paid", label: "Received / Paid", value: (r) => r.moneyInPaise + r.moneyOutPaise, money: true, align: "right", total: true },
          { key: "bal", label: "Balance", value: (r) => Math.max(0, r.totalPaise - r.moneyInPaise - r.moneyOutPaise), money: true, align: "right", total: true },
        ]}
      />
    </div>
  );
}
