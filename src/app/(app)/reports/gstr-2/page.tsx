"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, fmtDate, usePeriod } from "@/components/report-kit";

export default function Gstr2Page() {
  const period = usePeriod("last-month");
  const r = useQuery(api.gstReports.gstr2, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="GSTR-2" description="Inward supplies: purchase bills with GST, for matching against your suppliers' GSTR-1 (GSTR-2B)." controls={<PeriodPicker state={period} />} />
      <ReportTable
        rows={r?.rows}
        rowKey={(x) => x.id}
        csvName="gstr-2"
        columns={[
          { key: "gstin", label: "Supplier GSTIN", value: (x) => x.gstin },
          { key: "name", label: "Supplier", value: (x) => x.name },
          { key: "inv", label: "Bill No.", value: (x) => x.invoiceNumber },
          { key: "date", label: "Date", value: (x) => x.date, render: (x) => fmtDate(x.date) },
          { key: "type", label: "Type", value: (x) => x.type },
          { key: "pos", label: "Place Of Supply", value: (x) => x.placeOfSupply },
          { key: "value", label: "Invoice Value", value: (x) => x.invoiceValuePaise, money: true, align: "right", total: true },
          { key: "taxable", label: "Taxable Value", value: (x) => x.taxablePaise, money: true, align: "right", total: true },
          { key: "igst", label: "IGST", value: (x) => x.igstPaise, money: true, align: "right", total: true },
          { key: "cgst", label: "CGST", value: (x) => x.cgstPaise, money: true, align: "right", total: true },
          { key: "sgst", label: "SGST", value: (x) => x.sgstPaise, money: true, align: "right", total: true },
        ]}
        footerNote={r && r.unknownState > 0 ? `${r.unknownState} bill(s) have no state of supply / supplier state, so tax was treated as CGST + SGST.` : "Tax split: supplier in another state → IGST, same state → CGST + SGST."}
      />
    </div>
  );
}
