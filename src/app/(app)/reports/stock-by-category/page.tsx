"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ReportHeader, ReportTable, grams } from "@/components/report-kit";

export default function StockByCategoryPage() {
  const items = useQuery(api.stockReports.itemStock);
  const rows = items
    ? [...items.reduce((m, r) => {
        const c = m.get(r.category) ?? { category: r.category, items: 0, pieces: 0, weightMg: 0, valuePaise: 0 };
        c.items += 1;
        c.pieces += r.pieces;
        c.weightMg += r.weightMg;
        c.valuePaise += r.valuePaise ?? 0;
        return m.set(r.category, c);
      }, new Map<string, { category: string; items: number; pieces: number; weightMg: number; valuePaise: number }>()).values()]
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Stock Summary By Item Category" description="Total stock and value for each item category." />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.category}
        csvName="stock-summary-by-category"
        columns={[
          { key: "cat", label: "Category", value: (r) => r.category },
          { key: "items", label: "Items", value: (r) => r.items, align: "right", total: true },
          { key: "pcs", label: "Stock Qty (pcs)", value: (r) => r.pieces, align: "right", total: true },
          { key: "wt", label: "Stock Wt (g)", value: (r) => grams(r.weightMg), align: "right", total: true },
          { key: "value", label: "Stock Value", value: (r) => r.valuePaise, money: true, align: "right", total: true },
        ]}
      />
    </div>
  );
}
