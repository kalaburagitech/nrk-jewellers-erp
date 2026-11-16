"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, FileSpreadsheet, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv-export";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Shared building blocks for the Vyapar-style report pages. */

export type DateRange = { startDate: number; endDate: number };
export type Period = "today" | "this-week" | "this-month" | "last-month" | "this-quarter" | "this-fy" | "this-year" | "custom";

const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "last-month": "Last Month",
  "this-quarter": "This Quarter",
  "this-fy": "This Financial Year",
  "this-year": "This Year",
  custom: "Custom",
};

const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const endOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();

export function periodRange(period: Exclude<Period, "custom">, now = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "today":
      return { startDate: startOf(now), endDate: endOf(now) };
    case "this-week": {
      const monday = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7));
      return { startDate: startOf(monday), endDate: endOf(now) };
    }
    case "this-month":
      return { startDate: new Date(y, m, 1).getTime(), endDate: endOf(new Date(y, m + 1, 0)) };
    case "last-month":
      return { startDate: new Date(y, m - 1, 1).getTime(), endDate: endOf(new Date(y, m, 0)) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { startDate: new Date(y, q, 1).getTime(), endDate: endOf(new Date(y, q + 3, 0)) };
    }
    case "this-fy": {
      const fy = m >= 3 ? y : y - 1; // Indian financial year: 1 Apr – 31 Mar
      return { startDate: new Date(fy, 3, 1).getTime(), endDate: endOf(new Date(fy + 1, 2, 31)) };
    }
    case "this-year":
      return { startDate: new Date(y, 0, 1).getTime(), endDate: endOf(new Date(y, 11, 31)) };
  }
}

const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromInput = (s: string, end: boolean) => {
  const [y, m, d] = s.split("-").map(Number);
  return end ? endOf(new Date(y, m - 1, d)) : startOf(new Date(y, m - 1, d));
};

export function usePeriod(initial: Exclude<Period, "custom"> = "this-month") {
  const [period, setPeriod] = useState<Period>(initial);
  const [range, setRange] = useState<DateRange>(() => periodRange(initial));
  return {
    period,
    range,
    setPeriod: (p: Period) => {
      setPeriod(p);
      if (p !== "custom") setRange(periodRange(p));
    },
    setRange: (r: DateRange) => {
      setPeriod("custom");
      setRange(r);
    },
  };
}

export function PeriodPicker({ state }: { state: ReturnType<typeof usePeriod> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={state.period} onValueChange={(v) => state.setPeriod(v as Period)}>
        <SelectTrigger className="h-9 w-44 font-semibold" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <SelectItem key={p} value={p}>{PERIOD_LABEL[p]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center overflow-hidden rounded-md border bg-background text-sm">
        <span className="bg-muted px-2.5 py-2 text-xs font-semibold text-muted-foreground">Between</span>
        <input
          type="date"
          aria-label="From date"
          className="bg-transparent px-2 py-1.5 outline-none"
          value={toInput(state.range.startDate)}
          onChange={(e) => e.target.value && state.setRange({ ...state.range, startDate: fromInput(e.target.value, false) })}
        />
        <span className="px-1 text-xs text-muted-foreground">To</span>
        <input
          type="date"
          aria-label="To date"
          className="bg-transparent px-2 py-1.5 outline-none"
          value={toInput(state.range.endDate)}
          onChange={(e) => e.target.value && state.setRange({ ...state.range, endDate: fromInput(e.target.value, true) })}
        />
      </div>
    </div>
  );
}

export function ReportHeader({
  title,
  description,
  controls,
  onExcel,
}: {
  title: string;
  description?: string;
  controls?: ReactNode;
  onExcel?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex gap-2 print:hidden">
          {onExcel && (
            <Button variant="outline" size="sm" onClick={onExcel}>
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Excel Report
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>
      {controls && <div className="flex flex-wrap items-center gap-2 print:hidden">{controls}</div>}
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: "right";
  money?: boolean;
  total?: boolean;
  /** Colour profit/loss green/red. */
  signed?: boolean;
};

/** Search + click-to-sort table with an optional totals footer; also builds its own CSV export. */
export function ReportTable<T>({
  rows,
  columns,
  rowKey,
  empty = "No transactions to show",
  onRowClick,
  csvName,
  footerNote,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty?: string;
  onRowClick?: (row: T) => void;
  csvName?: string;
  footerNote?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const visible = useMemo(() => {
    if (!rows) return undefined;
    const q = search.trim().toLowerCase();
    let out = q
      ? rows.filter((r) => columns.some((c) => String(c.value(r)).toLowerCase().includes(q)))
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const x = col.value(a);
          const y = col.value(b);
          return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
        });
      }
    }
    return out;
  }, [rows, search, sort, columns]);

  const totals = columns.map((c) => (c.total && visible ? visible.reduce((a, r) => a + Number(c.value(r) || 0), 0) : null));
  const fmt = (c: Column<T>, n: number) => (c.money ? formatPaise(n) : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }));

  const exportCsv = () =>
    visible &&
    downloadCsv(
      csvName ?? "report",
      columns.map((c) => c.label),
      visible.map((r) => columns.map((c) => (c.money ? Number(c.value(r)) / 100 : c.value(r)))),
    );

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 print:hidden">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9" />
        </div>
        {csvName && (
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!visible?.length}>
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Excel
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10">#</TableHead>
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn("cursor-pointer select-none whitespace-nowrap text-xs font-semibold uppercase tracking-wide", c.align === "right" && "text-right")}
                  onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible === undefined ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-12 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-16 text-center text-muted-foreground">{empty}</TableCell>
              </TableRow>
            ) : (
              visible.map((r, i) => (
                <TableRow key={rowKey(r)} className={cn(onRowClick && "cursor-pointer")} onClick={() => onRowClick?.(r)}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  {columns.map((c) => {
                    const raw = c.value(r);
                    const n = Number(raw);
                    return (
                      <TableCell
                        key={c.key}
                        className={cn(
                          "whitespace-nowrap",
                          c.align === "right" && "text-right tabular-nums",
                          c.signed && (n > 0 ? "text-emerald-600" : n < 0 ? "text-red-600" : ""),
                        )}
                      >
                        {c.render ? c.render(r) : c.money ? formatPaise(n) : raw === "" ? "—" : raw}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
          {visible && visible.length > 0 && totals.some((t) => t !== null) && (
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell />
                {columns.map((c, i) => (
                  <TableCell key={c.key} className={cn("whitespace-nowrap", c.align === "right" && "text-right tabular-nums", c.signed && totals[i] !== null && (totals[i]! >= 0 ? "text-emerald-600" : "text-red-600"))}>
                    {i === 0 ? "Total" : totals[i] !== null ? fmt(c, totals[i]!) : ""}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      {footerNote && <div className="border-t p-3 text-xs text-muted-foreground">{footerNote}</div>}
    </div>
  );
}

/** Coloured summary tile row (e.g. Total Sale / Total Profit). */
export function SummaryTiles({ tiles }: { tiles: { label: string; paise: number; tone?: "green" | "red" | "blue" | "amber" }[] }) {
  const tone = {
    green: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    red: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
    blue: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    amber: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  };
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn("rounded-xl border p-4", t.tone ? tone[t.tone] : "bg-card")}>
          <p className="text-xs font-medium opacity-80">{t.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{formatPaise(t.paise)}</p>
        </div>
      ))}
    </div>
  );
}

export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
export const grams = (mg: number) => Number((mg / 1000).toFixed(3));

/** Shown on profit reports when some sold lines had no purchase cost to match. */
export function CostWarning({ count }: { count: number }) {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {count} sold item line{count === 1 ? " has" : "s have"} no purchase bill behind {count === 1 ? "it" : "them"} (e.g. stock added directly to a box), so
      their cost is taken as ₹0 and profit is shown higher than actual. Record stock through Purchase to get exact profit.
    </p>
  );
}
