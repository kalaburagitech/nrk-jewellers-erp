"use client";

import { DeleteDocumentButton } from "@/components/delete-document-button";
import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";
import { PurchaseReturnFormDialog } from "@/components/purchase-return-form";

export default function PurchaseReturnsPage() {
  const rows = useQuery(api.purchases.listByDocumentType, { documentType: "purchase_return" });
  const selection = useRecordSelection(rows?.map((row) => row._id) ?? [], "purchaseReturns");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Returns</h1>
          <p className="text-sm text-muted-foreground">
            Items sent back to a supplier — removed from stock and credited against what we owe them.
          </p>
        </div>
        <PurchaseReturnFormDialog />
      </div>

      <BulkRecordActions selection={selection} table="purchases" />

      <Card>
        <CardContent className="p-0">
          {rows === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Undo2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No purchase returns yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={(checked) => selection.selectAll(checked === true)} /></TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r._id} data-state={selection.has(r._id) ? "selected" : undefined}>
                    <TableCell><Checkbox aria-label={`Select ${r.invoiceNumber}`} checked={selection.has(r._id)} onCheckedChange={() => selection.toggle(r._id)} /></TableCell>
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{r.invoiceNumber}</Badge>
                      <DeleteDocumentButton compact table="purchases" id={r._id} name={r.invoiceNumber} />
                    </TableCell>
                    <TableCell>{r.supplierName}</TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="text-right">{formatPaise(r.totalPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
