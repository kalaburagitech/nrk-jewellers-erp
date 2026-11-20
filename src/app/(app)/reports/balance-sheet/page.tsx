"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ReportHeader } from "@/components/report-kit";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadCsv } from "@/lib/csv-export";
import { formatPaise } from "@/lib/money";

type Line = { group: string; label: string; paise: number; children?: { label: string; paise: number }[] };

function Side({ title, lines, total, totalLabel }: { title: string; lines: Line[]; total: number; totalLabel: string }) {
  const groups = [...new Set(lines.map((l) => l.group))];
  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-xs">
      <div className="flex justify-between bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>Account</span><span>Amount</span></div>
      <p className="px-4 pt-3 text-lg font-semibold">{title}</p>
      {groups.map((g) => (
        <div key={g} className="px-4 py-2">
          <p className="py-1 font-medium">{g}</p>
          {lines.filter((l) => l.group === g).map((l) => (
            <div key={l.label}>
              <div className="flex justify-between border-b border-dashed py-1.5 pl-4 text-sm"><span>{l.label}</span><span className="tabular-nums">{formatPaise(l.paise)}</span></div>
              {l.children?.map((c) => (
                <div key={c.label} className="flex justify-between py-1 pl-8 text-xs text-muted-foreground"><span>{c.label}</span><span className="tabular-nums">{formatPaise(c.paise)}</span></div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-auto flex justify-between bg-sky-50 px-4 py-3 font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"><span>{totalLabel}</span><span className="tabular-nums">{formatPaise(total)}</span></div>
    </div>
  );
}

function BalanceSheet() {
  const r = useQuery(api.balanceSheet.get);
  const [view, setView] = useState("balance");
  const rows = r ? [...r.assets.map((l) => ({ ...l, dr: l.paise, cr: 0 })), ...[...r.liabilities, ...r.equity].map((l) => ({ ...l, dr: 0, cr: l.paise }))] : [];

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title={view === "balance" ? "Balance Sheet" : "Trial Balance"}
        description={`As on ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
        controls={
          <Tabs value={view} onValueChange={setView}>
            <TabsList><TabsTrigger value="balance">Balance Sheet</TabsTrigger><TabsTrigger value="trial">Trial Balance</TabsTrigger></TabsList>
          </Tabs>
        }
        onExcel={r ? () => downloadCsv(view === "balance" ? "balance-sheet" : "trial-balance", ["Account", "Group", "Debit", "Credit"], rows.map((l) => [l.label, l.group, l.dr / 100, l.cr / 100])) : undefined}
      />
      {!r ? (
        <p className="py-16 text-center text-muted-foreground">Loading…</p>
      ) : view === "balance" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Side title="Equities & Liabilities" lines={[...r.equity, ...r.liabilities]} total={r.totalLiabilitiesAndEquity} totalLabel="Total Equities & Liabilities" />
          <Side title="Assets" lines={r.assets} total={r.totalAssets} totalLabel="Total Assets" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide"><tr><th className="p-3 text-left">Account</th><th className="p-3 text-left">Group</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.label} className="border-t"><td className="p-3">{l.label}</td><td className="p-3 text-muted-foreground">{l.group}</td><td className="p-3 text-right tabular-nums">{l.dr ? formatPaise(l.dr) : ""}</td><td className="p-3 text-right tabular-nums">{l.cr ? formatPaise(l.cr) : ""}</td></tr>
              ))}
              <tr className="border-t bg-muted/40 font-semibold"><td className="p-3" colSpan={2}>Total</td><td className="p-3 text-right tabular-nums">{formatPaise(rows.reduce((a, l) => a + l.dr, 0))}</td><td className="p-3 text-right tabular-nums">{formatPaise(rows.reduce((a, l) => a + l.cr, 0))}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Stock is valued at purchase cost. Record capital, loans and fixed assets under Cash &amp; Bank → Capital, Loans &amp; Assets so they appear here; the balancing line holds retained profit and any opening balances entered without a matching entry.
        {r && r.uncostedPieces > 0 && ` ${r.uncostedPieces} stock piece(s) have no purchase cost (added directly to a box) and are valued at ₹0.`}
      </p>
    </div>
  );
}

export default function BalanceSheetPage() {
  return (
    <>
      <BalanceSheet />
    </>
  );
}
