"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportHeader, ReportTable, SummaryTiles, grams } from "@/components/report-kit";

export default function ItemStockSummaryPage() {
  const rows = useQuery(api.stockReports.itemStock);
  const [category, setCategory] = useState("all");
  const categories = [...new Set(rows?.map((r) => r.category) ?? [])].sort();
  const visible = rows?.filter((r) => category === "all" || r.category === category);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Stock Summary"
        description="Current stock of every item with its value at purchase price."
        controls={
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 w-48" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
      {visible && (
        <SummaryTiles tiles={[{ label: "Total Stock Value", paise: visible.reduce((a, r) => a + (r.valuePaise ?? 0), 0), tone: "blue" }]} />
      )}
      <ReportTable
        rows={visible}
        rowKey={(r) => r.id}
        csvName="stock-summary"
        columns={[
          { key: "name", label: "Item Name", value: (r) => r.name },
          { key: "code", label: "Item Code", value: (r) => r.code },
          { key: "cat", label: "Category", value: (r) => r.category },
          { key: "sale", label: "Sale Price", value: (r) => r.salePricePaise ?? 0, money: true, align: "right" },
          { key: "purchase", label: "Purchase Price", value: (r) => r.purchasePricePaise ?? 0, money: true, align: "right" },
          { key: "pcs", label: "Stock Qty (pcs)", value: (r) => r.pieces, align: "right", total: true },
          { key: "wt", label: "Stock Wt (g)", value: (r) => grams(r.weightMg), align: "right", total: true },
          { key: "value", label: "Stock Value", value: (r) => r.valuePaise ?? 0, money: true, align: "right", total: true },
        ]}
        footerNote="Stock value uses each item's purchase price (per gram for gram items, per piece otherwise). Items without a purchase price show ₹0."
      />
    </div>
  );
}
