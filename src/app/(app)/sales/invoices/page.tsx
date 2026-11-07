"use client";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Pencil, Plus, Printer, Receipt, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportCsvButton } from "@/components/export-csv-button";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Id } from "../../../../../convex/_generated/dataModel";

function SaleDetailDialog({ saleId, onClose }: { saleId: Id<"sales">; onClose: () => void }) {
  const cancel = useMutation(api.sales.cancel);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const items = useQuery(api.sales.getItems, { saleId });
  const oldGoldExchange = useQuery(api.sales.getOldGoldExchange, { saleId });
  const access = useQuery(api.organizations.getMyAccess);
  const canEdit = access?.membership?.role === "owner" || access?.membership?.role === "admin";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-center justify-between pr-6">
          <DialogTitle>Sale items</DialogTitle>
          <div className="flex flex-wrap gap-2">
            {canEdit && <Button variant="destructive" size="sm" disabled={deleting} onClick={async () => {
              const reason = window.prompt("Delete invoice and reverse its stock and payments. Enter a reason:");
              if (!reason?.trim()) return;
              setDeleting(true);
              try { await cancel({ saleId, reason }); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); } finally { setDeleting(false); }
            }}>Delete</Button>}
            {canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sales/new?edit=${saleId}`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sales/invoices/${saleId}/print`} target="_blank">
                <Printer className="h-4 w-4" />
                Print / Share
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sales/invoices/${saleId}/eway-bill`} target="_blank">
                <Truck className="h-4 w-4" />
                E-Way Bill
              </Link>
            </Button>
          </div>
        </DialogHeader>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {items === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gross wt (g)</TableHead>
                  <TableHead>Net wt (g)</TableHead>
                  <TableHead>Rate / g</TableHead>
                  <TableHead>Wastage</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell>{mgToGramsDisplay(item.grossWeightMg)}</TableCell>
                    <TableCell>{mgToGramsDisplay(item.netWeightMg)}</TableCell>
                    <TableCell>{formatPaise(item.ratePerGramPaise)}</TableCell>
                    <TableCell>{(item.wastageBasisPoints / 100).toFixed(2)}%</TableCell>
                    <TableCell>{formatPaise(item.lineTaxPaise)}</TableCell>
                    <TableCell className="text-right">{formatPaise(item.lineTotalPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {oldGoldExchange && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Old gold / silver exchange</p>
            <p className="text-muted-foreground">
              {mgToGramsDisplay(oldGoldExchange.netWeightMg)}g net (after{" "}
              {(oldGoldExchange.meltingDeductionBasisPoints / 100).toFixed(2)}% melting deduction) @{" "}
              {formatPaise(oldGoldExchange.ratePerGramPaise)}/g ={" "}
              <span className="font-medium text-foreground">{formatPaise(oldGoldExchange.exchangeValuePaise)}</span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function SalesInvoicesPage() {
  const sales = useQuery(api.sales.list);
  const customers = useQuery(api.customers.list);
  const access = useQuery(api.organizations.getMyAccess);
  const [selected, setSelected] = useState<Id<"sales"> | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const canEdit = access?.membership?.role === "owner" || access?.membership?.role === "admin";

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    customers?.forEach((c) => map.set(c._id, c.name));
    return map;
  }, [customers]);

  const filteredSales = useMemo(() => sales?.filter(row => {
    const q = search.trim().toLowerCase();
    const customer = customerName.get(row.customerId)?.toLowerCase() ?? "";
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    return (!q || row.invoiceNumber.toLowerCase().includes(q) || customer.includes(q)) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }), [sales, search, dateFrom, dateTo, customerName]);
  const selection = useRecordSelection(filteredSales?.map(row => row._id) ?? [], `sales:${search}:${dateFrom}:${dateTo}`);
  const totals = filteredSales?.reduce((sum, row) => ({ total: sum.total + row.totalPaise, paid: sum.paid + row.amountPaidPaise }), { total: 0, paid: 0 });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Invoices</h1>
          <p className="text-sm text-muted-foreground">{sales?.length ?? 0} invoices recorded</p>
        </div>
        <div className="flex gap-2">
          {sales && (
            <ExportCsvButton
              label={selection.count ? `Export ${selection.count} selected` : "Export all CSV"}
              filename="sales-invoices"
              headers={["Invoice #", "Date", "Customer", "GST", "Total (₹)", "Paid (₹)", "Status"]}
              rows={(selection.count ? (filteredSales ?? []).filter(row => selection.has(row._id)) : (filteredSales ?? [])).map((s) => [
                s.invoiceNumber,
                new Date(s.createdAt).toLocaleDateString("en-IN"),
                customerName.get(s.customerId) ?? "—",
                s.isGst ? "GST" : "Non-GST",
                s.totalPaise / 100,
                s.amountPaidPaise / 100,
                s.status,
              ])}
            />
          )}
          <Button asChild>
            <Link href="/sales/new">
              <Plus className="h-4 w-4" />
              New Bill
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3"><Input placeholder="Search invoice or customer" value={search} onChange={e => setSearch(e.target.value)} /><Input aria-label="From date" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /><Input aria-label="To date" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
      <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total sales</p><p className="text-xl font-semibold">{formatPaise(totals?.total ?? 0)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-semibold">{formatPaise(totals?.paid ?? 0)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Balance due</p><p className="text-xl font-semibold">{formatPaise((totals?.total ?? 0) - (totals?.paid ?? 0))}</p></CardContent></Card></div>

      <BulkRecordActions selection={selection} table="sales" />

      <Card>
        <CardContent className="p-0">
          {sales === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : filteredSales?.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No bills recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="w-24 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSales?.map((s) => (
                    <TableRow key={s._id} data-state={selection.has(s._id) ? "selected" : undefined} className="cursor-pointer" onClick={() => setSelected(s._id)}>
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox aria-label={`Select ${s.invoiceNumber}`} checked={selection.has(s._id)} onCheckedChange={() => selection.toggle(s._id)} /></TableCell>
                      <TableCell className="font-medium">{s.invoiceNumber}</TableCell>
                      <TableCell>{new Date(s.createdAt).toLocaleDateString("en-IN")}</TableCell>
                      <TableCell>{customerName.get(s.customerId) ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{s.isGst ? "GST" : "Non-GST"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatPaise(s.totalPaise)}</TableCell>
                      <TableCell className="text-right">{formatPaise(s.amountPaidPaise)}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === "finalized" ? "secondary" : "destructive"} className="capitalize">
                          {s.status}
                        </Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                          {s.status === "finalized" && (
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="ghost" size="icon" title={`Edit ${s.invoiceNumber}`} aria-label={`Edit ${s.invoiceNumber}`}>
                                <Link href={`/sales/new?edit=${s._id}`}>
                                  <Pencil className="h-4 w-4" />
                                </Link>
                              </Button>
                              <DeleteDocumentButton compact table="sales" id={s._id} name={s.invoiceNumber} />
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && <SaleDetailDialog saleId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
