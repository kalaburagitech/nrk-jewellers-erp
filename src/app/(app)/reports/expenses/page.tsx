"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodPicker, ReportHeader, ReportTable, SummaryTiles, fmtDate, usePeriod } from "@/components/report-kit";

export default function ExpenseReportPage() {
  const period = usePeriod();
  const [tab, setTab] = useState("transactions");
  const all = useQuery(api.expenses.list);
  const rows = all?.filter((e) => e.expenseDate >= period.range.startDate && e.expenseDate <= period.range.endDate);
  const byCategory = rows
    ? [...rows.reduce((m, e) => {
        const c = m.get(e.category) ?? { category: e.category, count: 0, amountPaise: 0 };
        c.count += 1;
        c.amountPaise += e.amountPaise;
        return m.set(e.category, c);
      }, new Map<string, { category: string; count: number; amountPaise: number }>()).values()].sort((a, b) => b.amountPaise - a.amountPaise)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Expense Report" description="Shop expenses by transaction and by category." controls={<PeriodPicker state={period} />} />
      {rows && <SummaryTiles tiles={[{ label: "Total Expense", paise: rows.reduce((a, e) => a + e.amountPaise, 0), tone: "red" }]} />}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="transactions">Expense Transactions</TabsTrigger>
          <TabsTrigger value="category">Expense Category Report</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions">
          <ReportTable
            rows={rows}
            rowKey={(e) => e._id}
            csvName="expense-transactions"
            columns={[
              { key: "date", label: "Date", value: (e) => e.expenseDate, render: (e) => fmtDate(e.expenseDate) },
              { key: "cat", label: "Category", value: (e) => e.category },
              { key: "desc", label: "Description", value: (e) => e.description ?? "" },
              { key: "amt", label: "Amount", value: (e) => e.amountPaise, money: true, align: "right", total: true },
            ]}
          />
        </TabsContent>
        <TabsContent value="category">
          <ReportTable
            rows={byCategory}
            rowKey={(c) => c.category}
            csvName="expense-category-report"
            columns={[
              { key: "cat", label: "Expense Category", value: (c) => c.category },
              { key: "count", label: "Entries", value: (c) => c.count, align: "right", total: true },
              { key: "amt", label: "Amount", value: (c) => c.amountPaise, money: true, align: "right", total: true },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
