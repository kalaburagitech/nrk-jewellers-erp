"use client";

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r._id}>
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{r.invoiceNumber}</Badge>
                    </TableCell>
                    <TableCell>{r.supplierName}</TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="text-right">{formatPaise(r.totalPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
