"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPaise } from "@/lib/money";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

function SupplierHistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const suppliers = useQuery(api.suppliers.list);
  const supplierId = (searchParams.get("supplierId") as Id<"suppliers"> | null) ?? suppliers?.[0]?._id ?? null;

  const ledger = useQuery(api.suppliers.getLedger, supplierId ? { supplierId } : "skip");
  const purchases = useQuery(api.purchases.listBySupplier, supplierId ? { supplierId } : "skip");

  const purchaseByEntry = useMemo(() => {
    const map = new Map<string, Doc<"purchases">>();
    purchases?.forEach((p) => map.set(p._id, p));
    return map;
  }, [purchases]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Purchase History</h1>
        <p className="text-sm text-muted-foreground">Supplier-wise purchase and payment ledger.</p>
      </div>

      {suppliers && suppliers.length > 0 && (
        <Select
          value={supplierId ?? undefined}
          onValueChange={(v) => router.push(`/suppliers/history?supplierId=${v}`)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select supplier" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map((s) => (
              <SelectItem key={s._id} value={s._id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {ledger && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">{formatPaise(ledger.outstandingPaise)}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ledger</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ledger === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : ledger.entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Truck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No purchases recorded for this supplier yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="text-right">Purchase</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.entries.map((entry) => {
                    const purchase = purchaseByEntry.get(entry.sourceId);
                    return (
                      <TableRow key={entry._id}>
                        <TableCell>{new Date(entry.createdAt).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell>
                          {purchase ? (
                            <Badge variant="secondary">{purchase.invoiceNumber}</Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">{formatPaise(entry.creditPaise)}</TableCell>
                        <TableCell className="text-right">{formatPaise(entry.debitPaise)}</TableCell>
                        <TableCell className="text-right font-medium">{formatPaise(entry.balancePaise)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SupplierHistoryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <SupplierHistoryContent />
    </Suspense>
  );
}
