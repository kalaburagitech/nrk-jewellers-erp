"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PrivacyLockGate } from "@/components/privacy-lock-gate";
import { CostWarning, PeriodPicker, ReportHeader, ReportTable, SummaryTiles, grams, usePeriod } from "@/components/report-kit";

function ItemProfit() {
  const period = usePeriod();
  const report = useQuery(api.partyReports.profitReports, period.range);
  const rows = report?.items;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Item Wise Profit And Loss" description="Which items earn you the most. Bill discount is shared across lines by value." controls={<PeriodPicker state={period} />} />
      {rows && (
        <SummaryTiles
          tiles={[
            { label: "Total Sale (pre-GST)", paise: rows.reduce((a, r) => a + r.salePaise, 0), tone: "blue" },
            { label: "Total Cost", paise: rows.reduce((a, r) => a + r.costPaise, 0), tone: "amber" },
            { label: "Total Profit (+) / Loss (-)", paise: rows.reduce((a, r) => a + r.profitPaise, 0), tone: "green" },
          ]}
        />
      )}
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        csvName="item-wise-profit-loss"
        columns={[
          { key: "name", label: "Item Name", value: (r) => r.name },
          { key: "qty", label: "Sale Qty", value: (r) => r.qty, align: "right", total: true },
          { key: "wt", label: "Net Wt (g)", value: (r) => grams(r.weightMg), align: "right", total: true },
          { key: "sale", label: "Sale Amount", value: (r) => r.salePaise, money: true, align: "right", total: true },
          { key: "cost", label: "Cost", value: (r) => r.costPaise, money: true, align: "right", total: true },
          { key: "profit", label: "Profit (+) / Loss (-)", value: (r) => r.profitPaise, money: true, align: "right", total: true, signed: true },
        ]}
      />
      {report && report.linesWithoutCost > 0 && <CostWarning count={report.linesWithoutCost} />}
    </div>
  );
}

export default function ItemProfitPage() {
  return (
    <PrivacyLockGate>
      <ItemProfit />
    </PrivacyLockGate>
  );
}
