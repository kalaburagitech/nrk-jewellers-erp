"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { FileSpreadsheet, FileText, Landmark, Printer, Receipt, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker, type DateRange } from "@/components/date-range-picker";
import { formatPaise } from "@/lib/money";
import { exportExcel, exportPdf, financialYears, type ReportTable } from "@/lib/report-export";
import GstConfigurationPage from "../settings/gst/page";

const CUSTOM = "custom";
const rupees = (paise: number) => Math.round(paise) / 100;
const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { timeZone: "UTC" });

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "in" | "out" | "net" }) {
  const color = tone === "out" ? "text-rose-600" : tone === "in" ? "text-emerald-600" : "text-foreground";
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Receipt className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/**
 * Central GST module for NRK Karakalli Jewellers: dashboard, rates/settings,
 * HSN codes and every GST report, all read live from the existing GST
 * invoices and purchase bills. Daily Sales (non-GST) bills are not part of it.
 */
export default function GstModulePage() {
  const years = useMemo(() => financialYears(), []);
  const [period, setPeriod] = useState<string>(years[0].key);
  const [custom, setCustom] = useState<DateRange>(() => ({ startDate: years[0].startDate, endDate: Date.now() }));
  const range = useMemo(() => {
    if (period === CUSTOM) return custom;
    const fy = years.find((y) => y.key === period) ?? years[0];
    return { startDate: fy.startDate, endDate: fy.endDate };
  }, [period, custom, years]);
  const periodLabel = period === CUSTOM ? `${dateText(range.startDate)} – ${dateText(range.endDate)}` : years.find((y) => y.key === period)?.label ?? "";

  const data = useQuery(api.gst.report, range);
  const hsnMaster = useQuery(api.gst.hsnCodes);
  const [tab, setTab] = useState("dashboard");

  const tables = useMemo<Record<string, ReportTable> | null>(() => {
    if (!data) return null;
    const componentRows = (key: "cgstPaise" | "sgstPaise" | "igstPaise") => [
      ...data.sales.filter((r) => r[key] > 0).map((r) => [dateText(r.createdAt), "Sale (output)", r.invoiceNumber, r.customerName, r.customerGstin ?? "", rupees(r.taxableValuePaise), rupees(r[key])]),
      ...data.purchases.filter((r) => r[key] > 0).map((r) => [dateText(r.createdAt), "Purchase (input)", r.invoiceNumber, r.supplierName, r.supplierGstin ?? "", rupees(r.taxableValuePaise), rupees(r[key])]),
    ] as (string | number)[][];
    const componentHeaders = (name: string) => ["Date", "Type", "Invoice", "Party", "GSTIN", "Taxable (₹)", `${name} (₹)`];
    return {
      sales: {
        title: "Sales GST Register (Taxable Sales)",
        headers: ["Date", "Invoice", "Customer", "GSTIN", "Place of supply", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Total tax (₹)", "Invoice total (₹)"],
        rows: data.sales.map((r) => [dateText(r.createdAt), r.invoiceNumber, r.customerName, r.customerGstin ?? "", r.placeOfSupply ?? "", rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise), rupees(r.totalTaxPaise), rupees(r.totalPaise)]),
        numericColumns: [5, 6, 7, 8, 9, 10],
      },
      purchases: {
        title: "Purchase GST Register (Taxable Purchases)",
        headers: ["Date", "Bill", "Supplier", "GSTIN", "Supply", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Total tax (₹)", "Bill total (₹)"],
        rows: data.purchases.map((r) => [dateText(r.createdAt), r.invoiceNumber, r.supplierName, r.supplierGstin ?? "", r.isInterState ? "Inter-state" : "Intra-state", rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise), rupees(r.totalTaxPaise), rupees(r.totalPaise)]),
        numericColumns: [5, 6, 7, 8, 9, 10],
      },
      cgst: { title: "CGST Report", headers: componentHeaders("CGST"), rows: componentRows("cgstPaise"), numericColumns: [5, 6] },
      sgst: { title: "SGST Report", headers: componentHeaders("SGST"), rows: componentRows("sgstPaise"), numericColumns: [5, 6] },
      igst: { title: "IGST Report", headers: componentHeaders("IGST"), rows: componentRows("igstPaise"), numericColumns: [5, 6] },
      hsn: {
        title: "HSN-wise Summary (Sales)",
        headers: ["HSN", "GST rate %", "Pieces", "Net wt (g)", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)"],
        rows: data.hsnSummary.map((r) => [r.hsnCode, r.ratePercent, r.pieces, Number((r.netWeightMg / 1000).toFixed(3)), rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise)]),
        numericColumns: [1, 2, 3, 4, 5, 6, 7],
      },
      summary: {
        title: "GST Summary",
        headers: ["Particulars", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Total tax (₹)"],
        rows: [
          ["Output tax — GST sales", rupees(data.output.taxableValuePaise), rupees(data.output.cgstPaise), rupees(data.output.sgstPaise), rupees(data.output.igstPaise), rupees(data.output.cgstPaise + data.output.sgstPaise + data.output.igstPaise)],
          ["Input tax — GST purchases", rupees(data.input.taxableValuePaise), rupees(data.input.cgstPaise), rupees(data.input.sgstPaise), rupees(data.input.igstPaise), rupees(data.input.cgstPaise + data.input.sgstPaise + data.input.igstPaise)],
          ["Net payable (output − input)", "", rupees(data.net.cgstPaise), rupees(data.net.sgstPaise), rupees(data.net.igstPaise), rupees(data.net.cgstPaise + data.net.sgstPaise + data.net.igstPaise)],
          ...data.rateSummary.map((r) => [`Sales @ ${r.ratePercent}%`, rupees(r.taxableValuePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise), rupees(r.cgstPaise + r.sgstPaise + r.igstPaise)]),
        ],
        numericColumns: [1, 2, 3, 4, 5],
      },
    };
  }, [data]);

  // Export what's on screen: the active report, or the whole GST pack from Dashboard/Summary.
  const exportTables = (): ReportTable[] => {
    if (!tables) return [];
    if (tables[tab]) return tab === "summary" ? [tables.summary, tables.hsn] : [tables[tab]];
    return [tables.summary, tables.sales, tables.purchases, tables.hsn];
  };
  const heading = `${data?.company.name || "NRK Karakalli Jewellers"} — GST Reports`;
  const subheading = `${periodLabel}${data?.company.gstin ? ` · GSTIN ${data.company.gstin}` : ""}${data?.company.state ? ` · ${data.company.state}` : ""}`;
  const fileBase = `gst-${tab}-${period}`;

  const totalOutput = data ? data.output.cgstPaise + data.output.sgstPaise + data.output.igstPaise : 0;
  const totalInput = data ? data.input.cgstPaise + data.input.sgstPaise + data.input.igstPaise : 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 print:max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Landmark className="h-6 w-6 text-primary" />GST</h1>
          <p className="text-sm text-muted-foreground">
            GST dashboard, rates, HSN codes and reports for GST invoices and purchases. Supporting data for GSTR-1 / GSTR-3B — not a filing submission.
          </p>
          <p className="mt-1 hidden text-sm font-medium print:block">{heading} · {subheading}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" disabled={!tables} onClick={() => exportPdf(fileBase, heading, subheading, exportTables())}>
            <FileText className="h-4 w-4" />Export PDF
          </Button>
          <Button variant="outline" size="sm" disabled={!tables} onClick={() => exportExcel(fileBase, `${heading} (${subheading})`, exportTables())}>
            <FileSpreadsheet className="h-4 w-4" />Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />Print
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-3 print:hidden">
        <div className="grid gap-2">
          <Label>Financial year</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44" aria-label="Financial year"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y.key} value={y.key}>{y.label}</SelectItem>)}
              <SelectItem value={CUSTOM}>Custom dates…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {period === CUSTOM && <DateRangePicker value={custom} onChange={setCustom} />}
        <p className="pb-2 text-xs text-muted-foreground">Showing {periodLabel}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="overflow-x-auto print:hidden">
          <TabsList className="w-max">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="sales">Sales GST</TabsTrigger>
            <TabsTrigger value="purchases">Purchase GST</TabsTrigger>
            <TabsTrigger value="cgst">CGST</TabsTrigger>
            <TabsTrigger value="sgst">SGST</TabsTrigger>
            <TabsTrigger value="igst">IGST</TabsTrigger>
            <TabsTrigger value="hsn">HSN Summary</TabsTrigger>
            <TabsTrigger value="summary">GST Summary</TabsTrigger>
            <TabsTrigger value="hsn-codes">HSN Codes</TabsTrigger>
            <TabsTrigger value="settings">Settings &amp; Rates</TabsTrigger>
          </TabsList>
        </div>

        {data === undefined && !["settings", "hsn-codes"].includes(tab) && <p className="text-sm text-muted-foreground">Loading GST data…</p>}

        <TabsContent value="dashboard" className="flex flex-col gap-4">
          {data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Taxable sales" value={formatPaise(data.output.taxableValuePaise)} sub={`${data.output.invoiceCount} GST invoice(s)`} />
                <Stat label="Output GST" value={formatPaise(totalOutput)} tone="out" sub="collected on sales" />
                <Stat label="Taxable purchases" value={formatPaise(data.input.taxableValuePaise)} sub={`${data.input.billCount} GST bill(s)`} />
                <Stat label="Input GST" value={formatPaise(totalInput)} tone="in" sub="paid on purchases" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Stat label="CGST payable" value={formatPaise(data.net.cgstPaise)} />
                <Stat label="SGST payable" value={formatPaise(data.net.sgstPaise)} />
                <Stat label="IGST payable" value={formatPaise(data.net.igstPaise)} />
                <Stat label="Net GST liability" value={formatPaise(totalOutput - totalInput)} tone="net" sub="output − input" />
              </div>
              <Card>
                <CardHeader className="pb-0"><CardTitle className="text-sm">Sales by GST rate</CardTitle></CardHeader>
                <CardContent>
                  {data.rateSummary.length === 0 ? <Empty text="No GST sales in this period." /> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Rate</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead><TableHead className="text-right">IGST</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {data.rateSummary.map((r) => (
                          <TableRow key={r.ratePercent}>
                            <TableCell><Badge variant="outline">{r.ratePercent}%</Badge></TableCell>
                            <TableCell className="text-right">{formatPaise(r.taxableValuePaise)}</TableCell>
                            <TableCell className="text-right">{formatPaise(r.cgstPaise)}</TableCell>
                            <TableCell className="text-right">{formatPaise(r.sgstPaise)}</TableCell>
                            <TableCell className="text-right">{formatPaise(r.igstPaise)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground">
                Company: {data.company.name || "—"} · GSTIN {data.company.gstin || "not set"} · State {data.company.state || "not set"}.
                Intra-state bills are split CGST + SGST; bills to another state are IGST. {!data.company.state && "Set the company state under Settings → Business Profile so inter-state bills are detected."}
              </p>
            </>
          )}
        </TabsContent>

        {(["sales", "purchases", "cgst", "sgst", "igst", "hsn", "summary"] as const).map((key) => (
          <TabsContent key={key} value={key}>
            {tables && <ReportTableView table={tables[key]} />}
          </TabsContent>
        ))}

        <TabsContent value="hsn-codes">
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">HSN codes in use</CardTitle>
              <p className="text-xs text-muted-foreground">HSN and GST rate are set per item (Items → Add/Edit Item). Jewellery of gold/silver is usually HSN 7113.</p>
            </CardHeader>
            <CardContent>
              {hsnMaster === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : hsnMaster.codes.length === 0 ? <Empty text="No HSN codes yet. Add an HSN code to your items." /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>HSN</TableHead><TableHead>GST rates</TableHead><TableHead>Items</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {hsnMaster.codes.map((row) => (
                      <TableRow key={row.hsnCode}>
                        <TableCell className="font-mono font-semibold">{row.hsnCode}</TableCell>
                        <TableCell className="text-xs">{row.rateNames.join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs">{row.items.map((i) => `${i.name}${i.ratePercent !== undefined ? ` (${i.ratePercent}%)` : ""}`).join(", ") || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {hsnMaster && hsnMaster.itemsWithoutHsn.length > 0 && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                  {hsnMaster.itemsWithoutHsn.length} item(s) have no HSN code: {hsnMaster.itemsWithoutHsn.slice(0, 8).map((i) => i.name).join(", ")}{hsnMaster.itemsWithoutHsn.length > 8 ? "…" : ""}.{" "}
                  <Link href="/inventory/products" className="underline">Edit items</Link>
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="text-sm">
                <p className="font-semibold">GST registration</p>
                <p className="text-muted-foreground">GSTIN {data?.company.gstin || "not set"} · State {data?.company.state || "not set"}</p>
              </div>
              <Button asChild variant="outline" size="sm"><Link href="/settings/business"><Settings2 className="h-4 w-4" />Edit business profile</Link></Button>
            </CardContent>
          </Card>
          <GstConfigurationPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReportTableView({ table }: { table: ReportTable }) {
  const numeric = new Set(table.numericColumns ?? []);
  // Totals for money columns (headers ending in ₹).
  const totals = table.headers.map((h, i) => (numeric.has(i) && h.includes("₹") ? table.rows.reduce((sum, row) => sum + (typeof row[i] === "number" ? (row[i] as number) : 0), 0) : null));
  const showTotals = table.title !== "GST Summary" && table.rows.length > 0;
  return (
    <Card>
      <CardHeader className="pb-0"><CardTitle className="text-sm">{table.title}</CardTitle></CardHeader>
      <CardContent className="p-0 sm:px-2">
        {table.rows.length === 0 ? <Empty text="No records in this period." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>{table.headers.map((h, i) => <TableHead key={h} className={numeric.has(i) ? "text-right" : ""}>{h}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((row, r) => (
                  <TableRow key={r}>
                    {row.map((cell, i) => (
                      <TableCell key={i} className={numeric.has(i) ? "text-right tabular-nums" : i === 0 ? "whitespace-nowrap" : ""}>
                        {typeof cell === "number" && table.headers[i].includes("₹") ? formatPaise(Math.round(cell * 100)) : cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              {showTotals && (
                <TableFooter>
                  <TableRow>
                    {totals.map((t, i) => (
                      <TableCell key={i} className={`font-semibold ${numeric.has(i) ? "text-right tabular-nums" : ""}`}>
                        {i === 0 ? "Total" : t !== null ? formatPaise(Math.round(t * 100)) : ""}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
