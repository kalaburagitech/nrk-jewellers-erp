"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Users } from "lucide-react";
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

function CustomerLedgerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customers = useQuery(api.customers.list);
  const customerId = (searchParams.get("customerId") as Id<"customers"> | null) ?? customers?.[0]?._id ?? null;

  const ledger = useQuery(api.customers.getLedger, customerId ? { customerId } : "skip");
  const sales = useQuery(api.sales.listByCustomer, customerId ? { customerId } : "skip");

  const saleByEntry = useMemo(() => {
    const map = new Map<string, Doc<"sales">>();
    sales?.forEach((s) => map.set(s._id, s));
    return map;
  }, [sales]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customer Ledgers</h1>
        <p className="text-sm text-muted-foreground">Customer-wise sales and payment ledger.</p>
      </div>

      {customers && customers.length > 0 && (
        <Select
          value={customerId ?? undefined}
          onValueChange={(v) => router.push(`/customers/ledgers?customerId=${v}`)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select customer" />
          </SelectTrigger>
          <SelectContent>
            {customers.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
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
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No bills recorded for this customer yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="text-right">Bill</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.entries.map((entry) => {
                    const sale = saleByEntry.get(entry.sourceId);
                    return (
                      <TableRow key={entry._id}>
                        <TableCell>{new Date(entry.createdAt).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell>{sale ? <Badge variant="secondary">{sale.invoiceNumber}</Badge> : "—"}</TableCell>
                        <TableCell className="text-right">{formatPaise(entry.debitPaise)}</TableCell>
                        <TableCell className="text-right">{formatPaise(entry.creditPaise)}</TableCell>
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

export default function CustomerLedgersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <CustomerLedgerContent />
    </Suspense>
  );
}
