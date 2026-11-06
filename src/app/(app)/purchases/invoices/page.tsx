"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Id } from "../../../../../convex/_generated/dataModel";

function PurchaseDetailDialog({ purchaseId, onClose }: { purchaseId: Id<"purchases">; onClose: () => void }) {
  const items = useQuery(api.purchases.getItems, { purchaseId });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Purchase items</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}

export default function PurchaseInvoicesPage() {
  const purchases = useQuery(api.purchases.list);
  const suppliers = useQuery(api.suppliers.list);
  const [selected, setSelected] = useState<Id<"purchases"> | null>(null);

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
        <Button asChild>
          <Link href="/purchases/new">
            <Plus className="h-4 w-4" />
            New Purchase
          </Link>
        </Button>
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
                    <TableRow key={p._id} className="cursor-pointer" onClick={() => setSelected(p._id)}>
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

      {selected && <PurchaseDetailDialog purchaseId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
