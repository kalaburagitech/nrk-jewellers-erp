"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Eye, Pencil, Plus, Printer, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TransactionReportDialog } from "@/components/transaction-report-dialog";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import type { Doc } from "../../../../../convex/_generated/dataModel";

function PurchaseDetailDialog({ purchase, onClose }: { purchase: Doc<"purchases">; onClose: () => void }) {
  const items = useQuery(api.purchases.getItems, { purchaseId: purchase._id });
  const access = useQuery(api.organizations.getMyAccess);
  const cancelPurchase = useMutation(api.purchases.cancel);
  const canEdit = access?.membership?.role === "owner" || access?.membership?.role === "admin";

  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await cancelPurchase({ purchaseId: purchase._id, reason });
      onClose();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not delete this bill."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-center justify-between pr-6">
          <DialogTitle>Purchase items</DialogTitle>
          {purchase.status === "finalized" && <Button variant="outline" size="sm" asChild><Link href={`/purchases/invoices/${purchase._id}/print`} target="_blank"><Printer className="h-4 w-4" />Print bill</Link></Button>}
          {canEdit && purchase.status === "finalized" && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/purchases/new?edit=${purchase._id}`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          )}
        </DialogHeader>
        {items === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Net wt (g)</TableHead>
                  <TableHead>Rate / g</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell className="font-medium">{item.label}</TableCell>
                    <TableCell>{mgToGramsDisplay(item.netWeightMg)}</TableCell>
                    <TableCell>{formatPaise(item.ratePerGramPaise)}</TableCell>
                    <TableCell className="text-right">{formatPaise(item.lineTotalPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {deleting && (
          <Dialog open onOpenChange={(open) => !open && setDeleting(false)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete bill {purchase.invoiceNumber}?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This reverses the stock and supplier balance effects, then keeps the bill in deleted records with its audit history.
              </p>
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered by mistake" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleting(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
                  {submitting ? "Deleting…" : "Delete bill"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PurchaseInvoicesPage() {
  const purchases = useQuery(api.purchases.list);
  const suppliers = useQuery(api.suppliers.list);
  const access = useQuery(api.organizations.getMyAccess);
  const [selected, setSelected] = useState<Doc<"purchases"> | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const canEdit = access?.membership?.role === "owner" || access?.membership?.role === "admin";

  const supplierName = useMemo(() => {
    const map = new Map<string, string>();
    suppliers?.forEach((s) => map.set(s._id, s.name));
    return map;
  }, [suppliers]);

  const filteredPurchases = useMemo(() => purchases?.filter(row => {
    const q = search.trim().toLowerCase();
    const supplier = supplierName.get(row.supplierId)?.toLowerCase() ?? "";
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    return (!q || row.invoiceNumber.toLowerCase().includes(q) || supplier.includes(q)) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }), [purchases, search, dateFrom, dateTo, supplierName]);
  const selection = useRecordSelection(filteredPurchases?.map(row => row._id) ?? [], `purchases:${search}:${dateFrom}:${dateTo}`);
  const totals = filteredPurchases?.reduce((sum, row) => ({ total: sum.total + row.totalPaise, paid: sum.paid + row.amountPaidPaise }), { total: 0, paid: 0 });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Invoices</h1>
          <p className="text-sm text-muted-foreground">{purchases?.length ?? 0} purchases recorded</p>
        </div>
        <div className="flex gap-2">
          {purchases && (
            <TransactionReportDialog
              label={selection.count ? `Export ${selection.count} selected` : "Export all CSV"}
              filename="purchase-invoices"
              rows={(selection.count ? (filteredPurchases ?? []).filter(row => selection.has(row._id)) : (filteredPurchases ?? []))}
              fields={[
                { id: "date", label: "Date", value: (p) => new Date(p.createdAt).toLocaleDateString("en-IN") },
                { id: "invoice", label: "Invoice No.", value: (p) => p.invoiceNumber },
                { id: "party", label: "Party Name", value: (p) => supplierName.get(p.supplierId) ?? "—" },
                { id: "total", label: "Total", value: (p) => formatPaise(p.totalPaise) },
                { id: "paid", label: "Paid", value: (p) => formatPaise(p.amountPaidPaise) },
                { id: "balance", label: "Balance Due", value: (p) => formatPaise(Math.max(0, p.totalPaise - p.amountPaidPaise)) },
                { id: "status", label: "Payment Status", value: (p) => p.amountPaidPaise >= p.totalPaise ? "Paid" : p.amountPaidPaise > 0 ? "Partly paid" : "Unpaid" },
                { id: "phone", label: "Party's Phone No.", value: (p) => suppliers?.find((party) => party._id === p.supplierId)?.phone ?? "—" },
                { id: "gstin", label: "Party's GSTIN", value: (p) => suppliers?.find((party) => party._id === p.supplierId)?.gstin ?? "—" },
                { id: "items", label: "Item Details", value: (p) => p.reportItemDetails },
                { id: "description", label: "Description", value: (p) => p.reportDescription },
                { id: "paymentType", label: "Payment Type", value: (p) => p.reportPaymentType },
                { id: "paymentBreakup", label: "Show Payment Breakup", value: (p) => p.reportPaymentBreakup },
              ]}
            />
          )}
          <Button asChild>
            <Link href="/purchases/new">
              <Plus className="h-4 w-4" />
              New Purchase
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3"><Input placeholder="Search invoice or supplier" value={search} onChange={e => setSearch(e.target.value)} /><Input aria-label="From date" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /><Input aria-label="To date" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
      <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-semibold">{formatPaise(totals?.paid ?? 0)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Unpaid</p><p className="text-xl font-semibold">{formatPaise((totals?.total ?? 0) - (totals?.paid ?? 0))}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-semibold">{formatPaise(totals?.total ?? 0)}</p></CardContent></Card></div>

      <BulkRecordActions selection={selection} table="purchases" />

      <Card>
        <CardContent className="p-0">
          {purchases === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : filteredPurchases?.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No purchases recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPurchases?.map((p) => (
                    <TableRow key={p._id} data-state={selection.has(p._id) ? "selected" : undefined} className="cursor-pointer" onClick={() => setSelected(p)}>
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox aria-label={`Select ${p.invoiceNumber}`} checked={selection.has(p._id)} onCheckedChange={() => selection.toggle(p._id)} /></TableCell>
                      <TableCell className="font-medium">{p.invoiceNumber}</TableCell>
                      <TableCell>{new Date(p.createdAt).toLocaleDateString("en-IN")}</TableCell>
                      <TableCell>{supplierName.get(p.supplierId) ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatPaise(p.totalPaise)}</TableCell>
                      <TableCell className="text-right">{formatPaise(p.amountPaidPaise)}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "finalized" ? "secondary" : "destructive"} className="capitalize">
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title={`View ${p.invoiceNumber}`} aria-label={`View ${p.invoiceNumber}`} onClick={() => setSelected(p)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canEdit && p.status === "finalized" && (
                            <>
                              <Button asChild variant="ghost" size="icon" title={`Edit ${p.invoiceNumber}`} aria-label={`Edit ${p.invoiceNumber}`}>
                                <Link href={`/purchases/new?edit=${p._id}`}>
                                  <Pencil className="h-4 w-4" />
                                </Link>
                              </Button>
                              <DeleteDocumentButton compact table="purchases" id={p._id} name={p.invoiceNumber} />
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && <PurchaseDetailDialog purchase={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
