"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PrivacyLockGate } from "@/components/privacy-lock-gate";
import { CostWarning, PeriodPicker, ReportHeader, usePeriod } from "@/components/report-kit";
import { downloadCsv } from "@/lib/csv-export";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

type Line = { label: string; paise: number; sign?: "+" | "-"; indent?: boolean; strong?: boolean; heading?: boolean; muted?: boolean };

function ProfitLoss() {
  const period = usePeriod();
  const report = useQuery(api.partyReports.profitReports, period.range);
  const p = report?.pnl;

  const lines: Line[] = p
    ? [
        { label: "Sale (+)", paise: p.salePaise, sign: "+" },
        { label: "Sale Return / Credit Note (-)", paise: p.saleReturnPaise, sign: "-" },
        { label: "Cost of Goods Sold (-)", paise: p.costOfGoodsSoldPaise, sign: "-" },
        { label: "Gross Profit", paise: p.grossProfitPaise, strong: true },
        { label: "Indirect Expenses (-)", paise: p.expenseTotalPaise, heading: true },
        ...p.expenses.map((e) => ({ label: e.category, paise: e.amountPaise, sign: "-" as const, indent: true })),
        { label: "Net Profit", paise: p.netProfitPaise, strong: true },
        { label: "For reference (not part of profit)", paise: 0, heading: true, muted: true },
        { label: "Purchases in period (goes to stock)", paise: p.purchasePaise, indent: true, muted: true },
        { label: "Purchase Returns", paise: p.purchaseReturnPaise, indent: true, muted: true },
        { label: "GST Payable (on sales)", paise: p.gstPayablePaise, indent: true, muted: true },
        { label: "GST Receivable (on purchases)", paise: p.gstReceivablePaise, indent: true, muted: true },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Profit And Loss Report"
        description="Sales minus the purchase cost of what was sold, minus shop expenses. GST is excluded."
        controls={<PeriodPicker state={period} />}
        onExcel={p ? () => downloadCsv("profit-and-loss", ["Particulars", "Amount"], lines.filter((l) => !l.heading || l.paise).map((l) => [l.label, l.paise / 100])) : undefined}
      />
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex justify-between bg-muted/60 px-4 py-2.5 text-sm font-semibold">
          <span>Particulars</span>
          <span>Amount</span>
        </div>
        {!p ? (
          <p className="py-16 text-center text-muted-foreground">Loading…</p>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                "flex justify-between border-t px-4 py-2.5 text-sm",
                l.indent && "pl-8",
                l.strong && "bg-muted/40 font-semibold",
                l.heading && "font-medium",
                l.muted && "text-muted-foreground",
                i % 2 === 1 && !l.strong && "bg-muted/15",
              )}
            >
              <span>{l.label}</span>
              {!(l.heading && l.muted) && (
                <span
                  className={cn(
                    "tabular-nums",
                    !l.muted && l.sign === "+" && "text-emerald-600",
                    !l.muted && l.sign === "-" && "text-red-600",
                    l.strong && (l.paise >= 0 ? "text-emerald-600" : "text-red-600"),
                  )}
                >
                  {formatPaise(l.paise)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      {report && report.linesWithoutCost > 0 && <CostWarning count={report.linesWithoutCost} />}
    </div>
  );
}

export default function ProfitLossPage() {
  return (
    <PrivacyLockGate>
      <ProfitLoss />
    </PrivacyLockGate>
  );
}
