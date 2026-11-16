"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, SummaryTiles, usePeriod } from "@/components/report-kit";

export default function SalePurchaseByPartyGroupPage() {
  const period = usePeriod();
  const rows = useQuery(api.partyReports.salePurchaseByPartyGroup, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Sale Purchase By Party Group" description="Net sales and purchases for each party group. Set a party's group on the customer or supplier form." controls={<PeriodPicker state={period} />} />
      {rows && (
        <SummaryTiles
          tiles={[
            { label: "Total Sale Amount", paise: rows.reduce((a, r) => a + r.salePaise, 0), tone: "green" },
            { label: "Total Purchase Amount", paise: rows.reduce((a, r) => a + r.purchasePaise, 0), tone: "red" },
          ]}
        />
      )}
      <ReportTable
        rows={rows}
        rowKey={(r) => r.group}
        csvName="sale-purchase-by-party-group"
        columns={[
          { key: "group", label: "Group Name", value: (r) => r.group },
          { key: "parties", label: "Parties", value: (r) => r.partyCount, align: "right" },
          { key: "sale", label: "Sale Amount", value: (r) => r.salePaise, money: true, align: "right", total: true },
          { key: "purchase", label: "Purchase Amount", value: (r) => r.purchasePaise, money: true, align: "right", total: true },
        ]}
      />
    </div>
  );
}
