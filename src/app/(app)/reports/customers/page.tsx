"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";

const BUCKET_TONE: Record<string, "secondary" | "outline" | "destructive"> = {
  "0-30": "secondary",
  "31-60": "outline",
  "61-90": "outline",
  "90+": "destructive",
};

export default function CustomerReportsPage() {
  const router = useRouter();
  const aging = useQuery(api.reports.getCustomerAging);

  const totals = aging?.reduce<Record<string, number>>((acc, r) => {
    acc[r.bucket] = (acc[r.bucket] ?? 0) + r.outstandingPaise;
    return acc;
  }, {});

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customer Reports</h1>
        <p className="text-sm text-muted-foreground">
          Outstanding balances aged by days since the customer&apos;s oldest unpaid bill.
        </p>
      </div>

      {totals && Object.keys(totals).length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {["0-30", "31-60", "61-90", "90+"].map((bucket) => (
            <Card key={bucket}>
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{bucket} days</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold tracking-tight">{formatPaise(totals[bucket] ?? 0)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outstanding Customers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {aging === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : aging.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No outstanding customer balances.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aging.map((r) => (
                  <TableRow
                    key={r.customerId}
                    className="cursor-pointer"
                    onClick={() => router.push(`/customers/ledgers?customerId=${r.customerId}`)}
                  >
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant={BUCKET_TONE[r.bucket]}>{r.bucket} days</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatPaise(r.outstandingPaise)}</TableCell>
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
