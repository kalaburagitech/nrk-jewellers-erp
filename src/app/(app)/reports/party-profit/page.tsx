"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { CostWarning, PeriodPicker, ReportHeader, ReportTable, SummaryTiles, usePeriod } from "@/components/report-kit";

function PartyProfit() {
  const period = usePeriod();
  const report = useQuery(api.partyReports.profitReports, period.range);
  const rows = report?.parties;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Party wise Profit & Loss" description="How much you earned from each customer in the period." controls={<PeriodPicker state={period} />} />
      {rows && (
        <SummaryTiles
          tiles={[
            { label: "Total Sale Amount", paise: rows.reduce((a, r) => a + r.salePaise, 0), tone: "blue" },
            { label: "Total Profit (+) / Loss (-)", paise: rows.reduce((a, r) => a + r.profitPaise, 0), tone: "green" },
          ]}
        />
      )}
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        csvName="party-wise-profit-loss"
        columns={[
          { key: "name", label: "Party Name", value: (r) => r.name },
          { key: "phone", label: "Phone No.", value: (r) => r.phone },
          { key: "sale", label: "Total Sale Amount", value: (r) => r.salePaise, money: true, align: "right", total: true },
          { key: "profit", label: "Profit (+) / Loss (-)", value: (r) => r.profitPaise, money: true, align: "right", total: true, signed: true },
        ]}
      />
      {report && report.linesWithoutCost > 0 && <CostWarning count={report.linesWithoutCost} />}
    </div>
  );
}

export default function PartyProfitPage() {
  return (
    <>
      <PartyProfit />
    </>
  );
}
