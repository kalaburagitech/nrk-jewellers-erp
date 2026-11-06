"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker, defaultLast30Days } from "@/components/date-range-picker";
import { formatPaise } from "@/lib/money";

export default function GstReportsPage() {
  const [range, setRange] = useState(defaultLast30Days());
  const salesRegister = useQuery(api.reports.getGstSalesRegister, range);
  const purchaseRegister = useQuery(api.reports.getGstPurchaseRegister, range);

  const summary = useMemo(() => {
    const outputCgst = salesRegister?.reduce((sum, r) => sum + r.cgstPaise, 0) ?? 0;
    const outputSgst = salesRegister?.reduce((sum, r) => sum + r.sgstPaise, 0) ?? 0;
    const outputIgst = salesRegister?.reduce((sum, r) => sum + r.igstPaise, 0) ?? 0;
    const outputTotal = outputCgst + outputSgst + outputIgst;
    const inputTotal = purchaseRegister?.reduce((sum, r) => sum + r.taxPaise, 0) ?? 0;
    return { outputCgst, outputSgst, outputIgst, outputTotal, inputTotal, netLiability: outputTotal - inputTotal };
  }, [salesRegister, purchaseRegister]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GST Reports</h1>
        <p className="text-sm text-muted-foreground">
          Output and input tax for the selected range. Supporting data for GSTR-1/3B — not a filing
          submission.
        </p>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Output GST (sales)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tracking-tight">{formatPaise(summary.outputTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Input GST (purchases)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tracking-tight">{formatPaise(summary.inputTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Liability</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tracking-tight">{formatPaise(summary.netLiability)}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Register</TabsTrigger>
          <TabsTrigger value="purchases">Purchase Register</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">
          <Card>
            <CardContent className="p-0">
              {salesRegister === undefined ? (
                <p className="p-6 text-sm text-muted-foreground">Loading…</p>
              ) : salesRegister.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Receipt className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No GST sales in this range.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                        <TableHead className="text-right">IGST</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesRegister.map((r) => (
                        <TableRow key={r.saleId}>
                          <TableCell>{new Date(r.createdAt).toLocaleDateString("en-IN")}</TableCell>
                          <TableCell className="font-medium">{r.invoiceNumber}</TableCell>
                          <TableCell>{r.customerName}</TableCell>
                          <TableCell className="text-right">{formatPaise(r.taxableValuePaise)}</TableCell>
                          <TableCell className="text-right">{formatPaise(r.cgstPaise)}</TableCell>
                          <TableCell className="text-right">{formatPaise(r.sgstPaise)}</TableCell>
                          <TableCell className="text-right">{formatPaise(r.igstPaise)}</TableCell>
                          <TableCell className="text-right font-medium">{formatPaise(r.totalPaise)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="purchases">
          <Card>
            <CardContent className="p-0">
              {purchaseRegister === undefined ? (
                <p className="p-6 text-sm text-muted-foreground">Loading…</p>
              ) : purchaseRegister.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Receipt className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No GST purchases in this range.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchaseRegister.map((r) => (
                        <TableRow key={r.purchaseId}>
                          <TableCell>{new Date(r.createdAt).toLocaleDateString("en-IN")}</TableCell>
                          <TableCell className="font-medium">{r.invoiceNumber}</TableCell>
                          <TableCell>{r.supplierName}</TableCell>
                          <TableCell className="text-right">{formatPaise(r.subtotalPaise)}</TableCell>
                          <TableCell className="text-right">{formatPaise(r.taxPaise)}</TableCell>
                          <TableCell className="text-right font-medium">{formatPaise(r.totalPaise)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
