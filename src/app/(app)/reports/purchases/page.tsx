"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Calendar, Printer, Search, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker, defaultLast30Days } from "@/components/date-range-picker";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

export default function PurchaseReportsPage() {
  const [range, setRange] = useState(defaultLast30Days());
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("transactions");
  const report = useQuery(api.reports.getPurchaseReport, range);

  const transactions = report?.transactions ?? [];

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const q = search.trim().toLowerCase();
      return (
        !q ||
        t.invoiceNumber.toLowerCase().includes(q) ||
        t.supplierName.toLowerCase().includes(q) ||
        (t.supplierPhone && t.supplierPhone.includes(q))
      );
    });
  }, [transactions, search]);

  function handlePeriodChange(val: string) {
    const now = new Date();
    let start = new Date();
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (val === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (val === "yesterday") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    } else if (val === "this-week") {
      const day = now.getDay() || 7;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0, 0);
    } else if (val === "this-month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else if (val === "this-quarter") {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1, 0, 0, 0, 0);
    } else if (val === "this-year") {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    } else if (val === "last-30") {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    setRange({
      startDate: start.getTime(),
      endDate: end.getTime(),
    });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/* Vyapar Page Header & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Purchase Report</h1>
          <p className="text-xs text-muted-foreground">
            Complete inward purchases register with supplier details, weights, taxes, and balance payments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {report && (
            <ExportCsvButton
              filename={`purchase-report-${new Date().toISOString().slice(0, 10)}`}
              headers={[
                "Date",
                "Bill No",
                "Supplier",
                "Pieces",
                "Gross Wt (g)",
                "Stone Wt (g)",
                "Net Wt (g)",
                "Tax (₹)",
                "Total (₹)",
                "Paid (₹)",
                "Balance (₹)",
                "Status",
              ]}
              rows={filtered.map((t) => [
                new Date(t.createdAt).toLocaleDateString("en-IN"),
                t.invoiceNumber,
                t.supplierName,
                t.pieces,
                Number(mgToGramsDisplay(t.grossWeightMg)),
                Number(mgToGramsDisplay(t.stoneWeightMg)),
                Number(mgToGramsDisplay(t.netWeightMg)),
                t.taxPaise / 100,
                t.totalPaise / 100,
                t.amountPaidPaise / 100,
                t.balancePaise / 100,
                t.status,
              ])}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 gap-1 text-xs"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print Report</span>
          </Button>
        </div>
      </div>

      {/* Vyapar Filter Toolbar */}
      <Card className="border-border/80 shadow-xs">
        <CardContent className="p-3.5 flex flex-wrap items-center gap-3">
          <div className="w-44">
            <Select defaultValue="last-30" onValueChange={handlePeriodChange}>
              <SelectTrigger className="h-8 text-xs">
                <Calendar className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="this-week">This Week</SelectItem>
                <SelectItem value="this-month">This Month</SelectItem>
                <SelectItem value="this-quarter">This Quarter</SelectItem>
                <SelectItem value="this-year">This Year</SelectItem>
                <SelectItem value="last-30">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DateRangePicker value={range} onChange={setRange} />

          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search bill no or supplier name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {report === undefined ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Loading purchase data…</p>
      ) : (
        <>
          {/* Vyapar 6 Summary Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Purchases
                </p>
                <p className="mt-0.5 text-base font-bold text-foreground tabular-nums">
                  {formatPaise(report.totalPurchasesPaise)}
                </p>
                <p className="text-[10px] text-muted-foreground">{report.totalInvoiceCount} Invoices</p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Paid
                </p>
                <p className="mt-0.5 text-base font-bold text-emerald-600 tabular-nums">
                  {formatPaise(report.totalPaidPaise)}
                </p>
                <p className="text-[10px] text-muted-foreground">Outward Paid</p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Balance Payable
                </p>
                <p className="mt-0.5 text-base font-bold text-rose-600 tabular-nums">
                  {formatPaise(report.totalBalancePaise)}
                </p>
                <p className="text-[10px] text-muted-foreground">To Pay</p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Gross Weight
                </p>
                <p className="mt-0.5 text-base font-bold text-foreground font-mono tabular-nums">
                  {mgToGramsDisplay(report.totalGrossWeightMg)}g
                </p>
                <p className="text-[10px] text-muted-foreground">{report.totalPieces} Pieces</p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Stone Weight
                </p>
                <p className="mt-0.5 text-base font-bold text-muted-foreground font-mono tabular-nums">
                  {mgToGramsDisplay(report.totalStoneWeightMg)}g
                </p>
                <p className="text-[10px] text-muted-foreground">Other / Stones</p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Net Weight
                </p>
                <p className="mt-0.5 text-base font-bold text-emerald-600 font-mono tabular-nums">
                  {mgToGramsDisplay(report.totalNetWeightMg)}g
                </p>
                <p className="text-[10px] text-muted-foreground">Pure Jewellery</p>
              </CardContent>
            </Card>
          </div>

          {/* Vyapar View Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
            <TabsList className="grid w-full grid-cols-3 sm:w-96">
              <TabsTrigger value="transactions" className="text-xs">
                All Purchases ({filtered.length})
              </TabsTrigger>
              <TabsTrigger value="supplier" className="text-xs">
                By Supplier
              </TabsTrigger>
              <TabsTrigger value="purity" className="text-xs">
                By Purity
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: All Purchases Register */}
            <TabsContent value="transactions" className="m-0">
              <Card className="border-border/80 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow className="bg-muted/40 font-semibold text-muted-foreground">
                        <TableHead className="w-8 py-2.5 px-3">#</TableHead>
                        <TableHead className="py-2.5 px-3 whitespace-nowrap">DATE</TableHead>
                        <TableHead className="py-2.5 px-3 whitespace-nowrap">BILL NO.</TableHead>
                        <TableHead className="py-2.5 px-3 min-w-36">SUPPLIER</TableHead>
                        <TableHead className="py-2.5 px-3 text-center whitespace-nowrap">PIECES</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">GROSS WT</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">STONE WT</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">NET WT</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">TAX (₹)</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">TOTAL (₹)</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">PAID (₹)</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">BALANCE (₹)</TableHead>
                        <TableHead className="py-2.5 px-3 text-center whitespace-nowrap">STATUS</TableHead>
                        <TableHead className="py-2.5 px-3 text-right whitespace-nowrap">ACTION</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border/50">
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={14} className="py-12 text-center text-muted-foreground">
                            <ShoppingCart className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                            No purchases recorded for the selected filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((t, index) => (
                          <TableRow key={t._id} className="hover:bg-muted/20">
                            <TableCell className="py-2.5 px-3 font-mono text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 whitespace-nowrap">
                              {new Date(t.createdAt).toLocaleDateString("en-IN")}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 whitespace-nowrap font-semibold text-primary">
                              {t.invoiceNumber}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 font-medium">
                              <div>{t.supplierName}</div>
                              {t.supplierPhone && (
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {t.supplierPhone}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-center tabular-nums">
                              {t.pieces}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {mgToGramsDisplay(t.grossWeightMg)}g
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-mono tabular-nums text-muted-foreground">
                              {mgToGramsDisplay(t.stoneWeightMg)}g
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-mono font-medium text-emerald-600 tabular-nums">
                              {mgToGramsDisplay(t.netWeightMg)}g
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatPaise(t.taxPaise)}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-semibold font-mono tabular-nums">
                              {formatPaise(t.totalPaise)}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-mono text-emerald-600 tabular-nums">
                              {formatPaise(t.amountPaidPaise)}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right font-semibold font-mono text-rose-600 tabular-nums">
                              {formatPaise(t.balancePaise)}
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-center">
                              <Badge
                                variant={
                                  t.status === "Paid"
                                    ? "secondary"
                                    : t.status === "Partial"
                                      ? "outline"
                                      : "destructive"
                                }
                                className={`text-[10px] font-normal uppercase ${
                                  t.status === "Paid"
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                    : t.status === "Partial"
                                      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                      : "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                }`}
                              >
                                {t.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2.5 px-3 text-right">
                              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                                <Link href={`/purchases/invoices/${t._id}/print`} target="_blank">
                                  Print
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}

                      {/* Vyapar Table Total Footer Row */}
                      {filtered.length > 0 && (
                        <TableRow className="bg-muted/50 font-bold border-t-2">
                          <TableCell colSpan={4} className="py-3 px-3">
                            Total Summary ({filtered.length} Purchases)
                          </TableCell>
                          <TableCell className="py-3 px-3 text-center tabular-nums">
                            {filtered.reduce((s, t) => s + t.pieces, 0)}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono tabular-nums">
                            {mgToGramsDisplay(filtered.reduce((s, t) => s + t.grossWeightMg, 0))}g
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono tabular-nums text-muted-foreground">
                            {mgToGramsDisplay(filtered.reduce((s, t) => s + t.stoneWeightMg, 0))}g
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono font-medium text-emerald-600 tabular-nums">
                            {mgToGramsDisplay(filtered.reduce((s, t) => s + t.netWeightMg, 0))}g
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatPaise(filtered.reduce((s, t) => s + t.taxPaise, 0))}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatPaise(filtered.reduce((s, t) => s + t.totalPaise, 0))}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono text-emerald-600 tabular-nums">
                            {formatPaise(filtered.reduce((s, t) => s + t.amountPaidPaise, 0))}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-mono text-rose-600 tabular-nums">
                            {formatPaise(filtered.reduce((s, t) => s + t.balancePaise, 0))}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </TabsContent>

            {/* TAB 2: By Supplier */}
            <TabsContent value="supplier" className="m-0">
              <Card className="border-border/80 shadow-xs overflow-hidden">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableHead>SUPPLIER NAME</TableHead>
                      <TableHead className="text-center">INVOICES COUNT</TableHead>
                      <TableHead className="text-right">TOTAL PURCHASES (₹)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.bySupplier.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-center">{s.count}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatPaise(s.totalPaise)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            {/* TAB 3: By Purity */}
            <TabsContent value="purity" className="m-0">
              <Card className="border-border/80 shadow-xs overflow-hidden">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableHead>PURITY</TableHead>
                      <TableHead className="text-right">GROSS WT (g)</TableHead>
                      <TableHead className="text-right">STONE WT (g)</TableHead>
                      <TableHead className="text-right">NET WT (g)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byPurity.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{p.label}</TableCell>
                        <TableCell className="text-right font-mono">
                          {mgToGramsDisplay(p.grossWeightMg)}g
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {mgToGramsDisplay(p.stoneWeightMg)}g
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-emerald-600">
                          {mgToGramsDisplay(p.netWeightMg)}g
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
