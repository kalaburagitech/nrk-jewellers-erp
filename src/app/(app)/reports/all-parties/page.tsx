"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportHeader, ReportTable, SummaryTiles } from "@/components/report-kit";

type Filter = "all" | "customer" | "supplier" | "receivable" | "payable";

export default function AllPartiesPage() {
  const router = useRouter();
  const parties = useQuery(api.partyReports.allParties);
  const [filter, setFilter] = useState<Filter>("all");

  const rows = parties?.filter((p) =>
    filter === "all" ? true
    : filter === "receivable" ? p.receivablePaise > 0
    : filter === "payable" ? p.payablePaise > 0
    : p.partyType === filter,
  );

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="All Parties"
        description="Every customer and supplier with what they owe you and what you owe them. Click a party to open their statement."
        controls={
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="h-9 w-48" aria-label="Filter parties">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All parties</SelectItem>
              <SelectItem value="customer">Customers</SelectItem>
              <SelectItem value="supplier">Suppliers</SelectItem>
              <SelectItem value="receivable">Receivable only</SelectItem>
              <SelectItem value="payable">Payable only</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {rows && (
        <SummaryTiles
          tiles={[
            { label: "Total Receivable", paise: rows.reduce((a, r) => a + r.receivablePaise, 0), tone: "green" },
            { label: "Total Payable", paise: rows.reduce((a, r) => a + r.payablePaise, 0), tone: "red" },
          ]}
        />
      )}
      <ReportTable
        rows={rows}
        rowKey={(r) => `${r.partyType}:${r.id}`}
        csvName="all-parties"
        onRowClick={(r) => router.push(`/reports/party-statement?party=${r.partyType}:${r.id}`)}
        columns={[
          { key: "name", label: "Party Name", value: (r) => r.name },
          { key: "type", label: "Type", value: (r) => (r.partyType === "customer" ? "Customer" : "Supplier") },
          { key: "email", label: "Email", value: (r) => r.email },
          { key: "phone", label: "Phone No.", value: (r) => r.phone },
          { key: "recv", label: "Receivable Balance", value: (r) => r.receivablePaise, money: true, align: "right", total: true, render: (r) => <span className="text-emerald-600">{fmt(r.receivablePaise)}</span> },
          { key: "pay", label: "Payable Balance", value: (r) => r.payablePaise, money: true, align: "right", total: true, render: (r) => <span className="text-red-600">{fmt(r.payablePaise)}</span> },
          { key: "limit", label: "Credit Limit", value: (r) => r.creditLimitPaise ?? "", align: "right", render: (r) => (r.creditLimitPaise === null ? "—" : fmt(r.creditLimitPaise)) },
        ]}
      />
    </div>
  );
}

const fmt = (paise: number) => (paise ? `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—");
