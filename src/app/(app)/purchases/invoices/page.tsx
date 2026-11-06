"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
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
      setError(e instanceof Error ? e.message : "Could not delete this bill.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-center justify-between pr-6">
          <DialogTitle>Purchase items</DialogTitle>
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
                This reverses the stock it added and the supplier balance it affected. It can&apos;t be undone.
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
  const [selected, setSelected] = useState<Doc<"purchases"> | null>(null);

  const supplierName = useMemo(() => {
    const map = new Map<string, string>();
    suppliers?.forEach((s) => map.set(s._id, s.name));
    return map;
  }, [suppliers]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Invoices</h1>
          <p className="text-sm text-muted-foreground">{purchases?.length ?? 0} purchases recorded</p>
        </div>
        <div className="flex gap-2">
          {purchases && (
            <ExportCsvButton
              filename="purchase-invoices"
              headers={["Invoice #", "Date", "Supplier", "Total (₹)", "Paid (₹)", "Status"]}
              rows={purchases.map((p) => [
                p.invoiceNumber,
                new Date(p.createdAt).toLocaleDateString("en-IN"),
                supplierName.get(p.supplierId) ?? "—",
                p.totalPaise / 100,
                p.amountPaidPaise / 100,
                p.status,
              ])}
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

      <Card>
        <CardContent className="p-0">
          {purchases === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : purchases.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No purchases recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p) => (
                    <TableRow key={p._id} className="cursor-pointer" onClick={() => setSelected(p)}>
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
