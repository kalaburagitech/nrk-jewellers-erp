"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, grams, usePeriod } from "@/components/report-kit";

export default function SalePurchaseByCategoryPage() {
  const period = usePeriod();
  const rows = useQuery(api.partyReports.salePurchaseByCategory, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Sale / Purchase Report By Item Category" description="Quantity, weight and amount sold and bought for each item category." controls={<PeriodPicker state={period} />} />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.category}
        csvName="sale-purchase-by-category"
        columns={[
          { key: "cat", label: "Category", value: (r) => r.category },
          { key: "sq", label: "Sale Qty", value: (r) => r.saleQty, align: "right", total: true },
          { key: "sw", label: "Sale Wt (g)", value: (r) => grams(r.saleWeightMg), align: "right", total: true },
          { key: "sa", label: "Sale Amount", value: (r) => r.salePaise, money: true, align: "right", total: true },
          { key: "pq", label: "Purchase Qty", value: (r) => r.purchaseQty, align: "right", total: true },
          { key: "pw", label: "Purchase Wt (g)", value: (r) => grams(r.purchaseWeightMg), align: "right", total: true },
          { key: "pa", label: "Purchase Amount", value: (r) => r.purchasePaise, money: true, align: "right", total: true },
        ]}
      />
    </div>
  );
}
