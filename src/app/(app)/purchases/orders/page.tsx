"use client";

import { DeleteDocumentButton } from "@/components/delete-document-button";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ShoppingCart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";
import { PurchaseOrderFormDialog } from "@/components/purchase-order-form";

export default function PurchaseOrdersPage() {
  const rows = useQuery(api.purchases.listByDocumentType, { documentType: "purchase_order" });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">
            A commitment to buy from a supplier — no stock is received yet until a purchase invoice is recorded.
          </p>
        </div>
        <PurchaseOrderFormDialog />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ShoppingCart className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Estimated Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r._id}>
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{r.invoiceNumber}</Badge>
                      <DeleteDocumentButton table="purchases" id={r._id} name={r.invoiceNumber} />
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
