"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, SummaryTiles, fmtDate, usePeriod } from "@/components/report-kit";

export default function DayBookPage() {
  const period = usePeriod("today");
  const rows = useQuery(api.partyReports.dayBook, period.range);
  const moneyIn = rows?.reduce((a, r) => a + r.moneyInPaise, 0) ?? 0;
  const moneyOut = rows?.reduce((a, r) => a + r.moneyOutPaise, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Day Book" description="All sales, purchases, returns and expenses with money in and out." controls={<PeriodPicker state={period} />} />
      {rows && (
        <SummaryTiles
          tiles={[
            { label: "Total Money-In", paise: moneyIn, tone: "green" },
            { label: "Total Money-Out", paise: moneyOut, tone: "red" },
            { label: "Net Money", paise: moneyIn - moneyOut, tone: "blue" },
          ]}
        />
      )}
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        csvName="day-book"
        columns={[
          { key: "date", label: "Date", value: (r) => r.date, render: (r) => fmtDate(r.date) },
          { key: "name", label: "Name", value: (r) => r.name },
          { key: "ref", label: "Ref No.", value: (r) => r.ref },
          { key: "type", label: "Type", value: (r) => r.txnType },
          { key: "total", label: "Total", value: (r) => r.totalPaise, money: true, align: "right" },
          { key: "in", label: "Money In", value: (r) => r.moneyInPaise, money: true, align: "right", total: true, render: (r) => <span className="text-emerald-600">{inr(r.moneyInPaise)}</span> },
          { key: "out", label: "Money Out", value: (r) => r.moneyOutPaise, money: true, align: "right", total: true, render: (r) => <span className="text-red-600">{inr(r.moneyOutPaise)}</span> },
        ]}
      />
    </div>
  );
}

const inr = (p: number) => (p ? `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—");
