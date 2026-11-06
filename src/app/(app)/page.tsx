"use client";

import type { ComponentType } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Coins,
  Gem,
  MessageCircle,
  Minus,
  Package,
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
import { MetalRateTicker } from "@/components/metal-rate-ticker";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

const PAYMENT_MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function DeltaBadge({ percent }: { percent: number | null | undefined }) {
  if (percent === null || percent === undefined) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
        <Minus className="h-3 w-3" />
        —
      </span>
    );
  }
  const positive = percent > 0;
  const flat = percent === 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        flat ? "text-muted-foreground" : positive ? "text-success" : "text-destructive"
      }`}
    >
      {flat ? <Minus className="h-3 w-3" /> : positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {flat ? "0%" : `${Math.abs(percent)}%`}
    </span>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#spark-${color.replace("#", "")})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  deltaPercent,
  sparklineData,
  sparklineColor,
}: {
  label: string;
  value: string | undefined;
  icon: ComponentType<{ className?: string }>;
  deltaPercent?: number | null;
  sparklineData?: number[];
  sparklineColor?: string;
}) {
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gold/10">
          <Icon className="h-4 w-4 text-gold" />
        </div>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          {value === undefined ? (
            <p className="text-2xl font-semibold tracking-tight text-muted-foreground/50">—</p>
          ) : (
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
          )}
          {deltaPercent !== undefined && (
            <div className="flex items-center gap-1">
              <DeltaBadge percent={deltaPercent} />
              <span className="text-xs text-muted-foreground">vs yesterday</span>
            </div>
          )}
        </div>
        {sparklineData && sparklineColor && <Sparkline data={sparklineData} color={sparklineColor} />}
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
  const router = useRouter();
  const summary = useQuery(api.dashboard.getSummary);
  const currentRates = useQuery(api.metalRates.getCurrent);
  const access = useQuery(api.organizations.getMyAccess);
  const boxes = useQuery(api.boxes.list);

  const firstName = (access?.user?.name ?? access?.user?.email ?? "").split(" ")[0] || "there";

  const salesSpark = summary?.trend.map((t) => t.salesPaise / 100);
  const purchasesSpark = summary?.trend.map((t) => t.purchasesPaise / 100);
  const cashSpark = summary?.trend.map((t) => t.cashPaise / 100);

  const chartData = summary?.trend.map((t) => ({
    label: new Date(t.date).toLocaleDateString("en-IN", { weekday: "short" }),
    sales: t.salesPaise / 100,
  }));

  const latestInvoiceId = summary?.recentInvoices[0]?._id;

  // F2/F3/F4 mirror the counter shortcuts on the billing screen, one level up: jump straight into a new bill,
  // a new purchase, or sharing the most recent invoice — without reaching for the mouse.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "F2" && e.key !== "F3" && e.key !== "F4") return;
      e.preventDefault();
      if (e.key === "F2") router.push("/sales/new");
      else if (e.key === "F3") router.push("/purchases/new");
      else if (latestInvoiceId) router.push(`/sales/invoices/${latestInvoiceId}/print?autoShare=1`);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, latestInvoiceId]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <MetalRateTicker currentRates={currentRates} />

      <div className="relative overflow-hidden rounded-xl border border-gold/20 bg-gradient-to-br from-gold/15 via-card to-card p-6">
        <div className="relative flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Business overview, calculated from recorded sales, purchases and stock — nothing here is
            placeholder data.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href="/sales/new">
            <Receipt className="h-4 w-4" />
            New Retail Invoice <span className="opacity-70">[F2]</span>
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/purchases/new">
            <ShoppingCart className="h-4 w-4" />
            Supplier Purchase <span className="text-muted-foreground">[F3]</span>
          </Link>
        </Button>
        {latestInvoiceId && (
          <Button variant="outline" asChild>
            <Link href={`/sales/invoices/${latestInvoiceId}/print?autoShare=1`}>
              <MessageCircle className="h-4 w-4" />
              Share via WhatsApp <span className="text-muted-foreground">[F4]</span>
            </Link>
          </Button>
        )}
        {QUICK_ACTIONS.filter((a) => a.href !== "/sales/new" && a.href !== "/purchases/new").map((action) => (
          <Button key={action.href} variant="ghost" asChild>
            <Link href={action.href}>
              <action.icon className="h-4 w-4" />
              {action.label}
            </Link>
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today's Sales"
          value={summary && formatPaise(summary.todaysSalesPaise)}
          icon={TrendingUp}
          deltaPercent={summary?.salesDeltaPercent}
          sparklineData={salesSpark}
          sparklineColor="#22c55e"
        />
        <StatCard
          label="Today's Purchases"
          value={summary && formatPaise(summary.todaysPurchasesPaise)}
          icon={ShoppingCart}
          deltaPercent={summary?.purchasesDeltaPercent}
          sparklineData={purchasesSpark}
          sparklineColor="#f59e0b"
        />
        <StatCard
          label="Net Cash (from payments)"
          value={summary && formatPaise(summary.netCashPaise)}
          icon={Wallet}
          deltaPercent={summary?.netCashDeltaPercent}
          sparklineData={cashSpark}
          sparklineColor="#60a5fa"
        />
        <StatCard
          label="Customer Receivables"
          value={summary && formatPaise(summary.totalReceivablesPaise)}
          icon={Users2}
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
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sales Overview — last 7 days</CardTitle>
          </CardHeader>
          <CardContent className="h-64 pl-0">
            {!chartData ? (
              <p className="px-6 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="sales-overview-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-gold)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-gold)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                    tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value) => [`₹${Number(value).toLocaleString("en-IN")}`, "Sales"]}
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="var(--color-gold)"
                    strokeWidth={2}
                    fill="url(#sales-overview-fill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Sales Overview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sales today</span>
              <span className="font-semibold">{summary ? formatPaise(summary.todaysSalesPaise) : "—"}</span>
            </div>
            {Object.entries(PAYMENT_MODE_LABEL).map(([mode, label]) => {
              const amount = summary?.todaysPaymentsByMode[mode];
              if (!amount) return null;
              return (
                <div key={mode} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span>{formatPaise(amount)}</span>
                </div>
              );
            })}
            {summary && summary.todaysOldGoldExchangePaise > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Old gold/silver exchange</span>
                <span>-{formatPaise(summary.todaysOldGoldExchangePaise)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weight-Based Live Stock Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {summary === undefined ? (
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            ) : summary.stockByPurity.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No purities configured yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Purity</TableHead>
                    <TableHead>Metal</TableHead>
                    <TableHead className="text-right">Fine Wt (g)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.stockByPurity.map((row) => (
                    <TableRow key={row.purityId}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{row.metal}</TableCell>
                      <TableCell className="text-right">{mgToGramsDisplay(row.netWeightMg)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Box Management</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/boxes">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {boxes === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : boxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No boxes yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {boxes.slice(0, 9).map((box) => (
                  <Link
                    key={box._id}
                    href="/boxes"
                    className="flex flex-col gap-1 rounded-md border border-border/60 p-2 text-sm hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-1 font-medium">
                      <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                      Box {box.boxNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">{box.itemCount ?? 0} pcs</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Gold Stock" value={summary && `${mgToGramsDisplay(summary.goldStockMg)}g`} icon={Coins} />
        <StatCard
          label="Silver Stock"
          value={summary && `${mgToGramsDisplay(summary.silverStockMg)}g`}
          icon={Coins}
        />
        <StatCard
          label="Ornaments in Stock"
          value={summary && String(summary.totalOrnamentCount)}
          icon={Gem}
        />
        <StatCard
          label="Supplier Payables"
          value={summary && formatPaise(summary.totalPayablesPaise)}
          icon={ShoppingCart}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sales/invoices">View all</Link>
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
                <Link href="/sales/new">Create the first bill</Link>
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
  );
}
