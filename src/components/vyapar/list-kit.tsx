"use client";

/** Shared pieces of Vyapar's transaction list screens (Sale Invoices, Purchase Bills). */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { presetPeriod, type Period, type PeriodPreset } from "@/components/vyapar/report-kit";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex h-9 items-center gap-1.5 rounded-full bg-purchase-soft px-3.5 text-[13px] font-medium text-foreground/90 outline-none hover:bg-[#d3e5fb] dark:hover:bg-accent";

export function ChipMenu({
  value,
  options,
  onChange,
  icon,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  className?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(chip, className)}>
        {icon}
        {current?.label}
        <ChevronDown className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)} className="justify-between">
            {o.label}
            {o.value === value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type ListPeriod = { preset: PeriodPreset | "all"; period: Period | null };

export function useListPeriod(initial: PeriodPreset | "all" = "all") {
  const [state, setState] = useState<ListPeriod>({ preset: initial, period: initial === "all" ? null : presetPeriod(initial) });
  return {
    ...state,
    choose(preset: PeriodPreset | "all") {
      setState({ preset, period: preset === "all" ? null : preset === "custom" ? state.period ?? presetPeriod("this_month") : presetPeriod(preset) });
    },
    setCustom(period: Period) {
      setState({ preset: "custom", period });
    },
    contains(ms: number) {
      return !state.period || (ms >= state.period.startDate && ms <= state.period.endDate);
    },
  };
}

const PERIOD_OPTIONS: { value: PeriodPreset | "all"; label: string }[] = [
  { value: "all", label: "Pick a date" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Financial Year" },
  { value: "custom", label: "Custom range" },
];

function toInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PeriodChip({ state }: { state: ReturnType<typeof useListPeriod> }) {
  const label =
    state.preset === "custom" && state.period
      ? `${new Date(state.period.startDate).toLocaleDateString("en-GB")} – ${new Date(state.period.endDate).toLocaleDateString("en-GB")}`
      : PERIOD_OPTIONS.find((o) => o.value === state.preset)?.label ?? "Pick a date";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={chip}>
          <CalendarDays className="h-4 w-4" />
          {label}
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          {PERIOD_OPTIONS.map((o) => (
            <DropdownMenuItem key={o.value} onSelect={() => state.choose(o.value)} className="justify-between">
              {o.value === "all" ? "All dates" : o.label}
              {o.value === state.preset && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {state.preset === "custom" && state.period && (
        <span className="flex items-center gap-1 text-sm">
          <input
            type="date"
            aria-label="From date"
            value={toInput(state.period.startDate)}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split("-").map(Number);
              if (y && m && d) state.setCustom({ startDate: new Date(y, m - 1, d).getTime(), endDate: state.period!.endDate });
            }}
            className="h-9 rounded-md border border-border bg-card px-2"
          />
          To
          <input
            type="date"
            aria-label="To date"
            value={toInput(state.period.endDate)}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split("-").map(Number);
              if (y && m && d) state.setCustom({ startDate: state.period!.startDate, endDate: new Date(y, m - 1, d, 23, 59, 59, 999).getTime() });
            }}
            className="h-9 rounded-md border border-border bg-card px-2"
          />
        </span>
      )}
    </div>
  );
}

/** "All Firms" — lists this login's companies; picking another one switches to it. */
export function FirmChip() {
  const access = useQuery(api.organizations.getMyAccess);
  const selectCompany = useMutation(api.organizations.selectCompany);
  const current = access?.organization?._id;
  const companies = access?.companies ?? [];
  return (
    <ChipMenu
      value={current ?? ""}
      onChange={(id) => {
        if (id && id !== current) void selectCompany({ organizationId: id as never });
      }}
      options={[
        ...(companies.length ? [] : [{ value: current ?? "", label: access?.organization?.name ?? "This firm" }]),
        ...companies.map((c) => ({ value: c.organizationId, label: c.name })),
      ]}
    />
  );
}

export function useUserOptions() {
  const members = useQuery(api.memberships.listMembers, {});
  return [{ value: "", label: "All Users" }, ...(members ?? []).map((m) => ({ value: m.userId as string, label: m.name }))];
}

export function ListHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-card px-4 py-3">
      <div className="text-xl font-semibold tracking-tight">{title}</div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

export function rupeeShort(paise: number) {
  return `₹ ${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
