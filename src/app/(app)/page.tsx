"use client";
import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  Boxes,
  Receipt,
  ShoppingCart,
  MessageCircle,
  ArrowUpRight,
  Landmark,
  DatabaseBackup,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetalRateTicker } from "@/components/metal-rate-ticker";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export default function DashboardPage() {
  const summary = useQuery(api.dashboard.getSummary);
  const rates = useQuery(api.metalRates.getCurrent);
  const boxes = useQuery(api.boxes.list);
  const access = useQuery(api.organizations.getMyAccess);
  const router = useRouter();
  const latest = summary?.recentInvoices[0]?._id;
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!["F2", "F3", "F4"].includes(e.key)) return;
      e.preventDefault();
      if (e.key === "F2") router.push("/sales/new");
      else if (e.key === "F3") router.push("/purchases/new");
      else if (latest)
        router.push(`/sales/invoices/${latest}/print?autoShare=1`);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [router, latest]);
  const payment = (mode: string) =>
    summary ? formatPaise(summary.todaysPaymentsByMode[mode] ?? 0) : "—";
  return (
    <div className="counter-dashboard mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-5">
          <Image
            src="/nrk-logo.png"
            width={116}
            height={72}
            alt="NRK Jewellers"
            className="rounded bg-white object-contain"
            priority
          />
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              The Name of Purity
            </p>
            <h1 className="text-xl font-bold sm:text-2xl">
              {access?.organization?.name || "NR Karakalli Jewellers"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your daily counter overview
            </p>
          </div>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Asia/Kolkata",
            })}
          </p>
          <p className="mt-1 text-muted-foreground">Gold & Silver Merchants</p>
        </div>
      </div>
      <MetalRateTicker currentRates={rates} />
      <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wide">
              Daily sales overview
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {[
              [
                "Total sales today",
                summary ? formatPaise(summary.todaysSalesPaise) : "—",
              ],
              ["Cash receipts", payment("cash")],
              ["UPI / Scan", payment("upi")],
              [
                "Old metal exchange",
                summary ? formatPaise(summary.todaysOldGoldExchangePaise) : "—",
              ],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={`rounded-lg border p-4 ${i === 0 ? "border-blue-200 bg-blue-50 text-blue-950" : "bg-muted/30"}`}
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wide">
              Real-time weight-based stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 border-b pb-4">
              <div>
                <p className="text-xs text-muted-foreground">Total gold</p>
                <p className="mt-1 text-2xl font-semibold">
                  {summary ? mgToGramsDisplay(summary.goldStockMg) : "—"}
                  <span className="ml-1 text-sm text-muted-foreground">g</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total silver</p>
                <p className="mt-1 text-2xl font-semibold">
                  {summary ? mgToGramsDisplay(summary.silverStockMg) : "—"}
                  <span className="ml-1 text-sm text-muted-foreground">g</span>
                </p>
              </div>
            </div>
            <div className="mt-3 max-h-36 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-2 text-left">Purity</th>
                    <th className="text-left">Metal</th>
                    <th className="text-right">Net weight (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.stockByPurity.map((row) => (
                    <tr key={row.purityId} className="border-t">
                      <td className="py-2 font-medium">{row.label}</td>
                      <td className="capitalize text-muted-foreground">
                        {row.metal}
                      </td>
                      <td className="text-right font-medium tabular-nums">
                        {mgToGramsDisplay(row.netWeightMg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary?.stockByPurity.length === 0 && (
                <p className="py-3 text-sm text-muted-foreground">
                  Add metal purities to see your stock breakdown.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="gap-4">
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-wide">
            Box management system
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/boxes">
              Manage boxes
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {boxes === undefined ? (
            <p className="text-sm text-muted-foreground">Loading boxes…</p>
          ) : boxes.length === 0 ? (
            <Link href="/boxes" className="text-sm text-primary underline">
              Create your first stock box
            </Link>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {boxes.slice(0, 16).map((box) => (
                <Link
                  href="/boxes"
                  key={box._id}
                  className="group flex items-center gap-2 rounded-lg border bg-muted/25 p-3 transition hover:border-blue-400 hover:bg-blue-50"
                >
                  <Boxes className="h-7 w-7 shrink-0 text-gold" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Box {box.boxNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {box.itemCount ?? 0} pieces
                    </p>
                    {box.label && (
                      <p className="truncate text-xs text-muted-foreground">
                        {box.label}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="rounded-xl border bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Quick action center
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            asChild
            className="h-12 bg-emerald-700 text-white hover:bg-emerald-800"
          >
            <Link href="/sales/new">
              <Receipt className="h-4 w-4" />
              F2 · New retail invoice
            </Link>
          </Button>
          <Button asChild className="h-12">
            <Link href="/purchases/new">
              <ShoppingCart className="h-4 w-4" />
              F3 · Supplier purchase
            </Link>
          </Button>
          {latest ? (
            <Button
              asChild
              className="h-12 bg-slate-700 text-white hover:bg-slate-800"
            >
              <Link href={`/sales/invoices/${latest}/print?autoShare=1`}>
                <MessageCircle className="h-4 w-4" />
                F4 · Share via WhatsApp
              </Link>
            </Button>
          ) : (
            <Button disabled className="h-12" variant="outline">
              <MessageCircle className="h-4 w-4" />
              Share after your first invoice
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Customer receivables", summary?.totalReceivablesPaise],
          ["Supplier payables", summary?.totalPayablesPaise],
          ["Today's purchases", summary?.todaysPurchasesPaise],
          ["Net cash from payments", summary?.netCashPaise],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {typeof value === "number" ? formatPaise(value) : "—"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {summary && summary.lowStockCount > 0 && (
        <Link
          href="/inventory/products"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {summary.lowStockCount} products are below their reorder level. Review
          stock →
        </Link>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sales · last 7 days</CardTitle>
          </CardHeader>
          <CardContent className="h-48">
            {summary && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={summary.trend.map((t) => ({
                    date: new Date(t.date).toLocaleDateString("en-IN", {
                      weekday: "short",
                    }),
                    sales: t.salesPaise / 100,
                  }))}
                >
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(value) => [
                      `₹${Number(value).toLocaleString("en-IN")}`,
                      "Sales",
                    ]}
                  />
                  <Area
                    dataKey="sales"
                    type="monotone"
                    stroke="#2664a5"
                    fill="#dbeafe"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm">Recent invoices</CardTitle>
            <Link href="/sales/invoices" className="text-xs text-primary">
              View all →
            </Link>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-3">Invoice</th>
                  <th>Customer</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary?.recentInvoices.slice(0, 5).map((inv) => (
                  <tr key={inv._id} className="border-t">
                    <td className="py-3 font-medium">
                      <Link
                        href={`/sales/invoices/${inv._id}/print`}
                        className="text-primary"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td>{inv.customerName}</td>
                    <td className="text-right font-medium">
                      {formatPaise(inv.totalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary?.recentInvoices.length === 0 && (
              <p className="py-5 text-sm text-muted-foreground">
                No invoices yet. Create a retail invoice to get started.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/girvi">
            <Landmark className="h-4 w-4" />
            Girvi metal loans
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/backup">
            <DatabaseBackup className="h-4 w-4" />
            Backup & restore
          </Link>
        </Button>
      </div>
    </div>
  );
}
