"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker, defaultLast30Days } from "@/components/date-range-picker";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatPaise } from "@/lib/money";

const PAYMENT_MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  old_gold_exchange: "Old Gold / Silver Exchange",
};

export default function SalesReportPage() {
  const [range, setRange] = useState(defaultLast30Days());
  const report = useQuery(api.reports.getSalesReport, range);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Report</h1>
          <p className="text-sm text-muted-foreground">Turnover and payment mode breakdown for a date range.</p>
        </div>
        {report && (
          <ExportCsvButton
            filename="sales-report"
            headers={["Date", "Invoices", "Total (₹)"]}
            rows={report.byDay.map((d) => [new Date(d.date).toLocaleDateString("en-IN"), d.count, d.totalPaise / 100])}
          />
        )}
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {report === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">{formatPaise(report.totalSalesPaise)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">{report.totalInvoiceCount}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment Mode Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {report.byPaymentMode.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded in this range.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {report.byPaymentMode.map((p) => (
                    <Badge key={p.mode} variant="secondary" className="font-normal">
                      {PAYMENT_MODE_LABEL[p.mode] ?? p.mode}: {formatPaise(p.amountPaise)}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {report.byDay.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <BarChart3 className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No sales recorded in this range.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Invoices</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byDay.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell>{new Date(d.date).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell>{d.count}</TableCell>
                        <TableCell className="text-right">{formatPaise(d.totalPaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
