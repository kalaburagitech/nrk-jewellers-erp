"use client";

import { useEffect, useState } from "react";
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
  ArrowDownRight,
  Landmark,
  DatabaseBackup,
  PhoneCall,
  Headphones,
  Plus,
  Printer,
  ChevronRight,
  FileText,
  Calendar,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MetalRateTicker } from "@/components/metal-rate-ticker";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { DueRemindersCard } from "@/components/due-reminders";
import { useAccessInfo } from "@/components/access-context";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function DashboardPage() {
  const { isLocked } = usePrivacyLock();
  const [timeframe, setTimeframe] = useState<"week" | "month" | "quarter" | "half_year" | "year">("week");
  const summary = useQuery(api.dashboard.getSummary, { timeframe });
  const rates = useQuery(api.metalRates.getCurrent);
  const boxes = useQuery(api.boxes.list);
  const access = useQuery(api.organizations.getMyAccess);
  const router = useRouter();
  const { isViewOnly } = useAccessInfo();

  const latest = summary?.recentInvoices[0]?._id;

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!["F2", "F3", "F4"].includes(e.key)) return;
      e.preventDefault();
      if (isViewOnly && e.key !== "F4") return;
      if (e.key === "F2") router.push("/sales/new");
      else if (e.key === "F3") router.push("/purchases/new");
      else if (latest)
        router.push(`/sales/invoices/${latest}/print?autoShare=1`);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [router, latest, isViewOnly]);

  const payment = (mode: string) =>
    summary ? formatPaise(summary.todaysPaymentsByMode[mode] ?? 0) : "—";

  const istHour = Number(
    new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
  );
  const greeting = istHour < 12 ? "Good morning" : istHour < 17 ? "Good afternoon" : "Good evening";
  const firstName = access?.user?.name?.trim().split(/\s+/)[0];

  const totalReceivables = summary?.totalReceivablesPaise ?? 0;
  const totalPayables = summary?.totalPayablesPaise ?? 0;
  const totalSales = summary?.todaysSalesPaise ?? 0;
  const homePrefs = useQuery(api.appPreferences.get);
  const lowStock = useQuery(api.stockReports.itemStock)?.filter((r) => r.isLow && r.isActive) ?? [];

  return (
    <div className="counter-dashboard mx-auto flex max-w-7xl flex-col gap-5">
      {lowStock.length > 0 && homePrefs?.items.lowStockAlert !== false && (
        <Link href="/reports/low-stock" className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200">
          <span>
            <strong>Low stock:</strong> {lowStock.length} item{lowStock.length === 1 ? " is" : "s are"} below minimum stock
            {" "}({lowStock.slice(0, 3).map((r) => r.name).join(", ")}{lowStock.length > 3 ? "…" : ""})
          </span>
          <span className="shrink-0 font-semibold underline">View</span>
        </Link>
      )}
      {/* Vyapar Customer Support & Quick Actions Header Line (Page 5) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 text-xs text-muted-foreground border-b pb-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <span className="flex items-center gap-1 font-medium text-foreground">
            <PhoneCall className="h-3.5 w-3.5 text-primary" />
            Customer Support:
          </span>
          <a href="tel:+919333911911" className="hover:underline font-mono text-primary font-medium">
            +91-9333911911
          </a>
          <span>·</span>
          <a href="tel:+917795687633" className="hover:underline font-mono text-primary font-medium">
            +917795687633
          </a>
          <span className="hidden md:inline">|</span>
          <span className="hidden md:flex items-center gap-1 text-emerald-600 font-medium">
            <Headphones className="h-3.5 w-3.5" />
            Instant Online Support Active
          </span>
        </div>

        {/* Vyapar + Add Sale / + Add Purchase Buttons (Page 5) */}
        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            className="h-8 bg-[#d93025] hover:bg-[#b3261e] text-white font-medium shadow-sm"
          >
            <Link href="/sales/new">
              <Plus className="h-3.5 w-3.5" />
              Add Sale
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-8 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-medium shadow-sm"
          >
            <Link href="/purchases/new">
              <Plus className="h-3.5 w-3.5" />
              Add Purchase
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 w-8 p-0">
            <Link href="/reports/sales" title="Print Reports">
              <Printer className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Shop Identity Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3 sm:gap-5">
          <Image
            src="/nrk-logo-gold.png"
            width={116}
            height={72}
            alt="NRK Jewellers"
            className="h-12 w-20 sm:h-auto sm:w-auto rounded bg-white object-contain shadow-xs"
            priority
          />
          <div>
            <p className="mb-0.5 sm:mb-1 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              The Name of Purity
            </p>
            <h1 className="text-lg sm:text-2xl font-bold">
              {access?.organization?.name || "NR Karakalli Jewellers"}
            </h1>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-medium text-primary">
              {greeting}
              {firstName ? `, ${firstName}` : ""} · Your daily counter overview
            </p>
          </div>
        </div>
        <div className="text-left sm:text-right text-xs sm:text-sm border-t sm:border-t-0 pt-2 sm:pt-0 border-border/50">
          <p className="font-medium">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Asia/Kolkata",
            })}
          </p>
          <p className="mt-0.5 sm:mt-1 text-muted-foreground">Gold & Silver Merchants</p>
        </div>
      </div>

      {/* Live Gold/Silver Metal Rates Bar */}
      <MetalRateTicker currentRates={rates} />

      {/* Balances overdue or due within the next few days — remind before the deadline. */}
      <DueRemindersCard />

      {/* Vyapar Key Financial Overview: Total Receivable & Total Payable (Pages 5 & 6) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Total Receivable Card */}
        <Card className="border-border/80 shadow-sm transition hover:border-primary/40">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Receivable
              </p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                {formatPaise(totalReceivables)}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {totalReceivables === 0
                  ? "You don't have any receivables as of now."
                  : "Outstanding payments due from customers."}
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <ArrowDownRight className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Total Payable Card */}
        <Card className="border-border/80 shadow-sm transition hover:border-primary/40">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Payable
              </p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                {formatPaise(totalPayables)}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {totalPayables === 0
                  ? "You don't have any payables as of now."
                  : "Pending supplier purchase balances."}
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
              <ArrowUpRight className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vyapar Sales Trend Graph with Date Filter (Pages 5, 6, 7 & User Reference) */}
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-3">
          <div>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[#b8860b] dark:text-[#e0b84c]">
              Sales · {summary?.timeframeLabel ?? (timeframe === "week" ? "last 7 days" : timeframe === "month" ? "this month" : timeframe === "quarter" ? "this quarter" : timeframe === "half_year" ? "this half-year" : "this year")}
            </CardTitle>
            <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">
              {formatPaise(summary?.timeframeSalesPaise ?? totalSales)}
            </p>
          </div>
          {/* Time Filter Dropdown: Week, Month, Quarter, Half Year, Year */}
          <div className="w-48">
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as any)}>
              <SelectTrigger className="h-9 text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Week (Last 7 Days)</SelectItem>
                <SelectItem value="month">Month (This Month)</SelectItem>
                <SelectItem value="quarter">Quarter (This Quarter)</SelectItem>
                <SelectItem value="half_year">Half Quarter / Half Year</SelectItem>
                <SelectItem value="year">Year (This Year)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="h-56 w-full">
            {summary && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={
                    summary.trend.length > 0
                      ? summary.trend.map((t) => {
                          const d = new Date(t.date);
                          const label =
                            timeframe === "week"
                              ? d.toLocaleDateString("en-IN", { weekday: "short" })
                              : d.toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                });
                          return {
                            date: label,
                            sales: t.salesPaise / 100,
                          };
                        })
                      : [
                          { date: "Mon", sales: 0 },
                          { date: "Tue", sales: 0 },
                          { date: "Wed", sales: 0 },
                          { date: "Thu", sales: totalSales / 100 },
                          { date: "Fri", sales: 0 },
                          { date: "Sat", sales: 0 },
                          { date: "Sun", sales: 0 },
                        ]
                  }
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="saleColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#b8860b" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#b8860b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="rounded border border-[#b8860b]/40 bg-card px-3 py-2 text-xs shadow-md">
                            <p className="font-semibold text-foreground">{label}</p>
                            <p className="font-bold text-[#b8860b] mt-0.5">
                              Sales : ₹{Number(payload[0].value).toLocaleString("en-IN")}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="#b8860b"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#saleColor)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Vyapar Most Used Reports Section (Page 5 & 6) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-foreground">Most Used Reports</h2>
          <Link
            href="/reports/sales"
            className="text-xs font-semibold text-primary hover:underline"
          >
            View All
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            href="/reports/sales"
            className="flex items-center justify-between rounded-xl border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">Sale Report</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>

          <Link
            href="/sales/invoices"
            className="flex items-center justify-between rounded-xl border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Receipt className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">All Transactions</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>

          <Link
            href="/reports/sales"
            className="flex items-center justify-between rounded-xl border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Calendar className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">Daybook Report</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>

          <Link
            href="/customers/ledgers"
            className="flex items-center justify-between rounded-xl border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Layers className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">Party Statement</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </div>

      {/* Jewellery ERP Domain Modules: Real-time Weight & Daily Counter Breakdown */}
      <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card className="gap-4 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wide">Daily sales overview</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {[
              ["Total sales today", summary ? formatPaise(summary.todaysSalesPaise) : "—"],
              ["Cash receipts", payment("cash")],
              ["UPI / Scan", payment("upi")],
              [
                "Old metal exchange",
                summary ? formatPaise(summary.todaysOldGoldExchangePaise) : "—",
              ],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={`rounded-lg border p-4 ${i === 0 ? "border-primary/30 bg-accent text-accent-foreground" : "bg-muted/30"}`}
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="gap-4 shadow-sm">
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
                      <td className="capitalize text-muted-foreground">{row.metal}</td>
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

      {/* Serialized Box Inventory System */}
      {!isLocked && (
        <Card className="gap-4 shadow-sm">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm uppercase tracking-wide">Box management system</CardTitle>
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
                    className="group flex items-center gap-2 rounded-lg border bg-muted/25 p-3 transition hover:border-primary/50 hover:bg-accent"
                  >
                    <Boxes className="h-7 w-7 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Box {box.boxNumber}</p>
                      <p className="text-xs text-muted-foreground">{box.itemCount ?? 0} pieces</p>
                      {box.label && (
                        <p className="truncate text-xs text-muted-foreground">{box.label}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Action Shortcuts (F2, F3, F4) */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Quick action center
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {!isViewOnly && <Button asChild className="h-12 bg-emerald-700 text-white hover:bg-emerald-800">
            <Link href="/sales/new">
              <Receipt className="h-4 w-4" />
              F2 · New retail invoice
            </Link>
          </Button>}
          {!isViewOnly && <Button asChild className="h-12">
            <Link href="/purchases/new">
              <ShoppingCart className="h-4 w-4" />
              F3 · Supplier purchase
            </Link>
          </Button>}
          {latest ? (
            <Button asChild className="h-12 bg-slate-700 text-white hover:bg-slate-800">
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

      {/* Bottom Shortcuts: Girvi and Backup */}
      <div className="flex flex-wrap gap-3">
        {!isLocked && (
          <Button asChild variant="outline">
            <Link href="/girvi">
              <Landmark className="h-4 w-4" />
              Girvi metal loans
            </Link>
          </Button>
        )}
        {!isViewOnly && <Button asChild variant="outline">
          <Link href="/backup">
            <DatabaseBackup className="h-4 w-4" />
            Backup & restore
          </Link>
        </Button>}
      </div>
    </div>
  );
}
