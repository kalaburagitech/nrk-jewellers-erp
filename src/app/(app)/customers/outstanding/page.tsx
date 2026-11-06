"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { MessageCircle, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";
import type { Doc } from "../../../../../convex/_generated/dataModel";

function dueDateInputValue(dueDateMs: number | undefined) {
  return dueDateMs ? new Date(dueDateMs).toISOString().slice(0, 10) : "";
}

function reminderWhatsAppUrl(phone: string | undefined, name: string, outstandingPaise: number, dueDateMs: number | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  const dueText = dueDateMs ? ` by ${new Date(dueDateMs).toLocaleDateString("en-IN")}` : "";
  const message = `Hello ${name}, a gentle reminder that ${formatPaise(outstandingPaise)} is due${dueText} at NRK Jewellers. Please clear it at your earliest convenience. Thank you!`;
  const base = withCountryCode ? `https://wa.me/${withCountryCode}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

function DueDateCell({ customer }: { customer: Doc<"customers"> & { outstandingPaise: number } }) {
  const setDueDate = useMutation(api.customers.setDueDate);
  const isOverdue = customer.dueDateMs !== undefined && customer.dueDateMs < new Date().getTime();

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Input
        type="date"
        className="h-8 w-36"
        value={dueDateInputValue(customer.dueDateMs)}
        onChange={(e) => {
          const ms = e.target.value ? new Date(e.target.value).getTime() : undefined;
          setDueDate({ id: customer._id, dueDateMs: ms });
        }}
      />
      {isOverdue && <Badge variant="destructive">Overdue</Badge>}
    </div>
  );
}

export default function OutstandingBalancesPage() {
  const router = useRouter();
  const customers = useQuery(api.customers.listWithOutstanding);

  const outstanding = useMemo(() => {
    const now = new Date().getTime();
    return customers
      ?.filter((c) => c.outstandingPaise > 0)
      .sort((a, b) => {
        const aOverdue = a.dueDateMs !== undefined && a.dueDateMs < now;
        const bOverdue = b.dueDateMs !== undefined && b.dueDateMs < now;
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        return b.outstandingPaise - a.outstandingPaise;
      });
  }, [customers]);

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
                    <TableHead>Due date</TableHead>
                    <TableHead></TableHead>
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
                      <TableCell>
                        <DueDateCell customer={c} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={reminderWhatsAppUrl(c.phone, c.name, c.outstandingPaise, c.dueDateMs)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MessageCircle className="h-4 w-4" />
                            Remind
                          </a>
                        </Button>
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
