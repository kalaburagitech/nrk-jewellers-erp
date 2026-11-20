"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { CostWarning, PeriodPicker, ReportHeader, ReportTable, grams, usePeriod } from "@/components/report-kit";

function CategoryProfit() {
  const period = usePeriod();
  const report = useQuery(api.partyReports.profitReports, period.range);
  const rows = report
    ? [...report.items.reduce((m, i) => {
        const c = m.get(i.category) ?? { category: i.category, qty: 0, weightMg: 0, salePaise: 0, costPaise: 0, profitPaise: 0 };
        c.qty += i.qty;
        c.weightMg += i.weightMg;
        c.salePaise += i.salePaise;
        c.costPaise += i.costPaise;
        c.profitPaise += i.profitPaise;
        return m.set(i.category, c);
      }, new Map<string, { category: string; qty: number; weightMg: number; salePaise: number; costPaise: number; profitPaise: number }>()).values()].sort((a, b) => b.profitPaise - a.profitPaise)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Item Category Wise Profit And Loss" description="Profit earned by each item category." controls={<PeriodPicker state={period} />} />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.category}
        csvName="category-wise-profit-loss"
        columns={[
          { key: "cat", label: "Category", value: (r) => r.category },
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

export default function CategoryProfitPage() {
  return (
    <>
      <CategoryProfit />
    </>
  );
}
