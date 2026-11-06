"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  AlertTriangle,
  Coins,
  Gem,
  Package,
  Plus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Users2,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | undefined;
  icon: ComponentType<{ className?: string }>;
  tone?: "default" | "destructive";
}) {
  return (
    <Card className="gap-2">
      <CardHeader className="flex flex-row items-center justify-between pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone === "destructive" ? "text-destructive" : "text-gold"}`} />
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          <p className="text-2xl font-semibold tracking-tight text-muted-foreground/50">—</p>
        ) : (
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

const QUICK_ACTIONS = [
  { label: "New Bill", href: "/sales/new", icon: Receipt },
  { label: "New Purchase", href: "/purchases/new", icon: ShoppingCart },
  { label: "Customers", href: "/customers", icon: Users2 },
  { label: "Box Overview", href: "/boxes", icon: Package },
];

export default function DashboardPage() {
  const summary = useQuery(api.dashboard.getSummary);
  const currentRates = useQuery(api.metalRates.getCurrent);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Business overview, calculated from recorded sales, purchases and stock — nothing here is
          placeholder data.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((action) => (
          <Button key={action.href} variant="outline" asChild>
            <Link href={action.href}>
              <action.icon className="h-4 w-4" />
              {action.label}
            </Link>
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Today's Sales"
          value={summary && formatPaise(summary.todaysSalesPaise)}
          icon={TrendingUp}
        />
        <MetricCard
          label="Today's Purchases"
          value={summary && formatPaise(summary.todaysPurchasesPaise)}
          icon={ShoppingCart}
        />
        <MetricCard
          label="Net Cash (from payments)"
          value={summary && formatPaise(summary.netCashPaise)}
          icon={Wallet}
        />
        <MetricCard
          label="Customer Receivables"
          value={summary && formatPaise(summary.totalReceivablesPaise)}
          icon={Users2}
        />
        <MetricCard
          label="Supplier Payables"
          value={summary && formatPaise(summary.totalPayablesPaise)}
          icon={ShoppingCart}
        />
        <MetricCard
          label="Gold Stock"
          value={summary && `${mgToGramsDisplay(summary.goldStockMg)}g`}
          icon={Coins}
        />
        <MetricCard
          label="Silver Stock"
          value={summary && `${mgToGramsDisplay(summary.silverStockMg)}g`}
          icon={Coins}
        />
        <MetricCard
          label="Ornaments in Stock"
          value={summary && String(summary.totalOrnamentCount)}
          icon={Gem}
        />
      </div>

      {summary && summary.lowStockCount > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm">
              <span className="font-medium">{summary.lowStockCount} product(s)</span> are below
              their reorder level.{" "}
              <Link href="/inventory/products" className="underline">
                Review products
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Metal Rates</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/metal-rates">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {currentRates === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : currentRates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No purities configured yet.</p>
            ) : (
              currentRates.map(({ purity, latest }) => (
                <div key={purity._id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{purity.label}</span>
                  <span className="font-medium">{latest ? formatPaise(latest.ratePerGramPaise) : "—"}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sales/invoices">
                View all
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {summary === undefined ? (
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            ) : summary.recentInvoices.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Receipt className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No bills recorded yet.</p>
                <Button size="sm" asChild>
                  <Link href="/sales/new">
                    <Plus className="h-4 w-4" />
                    Create the first bill
                  </Link>
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.recentInvoices.map((inv) => (
                    <TableRow key={inv._id}>
                      <TableCell className="font-medium">
                        <Badge variant="secondary">{inv.invoiceNumber}</Badge>
                      </TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell>{new Date(inv.createdAt).toLocaleDateString("en-IN")}</TableCell>
                      <TableCell className="text-right">{formatPaise(inv.totalPaise)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
