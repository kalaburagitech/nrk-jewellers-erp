"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";

export default function OutstandingBalancesPage() {
  const router = useRouter();
  const customers = useQuery(api.customers.listWithOutstanding);

  const outstanding = useMemo(
    () => customers?.filter((c) => c.outstandingPaise > 0).sort((a, b) => b.outstandingPaise - a.outstandingPaise),
    [customers],
  );

  const totalOutstanding = useMemo(
    () => outstanding?.reduce((sum, c) => sum + c.outstandingPaise, 0) ?? 0,
    [outstanding],
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Outstanding Balances</h1>
        <p className="text-sm text-muted-foreground">Customers who currently owe money, highest first.</p>
      </div>

      {outstanding && outstanding.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Total receivable</p>
            <p className="text-2xl font-semibold tracking-tight">{formatPaise(totalOutstanding)}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {outstanding === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : outstanding.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No outstanding customer balances.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Credit limit</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstanding.map((c) => (
                    <TableRow
                      key={c._id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/customers/ledgers?customerId=${c._id}`)}
                    >
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {c.customerType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.creditLimitPaise ? formatPaise(c.creditLimitPaise) : "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          c.creditLimitPaise && c.outstandingPaise > c.creditLimitPaise ? "text-destructive" : ""
                        }`}
                      >
                        {formatPaise(c.outstandingPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
