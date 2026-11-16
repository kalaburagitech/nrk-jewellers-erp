"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, usePeriod } from "@/components/report-kit";

export default function Gstr9Page() {
  const period = usePeriod("this-fy");
  const r = useQuery(api.gstReports.gstr9, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="GSTR-9 (Annual Return)" description="Year summary of outward supplies, input tax credit and tax payable, with HSN summary. Pick the financial year." controls={<PeriodPicker state={period} />} />
      <ReportTable
        rows={r?.rows}
        rowKey={(x) => x.id}
        csvName="gstr-9-summary"
        columns={[
          { key: "label", label: "Particulars", value: (x) => x.label },
          { key: "taxable", label: "Taxable Value", value: (x) => x.taxablePaise, money: true, align: "right" },
          { key: "igst", label: "IGST", value: (x) => x.igstPaise, money: true, align: "right" },
          { key: "cgst", label: "CGST", value: (x) => x.cgstPaise, money: true, align: "right" },
          { key: "sgst", label: "SGST", value: (x) => x.sgstPaise, money: true, align: "right" },
        ]}
      />
      <h2 className="text-base font-semibold">17. HSN-wise summary of outward supplies</h2>
      <ReportTable
        rows={r?.hsn}
        rowKey={(x) => x.id}
        csvName="gstr-9-hsn"
        columns={[
          { key: "hsn", label: "HSN", value: (x) => x.hsn },
          { key: "uqc", label: "UQC", value: (x) => x.uqc },
          { key: "qty", label: "Total Quantity", value: (x) => Number(x.qty.toFixed(3)), align: "right" },
          { key: "rate", label: "Rate %", value: (x) => x.rateBp / 100, align: "right" },
          { key: "taxable", label: "Taxable Value", value: (x) => x.taxablePaise, money: true, align: "right", total: true },
          { key: "igst", label: "IGST", value: (x) => x.igstPaise, money: true, align: "right", total: true },
          { key: "cgst", label: "CGST", value: (x) => x.cgstPaise, money: true, align: "right", total: true },
          { key: "sgst", label: "SGST", value: (x) => x.sgstPaise, money: true, align: "right", total: true },
        ]}
      />
      <p className="text-xs text-muted-foreground">A working paper for your accountant — the actual GSTR-9 is filed on the GST portal.</p>
    </div>
  );
}
