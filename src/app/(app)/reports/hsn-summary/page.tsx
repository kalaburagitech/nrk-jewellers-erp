"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, usePeriod } from "@/components/report-kit";

export default function HsnSummaryPage() {
  const period = usePeriod();
  const rows = useQuery(api.gstReports.hsnSummary, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="Sale Summary By HSN" description="GST sales grouped by HSN code, unit and tax rate. Set the HSN on each item to fill this in." controls={<PeriodPicker state={period} />} />
      <ReportTable
        rows={rows}
        rowKey={(x) => x.id}
        csvName="sale-summary-by-hsn"
        columns={[
          { key: "hsn", label: "HSN", value: (x) => x.hsn },
          { key: "desc", label: "Description", value: (x) => x.description },
          { key: "uqc", label: "UQC", value: (x) => x.uqc },
          { key: "qty", label: "Total Quantity", value: (x) => Number(x.qty.toFixed(3)), align: "right" },
          { key: "rate", label: "Rate %", value: (x) => x.rateBp / 100, align: "right" },
          { key: "value", label: "Total Value", value: (x) => x.totalValuePaise, money: true, align: "right", total: true },
          { key: "taxable", label: "Taxable Value", value: (x) => x.taxablePaise, money: true, align: "right", total: true },
          { key: "igst", label: "IGST", value: (x) => x.igstPaise, money: true, align: "right", total: true },
          { key: "cgst", label: "CGST", value: (x) => x.cgstPaise, money: true, align: "right", total: true },
          { key: "sgst", label: "SGST", value: (x) => x.sgstPaise, money: true, align: "right", total: true },
        ]}
      />
    </div>
  );
}
