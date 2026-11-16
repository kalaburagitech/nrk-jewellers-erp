"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, SummaryTiles, fmtDate, usePeriod } from "@/components/report-kit";

export default function CashFlowPage() {
  const period = usePeriod();
  const r = useQuery(api.cashReports.cashFlow, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Cash Flow" description="Cash in hand: every cash receipt and payment with running balance." controls={<PeriodPicker state={period} />} />
      {r && (
        <SummaryTiles
          tiles={[
            { label: "Opening Cash-in-Hand", paise: r.openingPaise, tone: "blue" },
            { label: "Total Cash-In", paise: r.rows.reduce((a, x) => a + x.inPaise, 0), tone: "green" },
            { label: "Total Cash-Out", paise: r.rows.reduce((a, x) => a + x.outPaise, 0), tone: "red" },
            { label: "Closing Cash-in-Hand", paise: r.closingPaise, tone: "amber" },
          ]}
        />
      )}
      <ReportTable
        rows={r?.rows}
        rowKey={(x) => x.id}
        csvName="cash-flow"
        columns={[
          { key: "date", label: "Date", value: (x) => x.date, render: (x) => fmtDate(x.date) },
          { key: "name", label: "Name", value: (x) => x.name },
          { key: "type", label: "Type", value: (x) => x.txnType },
          { key: "in", label: "Cash In", value: (x) => x.inPaise, money: true, align: "right", total: true },
          { key: "out", label: "Cash Out", value: (x) => x.outPaise, money: true, align: "right", total: true },
          { key: "bal", label: "Running Cash In Hand", value: (x) => x.balancePaise, money: true, align: "right" },
        ]}
      />
    </div>
  );
}
