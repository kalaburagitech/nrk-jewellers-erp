"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { CostWarning, PeriodPicker, ReportHeader, ReportTable, SummaryTiles, fmtDate, usePeriod } from "@/components/report-kit";

function BillProfit() {
  const period = usePeriod();
  const report = useQuery(api.partyReports.profitReports, period.range);
  const bills = report?.bills;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Bill Wise Profit" description="Profit on every sale invoice: sale value (before GST, after discount) minus purchase cost." controls={<PeriodPicker state={period} />} />
      {bills && (
        <SummaryTiles
          tiles={[
            { label: "Total Sale (pre-GST)", paise: bills.reduce((a, b) => a + b.salePaise, 0), tone: "blue" },
            { label: "Total Cost", paise: bills.reduce((a, b) => a + b.costPaise, 0), tone: "amber" },
            { label: "Total Profit (+) / Loss (-)", paise: bills.reduce((a, b) => a + b.profitPaise, 0), tone: "green" },
          ]}
        />
      )}
      <ReportTable
        rows={bills}
        rowKey={(r) => r.id}
        csvName="bill-wise-profit"
        columns={[
          { key: "date", label: "Date", value: (r) => r.date, render: (r) => fmtDate(r.date) },
          { key: "inv", label: "Invoice No.", value: (r) => r.invoiceNumber },
          { key: "party", label: "Party", value: (r) => r.partyName },
          { key: "total", label: "Bill Total", value: (r) => r.totalPaise, money: true, align: "right", total: true },
          { key: "sale", label: "Sale Value", value: (r) => r.salePaise, money: true, align: "right", total: true },
          { key: "cost", label: "Cost", value: (r) => r.costPaise, money: true, align: "right", total: true },
          { key: "profit", label: "Profit (+) / Loss (-)", value: (r) => r.profitPaise, money: true, align: "right", total: true, signed: true },
        ]}
      />
      {report && report.linesWithoutCost > 0 && <CostWarning count={report.linesWithoutCost} />}
    </div>
  );
}

export default function BillProfitPage() {
  return (
    <>
      <BillProfit />
    </>
  );
}
