"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ReportHeader, ReportTable, grams } from "@/components/report-kit";

export default function LowStockSummaryPage() {
  const rows = useQuery(api.stockReports.itemStock)?.filter((r) => r.isLow && r.isActive);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Low Stock Summary" description="Items whose stock has fallen below the Min Stock To Maintain set on the item." />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        csvName="low-stock-summary"
        empty="No items are below their minimum stock. Set Min Stock To Maintain on an item (Stock tab) to track it here."
        columns={[
          { key: "name", label: "Item Name", value: (r) => r.name },
          { key: "cat", label: "Category", value: (r) => r.category },
          { key: "min", label: "Min Stock (g)", value: (r) => grams(r.minStockMg ?? 0), align: "right" },
          { key: "wt", label: "Stock Wt (g)", value: (r) => grams(r.weightMg), align: "right", render: (r) => <span className="font-semibold text-red-600">{grams(r.weightMg)}</span> },
          { key: "pcs", label: "Stock Qty (pcs)", value: (r) => r.pieces, align: "right" },
          { key: "loc", label: "Location", value: (r) => r.location },
        ]}
      />
    </div>
  );
}
