"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodPicker, ReportHeader, ReportTable, fmtDate, usePeriod, type Column } from "@/components/report-kit";

type Inv = { id: string; invoiceNumber: string; date: number; gstin: string; name: string; placeOfSupply: string; invoiceValuePaise: number; rates: string; taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number };

const taxCols = <T extends { taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number }>(): Column<T>[] => [
  { key: "taxable", label: "Taxable Value", value: (r) => r.taxablePaise, money: true, align: "right", total: true },
  { key: "igst", label: "IGST", value: (r) => r.igstPaise, money: true, align: "right", total: true },
  { key: "cgst", label: "CGST", value: (r) => r.cgstPaise, money: true, align: "right", total: true },
  { key: "sgst", label: "SGST", value: (r) => r.sgstPaise, money: true, align: "right", total: true },
];

const invoiceCols = (withGstin: boolean): Column<Inv>[] => [
  ...(withGstin ? [{ key: "gstin", label: "GSTIN/UIN", value: (r: Inv) => r.gstin }] : []),
  { key: "name", label: "Party Name", value: (r) => r.name },
  { key: "inv", label: "Invoice No.", value: (r) => r.invoiceNumber },
  { key: "date", label: "Invoice Date", value: (r) => r.date, render: (r) => fmtDate(r.date) },
  { key: "value", label: "Invoice Value", value: (r) => r.invoiceValuePaise, money: true, align: "right", total: true },
  { key: "pos", label: "Place Of Supply", value: (r) => r.placeOfSupply },
  { key: "rate", label: "Rate %", value: (r) => r.rates, align: "right" },
  ...taxCols<Inv>(),
];

export default function Gstr1Page() {
  const period = usePeriod("last-month");
  const r = useQuery(api.gstReports.gstr1, period.range);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader title="GSTR-1" description="Outward supplies in the GST portal's table layout, ready for your accountant to file." controls={<PeriodPicker state={period} />} />
      <Tabs defaultValue="b2b">
        <TabsList className="flex-wrap">
          <TabsTrigger value="b2b">B2B ({r?.b2b.length ?? 0})</TabsTrigger>
          <TabsTrigger value="b2cl">B2C Large ({r?.b2cl.length ?? 0})</TabsTrigger>
          <TabsTrigger value="b2cs">B2C Small</TabsTrigger>
          <TabsTrigger value="cdn">Credit/Debit Notes ({r?.creditNotes.length ?? 0})</TabsTrigger>
          <TabsTrigger value="hsn">HSN Summary</TabsTrigger>
          <TabsTrigger value="docs">Docs Issued</TabsTrigger>
        </TabsList>
        <TabsContent value="b2b"><ReportTable rows={r?.b2b} rowKey={(x) => x.id} csvName="gstr1-b2b" columns={invoiceCols(true)} empty="No invoices to registered (GSTIN) buyers in this period." /></TabsContent>
        <TabsContent value="b2cl">
          <ReportTable rows={r?.b2cl} rowKey={(x) => x.id} csvName="gstr1-b2cl" columns={invoiceCols(false)} empty="No inter-state invoices above ₹1,00,000 to unregistered buyers." footerNote="B2C Large: inter-state invoices above ₹1,00,000 to buyers without a GSTIN." />
        </TabsContent>
        <TabsContent value="b2cs">
          <ReportTable
            rows={r?.b2cs}
            rowKey={(x) => x.id}
            csvName="gstr1-b2cs"
            columns={[
              { key: "pos", label: "Place Of Supply", value: (x) => x.placeOfSupply },
              { key: "rate", label: "Rate %", value: (x) => x.rateBp / 100, align: "right" },
              ...taxCols<NonNullable<typeof r>["b2cs"][number]>(),
            ]}
          />
        </TabsContent>
        <TabsContent value="cdn">
          <ReportTable
            rows={r?.creditNotes}
            rowKey={(x) => x.id}
            csvName="gstr1-cdnr"
            columns={[{ key: "reg", label: "Type", value: (x) => (x.registered ? "CDNR (registered)" : "CDNUR (unregistered)") }, ...(invoiceCols(true) as Column<NonNullable<typeof r>["creditNotes"][number]>[])]}
          />
        </TabsContent>
        <TabsContent value="hsn"><HsnTable rows={r?.hsn} /></TabsContent>
        <TabsContent value="docs">
          <ReportTable
            rows={r?.docs}
            rowKey={(x) => x.label}
            csvName="gstr1-docs"
            columns={[
              { key: "label", label: "Nature of Document", value: (x) => x.label },
              { key: "from", label: "Sr. No. From", value: (x) => x.from },
              { key: "to", label: "Sr. No. To", value: (x) => x.to },
              { key: "total", label: "Total Number", value: (x) => x.total, align: "right" },
              { key: "cancel", label: "Cancelled", value: (x) => x.cancelled, align: "right" },
              { key: "net", label: "Net Issued", value: (x) => x.total - x.cancelled, align: "right" },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Hsn = { id: string; hsn: string; description: string; uqc: string; qty: number; rateBp: number; totalValuePaise: number; taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number };

function HsnTable({ rows }: { rows: Hsn[] | undefined }) {
  return (
    <ReportTable
      rows={rows}
      rowKey={(x) => x.id}
      csvName="hsn-summary"
      columns={[
        { key: "hsn", label: "HSN", value: (x) => x.hsn },
        { key: "desc", label: "Description", value: (x) => x.description },
        { key: "uqc", label: "UQC", value: (x) => x.uqc },
        { key: "qty", label: "Total Quantity", value: (x) => Number(x.qty.toFixed(3)), align: "right" },
        { key: "rate", label: "Rate %", value: (x) => x.rateBp / 100, align: "right" },
        { key: "value", label: "Total Value", value: (x) => x.totalValuePaise, money: true, align: "right", total: true },
        ...taxCols<Hsn>(),
      ]}
    />
  );
}
