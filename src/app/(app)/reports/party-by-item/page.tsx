"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodPicker, ReportHeader, ReportTable, grams, usePeriod } from "@/components/report-kit";

export default function PartyReportByItemPage() {
  const period = usePeriod();
  const [categoryId, setCategoryId] = useState("all");
  const [productId, setProductId] = useState("all");
  const categories = useQuery(api.stockCategories.list);
  const products = useQuery(api.products.list);
  const rows = useQuery(api.partyReports.partyReportByItem, {
    ...period.range,
    categoryId: categoryId === "all" ? undefined : (categoryId as Id<"stockCategories">),
    productId: productId === "all" ? undefined : (productId as Id<"products">),
  });
  const productOptions = (products ?? []).filter((p) => categoryId === "all" || p.stockCategoryId === categoryId);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Party Report By Item"
        description="How much of an item (or category) each party bought from you or sold to you."
        controls={
          <>
            <PeriodPicker state={period} />
            <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setProductId("all"); }}>
              <SelectTrigger className="h-9 w-44" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="h-9 w-52" aria-label="Item"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items</SelectItem>
                {productOptions.map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        csvName="party-report-by-item"
        columns={[
          { key: "name", label: "Party Name", value: (r) => r.name },
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
