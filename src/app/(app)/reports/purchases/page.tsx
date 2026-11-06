"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangePicker, defaultLast30Days } from "@/components/date-range-picker";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

export default function PurchaseReportsPage() {
  const [range, setRange] = useState(defaultLast30Days());
  const report = useQuery(api.reports.getPurchaseReport, range);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Reports</h1>
          <p className="text-sm text-muted-foreground">Supplier-wise totals and purity breakdown for a date range.</p>
        </div>
        {report && (
          <ExportCsvButton
            filename="purchase-report"
            headers={["Supplier", "Invoices", "Total (₹)"]}
            rows={report.bySupplier.map((s) => [s.name, s.count, s.totalPaise / 100])}
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
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Purchases</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">{formatPaise(report.totalPurchasesPaise)}</p>
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
              <CardTitle className="text-base">By Supplier</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {report.bySupplier.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <ShoppingCart className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No purchases in this range.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Invoices</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.bySupplier.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{s.count}</TableCell>
                        <TableCell className="text-right">{formatPaise(s.totalPaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Purity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {report.byPurity.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No purchase items in this range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Purity</TableHead>
                      <TableHead className="text-right">Net Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byPurity.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{p.label}</TableCell>
                        <TableCell className="text-right">{mgToGramsDisplay(p.netWeightMg)}g</TableCell>
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
