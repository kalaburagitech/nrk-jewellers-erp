"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, usePeriod } from "@/components/report-kit";
import { downloadCsv } from "@/lib/csv-export";
import { formatPaise } from "@/lib/money";

type Row = { label: string; taxablePaise?: number; igstPaise: number; cgstPaise: number; sgstPaise: number; strong?: boolean };

export default function Gstr3bPage() {
  const period = usePeriod("last-month");
  const r = useQuery(api.gstReports.gstr3b, period.range);
  const rows: Row[] = r
    ? [
        { label: "3.1 (a) Outward taxable supplies (other than zero rated, nil rated and exempted)", ...r.outward },
        { label: "4 (A)(5) Eligible ITC — All other ITC (from purchases)", ...r.itc },
        { label: "Tax payable after ITC (before cross-utilisation)", ...r.payable, strong: true },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="GSTR-3B"
        description="Monthly summary: GST on your sales, minus GST you paid on purchases (input tax credit)."
        controls={<PeriodPicker state={period} />}
        onExcel={r ? () => downloadCsv("gstr-3b", ["Nature of Supplies", "Taxable Value", "IGST", "CGST", "SGST"], rows.map((x) => [x.label, (x.taxablePaise ?? 0) / 100, x.igstPaise / 100, x.cgstPaise / 100, x.sgstPaise / 100])) : undefined}
      />
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="p-3 text-left">Nature of Supplies</th>
              <th className="p-3 text-right">Taxable Value</th>
              <th className="p-3 text-right">IGST</th>
              <th className="p-3 text-right">CGST</th>
              <th className="p-3 text-right">SGST</th>
            </tr>
          </thead>
          <tbody>
            {!r ? (
              <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">Loading…</td></tr>
            ) : (
              rows.map((x) => (
                <tr key={x.label} className={`border-t ${x.strong ? "bg-muted/40 font-semibold" : ""}`}>
                  <td className="p-3">{x.label}</td>
                  <td className="p-3 text-right tabular-nums">{x.taxablePaise === undefined ? "" : formatPaise(x.taxablePaise)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPaise(x.igstPaise)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPaise(x.cgstPaise)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPaise(x.sgstPaise)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Purchases store one GST amount, so ITC is split by state: supplier in another state → IGST, same state → half CGST + half SGST.
        {r && r.unknownState > 0 && ` ${r.unknownState} purchase bill(s) have no supplier state or company state set and were treated as same-state — set the state on the supplier and in Business Profile.`}
        {" "}Negative payable means credit carried forward. Check with your accountant before filing.
      </p>
    </div>
  );
}
