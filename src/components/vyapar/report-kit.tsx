"use client";

/**
 * Building blocks for Vyapar-style report screens: the "This Month ▾ | Between
 * dd/mm/yyyy To dd/mm/yyyy" period bar, Excel Report / Print actions, a table
 * with filter-icon column headers, a search box and a coloured totals footer.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Filter, Printer, Search } from "lucide-react";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

export type Period = { startDate: number; endDate: number };
export type PeriodPreset = "today" | "this_week" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";

const PRESET_LABEL: Record<PeriodPreset, string> = {
  today: "Today",
  this_week: "This Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  this_year: "This Financial Year",
  custom: "Custom",
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

export function presetPeriod(preset: PeriodPreset, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "today":
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
    case "this_week": {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return { startDate: startOfDay(start), endDate: endOfDay(now) };
    }
    case "last_month":
      return { startDate: new Date(y, m - 1, 1).getTime(), endDate: endOfDay(new Date(y, m, 0)) };
    case "this_quarter": {
      const q = Math.floor(m / 3) * 3;
      return { startDate: new Date(y, q, 1).getTime(), endDate: endOfDay(new Date(y, q + 3, 0)) };
    }
    case "this_year": {
      const fyStart = m >= 3 ? y : y - 1; // Indian financial year: 1 April – 31 March
      return { startDate: new Date(fyStart, 3, 1).getTime(), endDate: endOfDay(new Date(fyStart + 1, 2, 31)) };
    }
    case "this_month":
    default:
      return { startDate: new Date(y, m, 1).getTime(), endDate: endOfDay(new Date(y, m + 1, 0)) };
  }
}

function toInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromInput(value: string, end: boolean) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

export function usePeriod(initial: PeriodPreset = "this_month") {
  const [preset, setPreset] = useState<PeriodPreset>(initial);
  const [period, setPeriod] = useState<Period>(() => presetPeriod(initial));
  return {
    preset,
    period,
    choose(next: PeriodPreset) {
      setPreset(next);
      if (next !== "custom") setPeriod(presetPeriod(next));
    },
    setCustom(next: Period) {
      setPreset("custom");
      setPeriod(next);
    },
  };
}

export type PeriodState = ReturnType<typeof usePeriod>;

/** "This Month ▾  [Between] 01/11/2026 To 30/11/2026" */
export function PeriodBar({ state }: { state: PeriodState }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative inline-flex items-center">
        <span className="sr-only">Period</span>
        <select
          value={state.preset}
          onChange={(e) => state.choose(e.target.value as PeriodPreset)}
          className="appearance-none bg-transparent pr-7 text-xl font-semibold tracking-tight text-foreground outline-none"
        >
          {(Object.keys(PRESET_LABEL) as PeriodPreset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_LABEL[p]}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-0 h-5 w-5" />
      </label>
      <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-border text-sm">
        <span className="flex items-center bg-[#9aa1ad] px-2.5 font-semibold text-white">Between</span>
        <input
          type="date"
          aria-label="From date"
          value={toInput(state.period.startDate)}
          onChange={(e) => {
            const v = fromInput(e.target.value, false);
            if (v !== null) state.setCustom({ startDate: v, endDate: Math.max(v, state.period.endDate) });
          }}
          className="w-36 bg-card px-2 font-medium outline-none"
        />
        <span className="flex items-center px-1 text-muted-foreground">To</span>
        <input
          type="date"
          aria-label="To date"
          value={toInput(state.period.endDate)}
          onChange={(e) => {
            const v = fromInput(e.target.value, true);
            if (v !== null) state.setCustom({ startDate: Math.min(state.period.startDate, v), endDate: v });
          }}
          className="w-36 bg-card px-2 font-medium outline-none"
        />
      </div>
    </div>
  );
}

export function SelectChip({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex", className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-40 appearance-none rounded-md border border-border bg-card pl-3 pr-8 text-sm font-medium outline-none focus:border-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" />
    </label>
  );
}

/** The two icon buttons Vyapar shows top-right of every report. */
export function ReportActions({ filename, headers, rows }: { filename: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="flex items-start gap-4 print:hidden">
      <button
        type="button"
        disabled={rows.length === 0}
        onClick={() => downloadCsv(filename, headers, rows)}
        className="flex flex-col items-center gap-1 text-[11px] font-medium text-foreground/80 hover:text-primary disabled:opacity-40"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded bg-[#1d6f42] text-[10px] font-bold text-white">X</span>
        Excel Report
      </button>
      <button type="button" onClick={() => window.print()} className="flex flex-col items-center gap-1 text-[11px] font-medium text-foreground/80 hover:text-primary">
        <Printer className="h-7 w-7" />
        Print
      </button>
    </div>
  );
}

export function ReportHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-md bg-card px-4 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
      {actions}
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Plain value used for search and Excel export. */
  value?: (row: T) => string | number;
  className?: string;
};

export function ReportTable<T>({
  title,
  columns,
  rows,
  getKey,
  empty = "No transactions to show",
  footer,
  numbered = false,
  searchable = true,
  onRowClick,
}: {
  title?: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  getKey: (row: T, index: number) => string;
  empty?: string;
  footer?: ReactNode;
  numbered?: boolean;
  searchable?: boolean;
  onRowClick?: (row: T) => void;
}) {
  const [term, setTerm] = useState("");
  const filtered = useMemo(() => {
    if (!rows) return rows;
    const t = term.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((row) =>
      columns.some((c) => String(c.value ? c.value(row) : "").toLowerCase().includes(t)),
    );
  }, [rows, term, columns]);

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-md bg-card">
      {(title || searchable) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-3">
          {title ? <h2 className="text-[15px] font-semibold uppercase tracking-tight">{title}</h2> : <span />}
          {searchable && (
            <label className="relative block w-56 print:hidden">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Search this report"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="h-8 w-full rounded border border-border bg-card pl-8 pr-2 text-sm outline-none focus:border-primary"
              />
            </label>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#f5f6f9] dark:bg-muted">
            <tr>
              {numbered && <th className="w-10 border-b border-border px-3 py-2.5 text-left text-xs font-semibold text-[#4b5263] dark:text-muted-foreground">#</th>}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap border-b border-l border-border px-3 py-2.5 text-xs font-semibold uppercase text-[#4b5263] first:border-l-0 dark:text-muted-foreground",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  <span className="inline-flex w-full items-center justify-between gap-2">
                    <span className={cn(c.align === "right" && "ml-auto")}>{c.header}</span>
                    <Filter className="h-3.5 w-3.5 shrink-0 opacity-60 print:hidden" aria-hidden />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered === undefined ? (
              <tr>
                <td colSpan={columns.length + (numbered ? 1 : 0)} className="py-16 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (numbered ? 1 : 0)} className="py-24 text-center text-foreground/80">
                  {empty}
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={getKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn("border-b border-border/70 hover:bg-[#e3effb] dark:hover:bg-accent", onRowClick && "cursor-pointer")}
                >
                  {numbered && <td className="px-3 py-2.5">{i + 1}</td>}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap px-3 py-2.5 tabular-nums",
                        c.align === "right" ? "text-right" : "text-left",
                        c.className,
                      )}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-4 border-[#d5d9e0] px-3 py-2 text-[15px] dark:border-border">
          {footer}
        </div>
      )}
    </div>
  );
}

export function exportRows<T>(columns: Column<T>[], rows: T[] | undefined) {
  return {
    headers: columns.map((c) => c.header),
    rows: (rows ?? []).map((r) => columns.map((c) => (c.value ? c.value(r) : ""))),
  };
}

export function rupees(paise: number) {
  return `₹ ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function grams(mg: number) {
  return `${(mg / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g`;
}
export function dmy(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB");
}

export function Money({ paise, tone }: { paise: number; tone?: "in" | "out" | "auto" }) {
  const color =
    tone === "in" ? "text-success" : tone === "out" ? "text-destructive" : tone === "auto" ? (paise < 0 ? "text-destructive" : "text-success") : "";
  return <span className={color}>{rupees(paise)}</span>;
}
