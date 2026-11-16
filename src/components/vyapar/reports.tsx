"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
  Money,
  PeriodBar,
  ReportActions,
  ReportHeader,
  ReportTable,
  SelectChip,
  dmy,
  exportRows,
  grams,
  rupees,
  usePeriod,
  type Column,
  type PeriodState,
} from "@/components/vyapar/report-kit";
import { cn } from "@/lib/utils";

type Tx = FunctionReturnType<typeof api.vyaparReports.getTransactions>;
type SaleRow = Tx["sales"][number];
type PurchaseRow = Tx["purchases"][number];
type Lines = FunctionReturnType<typeof api.vyaparReports.getItemLines>;
type Line = Lines["saleLines"][number] | Lines["purchaseLines"][number];
type Party = FunctionReturnType<typeof api.vyaparReports.getParties>[number];

const SALE_LABEL: Record<string, string> = {
  sales_invoice: "Sale",
  quotation: "Estimate",
  proforma_invoice: "Proforma Invoice",
  delivery_challan: "Delivery Challan",
  sales_order: "Sale Order",
  sales_return: "Sale Return",
  credit_note: "Credit Note",
};
const PURCHASE_LABEL: Record<string, string> = {
  purchase_invoice: "Purchase",
  purchase_order: "Purchase Order",
  purchase_return: "Purchase Return",
};
const MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "G-Pay/Phone",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank",
  old_gold_exchange: "Old Gold",
};
const GROUP_LABEL: Record<string, string> = { cash: "Cash Customers", regular: "General", credit: "Credit Customers", supplier: "Suppliers" };

/** Signed effect on turnover: returns/credit notes reduce it; estimates and orders don't count. */
function saleSign(type: string) {
  if (type === "sales_invoice") return 1;
  if (type === "sales_return" || type === "credit_note") return -1;
  return 0;
}
function purchaseSign(type: string) {
  if (type === "purchase_invoice") return 1;
  if (type === "purchase_return") return -1;
  return 0;
}

function useTx(period: PeriodState) {
  return useQuery(api.vyaparReports.getTransactions, period.period);
}
function useLines(period: PeriodState) {
  return useQuery(api.vyaparReports.getItemLines, period.period);
}

/** Payment modes used on each sale/purchase document, e.g. "Cash, G-Pay/Phone". */
function modesBySource(tx: Tx | undefined) {
  const map = new Map<string, Set<string>>();
  for (const p of tx?.payments ?? []) {
    if (!p.sourceId) continue;
    const set = map.get(p.sourceId) ?? new Set<string>();
    set.add(MODE_LABEL[p.mode] ?? p.mode);
    map.set(p.sourceId, set);
  }
  return (id: string) => [...(map.get(id) ?? [])].join(", ") || "—";
}

function Total({ label, paise, tone }: { label: string; paise: number; tone?: "in" | "out" }) {
  return (
    <span>
      {label}: <Money paise={paise} tone={tone} />
    </span>
  );
}

function PartyPicker({ parties, value, onChange, kind = "all", placeholder = "All Parties" }: { parties: Party[] | undefined; value: string; onChange: (v: string) => void; kind?: "all" | "customer" | "supplier"; placeholder?: string }) {
  const options = [
    { value: "", label: placeholder },
    ...(parties ?? [])
      .filter((p) => kind === "all" || p.kind === kind)
      .map((p) => ({ value: p.id, label: `${p.name}${kind === "all" ? (p.kind === "supplier" ? " (Supplier)" : "") : ""}` })),
  ];
  return <SelectChip label="Party" value={value} onChange={onChange} options={options} />;
}

/* ------------------------------------------------------------------ */
/* Transaction reports                                                 */
/* ------------------------------------------------------------------ */

function SaleReport() {
  const period = usePeriod();
  const tx = useTx(period);
  const parties = useQuery(api.vyaparReports.getParties, {});
  const [party, setParty] = useState("");
  const [user, setUser] = useState("");
  const modeOf = modesBySource(tx);
  const rows = tx?.sales.filter((s) => s.type === "sales_invoice" && (!party || s.partyId === party) && (!user || s.userId === user));
  const users = [...new Map((tx?.sales ?? []).map((s) => [s.userId, s.userName])).entries()];
  const columns: Column<SaleRow>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
    { key: "no", header: "Invoice No.", render: (r) => r.number, value: (r) => r.number },
    { key: "party", header: "Party Name", render: (r) => r.partyName, value: (r) => r.partyName },
    { key: "type", header: "Transaction Type", render: (r) => (r.isGst ? "Sale (GST)" : "Sale"), value: () => "Sale" },
    { key: "mode", header: "Payment Type", render: (r) => modeOf(r.id), value: (r) => modeOf(r.id) },
    { key: "amount", header: "Amount", align: "right", render: (r) => rupees(r.totalPaise), value: (r) => r.totalPaise / 100 },
    { key: "balance", header: "Balance Due", align: "right", render: (r) => rupees(Math.max(0, r.totalPaise - r.paidPaise)), value: (r) => Math.max(0, r.totalPaise - r.paidPaise) / 100 },
  ];
  const total = sum(rows, (r) => r.totalPaise);
  const received = sum(rows, (r) => r.paidPaise);
  return (
    <>
      <ReportHeader actions={<ReportActions filename="sale-report" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div className="flex flex-wrap gap-2">
          <PartyPicker parties={parties} value={party} onChange={setParty} kind="customer" />
          <SelectChip label="User" value={user} onChange={setUser} options={[{ value: "", label: "All Users" }, ...users.map(([id, name]) => ({ value: id, label: name }))]} />
        </div>
      </ReportHeader>
      <ReportTable
        title="Transactions"
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        footer={
          <>
            <Total label="Total Sale" paise={total} tone="in" />
            <Total label="Received" paise={received} />
            <Total label="Balance" paise={total - received} tone="out" />
          </>
        }
      />
    </>
  );
}

function PurchaseReport() {
  const period = usePeriod();
  const tx = useTx(period);
  const parties = useQuery(api.vyaparReports.getParties, {});
  const [party, setParty] = useState("");
  const modeOf = modesBySource(tx);
  const rows = tx?.purchases.filter((p) => p.type === "purchase_invoice" && (!party || p.partyId === party));
  const columns: Column<PurchaseRow>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
    { key: "no", header: "Invoice No.", render: (r) => r.number, value: (r) => r.number },
    { key: "party", header: "Party Name", render: (r) => r.partyName, value: (r) => r.partyName },
    { key: "mode", header: "Payment Type", render: (r) => modeOf(r.id), value: (r) => modeOf(r.id) },
    { key: "amount", header: "Amount", align: "right", render: (r) => rupees(r.totalPaise), value: (r) => r.totalPaise / 100 },
    { key: "balance", header: "Balance Due", align: "right", render: (r) => rupees(Math.max(0, r.totalPaise - r.paidPaise)), value: (r) => Math.max(0, r.totalPaise - r.paidPaise) / 100 },
  ];
  const total = sum(rows, (r) => r.totalPaise);
  const paid = sum(rows, (r) => r.paidPaise);
  return (
    <>
      <ReportHeader actions={<ReportActions filename="purchase-report" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div className="flex flex-wrap gap-2">
          <PartyPicker parties={parties} value={party} onChange={setParty} kind="supplier" />
        </div>
      </ReportHeader>
      <ReportTable
        title="Transactions"
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        footer={
          <>
            <Total label="Total Purchase" paise={total} tone="out" />
            <Total label="Paid" paise={paid} />
            <Total label="Balance" paise={total - paid} tone="out" />
          </>
        }
      />
    </>
  );
}

type BookRow = {
  id: string;
  date: number;
  name: string;
  ref: string;
  type: string;
  totalPaise: number;
  inPaise: number;
  outPaise: number;
  balancePaise: number;
};

/** Everything that moved money or turnover in the period, in date order. */
function bookRows(tx: Tx | undefined, includeNonMoney = false): BookRow[] | undefined {
  if (!tx) return undefined;
  const rows: BookRow[] = [];
  for (const s of tx.sales) {
    const sign = saleSign(s.type);
    if (!sign && !includeNonMoney) continue;
    rows.push({
      id: s.id,
      date: s.date,
      name: s.partyName,
      ref: s.number,
      type: SALE_LABEL[s.type] ?? s.type,
      totalPaise: s.totalPaise,
      inPaise: sign > 0 ? s.paidPaise : 0,
      outPaise: sign < 0 ? s.paidPaise : 0,
      balancePaise: sign ? s.totalPaise - s.paidPaise : 0,
    });
  }
  for (const p of tx.purchases) {
    const sign = purchaseSign(p.type);
    if (!sign && !includeNonMoney) continue;
    rows.push({
      id: p.id,
      date: p.date,
      name: p.partyName,
      ref: p.number,
      type: PURCHASE_LABEL[p.type] ?? p.type,
      totalPaise: p.totalPaise,
      inPaise: sign < 0 ? p.paidPaise : 0,
      outPaise: sign > 0 ? p.paidPaise : 0,
      balancePaise: sign ? p.totalPaise - p.paidPaise : 0,
    });
  }
  // Payments not tied to a bill are separate Payment-In / Payment-Out entries.
  for (const p of tx.payments) {
    if (p.sourceTable === "sales" || p.sourceTable === "purchases" || p.sourceTable === "old_gold_exchanges") continue;
    rows.push({
      id: p.id,
      date: p.date,
      name: p.partyName,
      ref: "",
      type: p.direction === "receipt" ? "Payment-In" : "Payment-Out",
      totalPaise: p.amountPaise,
      inPaise: p.direction === "receipt" ? p.amountPaise : 0,
      outPaise: p.direction === "payment" ? p.amountPaise : 0,
      balancePaise: 0,
    });
  }
  for (const e of tx.expenses) {
    rows.push({ id: e.id, date: e.date, name: e.category, ref: "", type: "Expense", totalPaise: e.amountPaise, inPaise: 0, outPaise: e.amountPaise, balancePaise: 0 });
  }
  return rows.sort((a, b) => a.date - b.date);
}

const BOOK_COLUMNS: Column<BookRow>[] = [
  { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
  { key: "name", header: "Name", render: (r) => r.name, value: (r) => r.name },
  { key: "ref", header: "Ref No.", render: (r) => r.ref || "—", value: (r) => r.ref },
  { key: "type", header: "Type", render: (r) => r.type, value: (r) => r.type },
  { key: "total", header: "Total", align: "right", render: (r) => rupees(r.totalPaise), value: (r) => r.totalPaise / 100 },
  { key: "in", header: "Money In", align: "right", render: (r) => (r.inPaise ? <Money paise={r.inPaise} tone="in" /> : "—"), value: (r) => r.inPaise / 100 },
  { key: "out", header: "Money Out", align: "right", render: (r) => (r.outPaise ? <Money paise={r.outPaise} tone="out" /> : "—"), value: (r) => r.outPaise / 100 },
];

function DayBook() {
  const period = usePeriod("today");
  const tx = useTx(period);
  const rows = bookRows(tx);
  const moneyIn = sum(rows, (r) => r.inPaise);
  const moneyOut = sum(rows, (r) => r.outPaise);
  return (
    <>
      <ReportHeader actions={<ReportActions filename="day-book" {...exportRows(BOOK_COLUMNS, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable
        title="Day Book"
        columns={BOOK_COLUMNS}
        rows={rows}
        getKey={(r) => r.id}
        footer={
          <>
            <Total label="Total Money In" paise={moneyIn} tone="in" />
            <Total label="Total Money Out" paise={moneyOut} tone="out" />
            <Total label="Net" paise={moneyIn - moneyOut} />
          </>
        }
      />
    </>
  );
}

function AllTransactions() {
  const period = usePeriod();
  const tx = useTx(period);
  const [type, setType] = useState("");
  const all = bookRows(tx, true);
  const types = [...new Set((all ?? []).map((r) => r.type))].sort();
  const rows = all?.filter((r) => !type || r.type === type);
  const columns: Column<BookRow>[] = [
    ...BOOK_COLUMNS.slice(0, 5),
    { key: "paid", header: "Received/ Paid", align: "right", render: (r) => rupees(r.inPaise + r.outPaise), value: (r) => (r.inPaise + r.outPaise) / 100 },
    { key: "bal", header: "Balance", align: "right", render: (r) => rupees(r.balancePaise), value: (r) => r.balancePaise / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="all-transactions" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div>
          <SelectChip label="Transaction type" value={type} onChange={setType} options={[{ value: "", label: "All Transactions" }, ...types.map((t) => ({ value: t, label: t }))]} />
        </div>
      </ReportHeader>
      <ReportTable title="All Transactions" columns={columns} rows={rows} getKey={(r) => r.id} numbered />
    </>
  );
}

type PlRow = { label: string; paise: number | null; indent?: boolean; bold?: boolean; tone?: "in" | "out" | "auto"; heading?: boolean };

function PlTable({ rows }: { rows: PlRow[] }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="flex justify-between bg-[#eef0f4] px-3 py-2 text-[13px] font-semibold text-[#4b5263] dark:bg-muted dark:text-muted-foreground">
        <span>Particulars</span>
        <span>Amount</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={`${r.label}-${i}`}
          className={cn(
            "flex justify-between border-b border-border/70 px-3 py-2.5 text-[13px]",
            r.indent && "bg-[#f6f7f9] pl-8 dark:bg-muted/40",
            r.bold && "border-y-2 border-[#c9ced8] font-semibold",
          )}
        >
          <span>{r.label}</span>
          {r.paise === null ? <span /> : <Money paise={r.paise} tone={r.tone ?? (r.bold ? "auto" : undefined)} />}
        </div>
      ))}
    </div>
  );
}

function plFigures(tx: Tx) {
  const s = (t: string) => sum(tx.sales.filter((x) => x.type === t), (x) => x.totalPaise);
  const st = (t: string) => sum(tx.sales.filter((x) => x.type === t), (x) => x.taxPaise);
  const p = (t: string) => sum(tx.purchases.filter((x) => x.type === t), (x) => x.totalPaise);
  const pt = (t: string) => sum(tx.purchases.filter((x) => x.type === t), (x) => x.taxPaise);
  const sale = s("sales_invoice");
  const creditNote = s("sales_return") + s("credit_note");
  const purchase = p("purchase_invoice");
  const debitNote = p("purchase_return");
  const taxPayable = st("sales_invoice") - st("sales_return") - st("credit_note");
  const taxReceivable = pt("purchase_invoice") - pt("purchase_return");
  const gross = sale - creditNote - purchase + debitNote - taxPayable + taxReceivable;
  const byCategory = new Map<string, number>();
  for (const e of tx.expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountPaise);
  const expenses = sum(tx.expenses, (e) => e.amountPaise);
  return { sale, creditNote, purchase, debitNote, taxPayable, taxReceivable, gross, byCategory, expenses, net: gross - expenses };
}

function ProfitLoss() {
  const period = usePeriod();
  const tx = useTx(period);
  const f = tx ? plFigures(tx) : null;
  const rows: PlRow[] = f
    ? [
        { label: "Sale (+)", paise: f.sale, tone: "in" },
        { label: "Credit Note / Sale Return (-)", paise: f.creditNote, tone: "out" },
        { label: "Purchase (-)", paise: f.purchase, tone: "out" },
        { label: "Debit Note / Purchase Return (+)", paise: f.debitNote, tone: "in" },
        { label: "Tax Payable (-)", paise: null },
        { label: "GST Payable (-)", paise: f.taxPayable, indent: true, tone: "out" },
        { label: "Tax Receivable (+)", paise: null },
        { label: "GST Receivable (+)", paise: f.taxReceivable, indent: true, tone: "in" },
        { label: "Gross Profit", paise: f.gross, bold: true },
        { label: "Other Income (+)", paise: 0, tone: "in" },
        { label: "Indirect Expenses (-)", paise: null },
        ...([...f.byCategory.entries()].map(([label, paise]) => ({ label, paise, indent: true, tone: "out" as const }))),
        ...(f.byCategory.size === 0 ? [{ label: "Other Expense", paise: 0, indent: true, tone: "out" as const }] : []),
        { label: "Net Profit", paise: f.net, bold: true },
      ]
    : [];
  return (
    <>
      <ReportHeader
        actions={<ReportActions filename="profit-and-loss" headers={["Particulars", "Amount"]} rows={rows.filter((r) => r.paise !== null).map((r) => [r.label, (r.paise ?? 0) / 100])} />}
      >
        <PeriodBar state={period} />
      </ReportHeader>
      <div className="rounded-md bg-card p-4">
        <h2 className="mb-3 text-[15px] font-semibold uppercase">Profit and Loss Report</h2>
        {f ? <PlTable rows={rows} /> : <p className="py-10 text-center text-muted-foreground">Loading…</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Opening and closing stock are not added here: jewellery stock is kept by weight, not by value. Item and bill profit use each piece&apos;s purchase cost instead (see Bill Wise Profit).
        </p>
      </div>
    </>
  );
}

type BillProfit = { id: string; date: number; number: string; party: string; salePaise: number; costPaise: number; unknown: number };

function billProfits(lines: Lines | undefined, filter?: (l: Line) => boolean) {
  if (!lines) return undefined;
  const map = new Map<string, BillProfit>();
  for (const l of lines.saleLines) {
    if (l.docType !== "sales_invoice" || (filter && !filter(l))) continue;
    const row = map.get(l.docId) ?? { id: l.docId, date: l.date, number: l.docNumber, party: l.partyName, salePaise: 0, costPaise: 0, unknown: 0 };
    row.salePaise += l.amountPaise - l.taxPaise;
    if (l.costPaise === null) row.unknown += 1;
    else row.costPaise += l.costPaise;
    map.set(l.docId, row);
  }
  return [...map.values()].sort((a, b) => b.date - a.date);
}

function ProfitCell({ sale, cost, unknown }: { sale: number; cost: number; unknown: number }) {
  if (unknown > 0 && cost === 0) return <span className="text-muted-foreground">No purchase cost</span>;
  return (
    <span title={unknown ? `${unknown} line(s) have no purchase cost and are counted at full sale value` : undefined}>
      <Money paise={sale - cost} tone="auto" />
      {unknown > 0 && <span className="text-muted-foreground"> *</span>}
    </span>
  );
}

function BillWiseProfit() {
  const period = usePeriod();
  const lines = useLines(period);
  const rows = billProfits(lines);
  const columns: Column<BillProfit>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
    { key: "no", header: "Invoice No.", render: (r) => r.number, value: (r) => r.number },
    { key: "party", header: "Party", render: (r) => r.party, value: (r) => r.party },
    { key: "sale", header: "Total Sale Amount", align: "right", render: (r) => rupees(r.salePaise), value: (r) => r.salePaise / 100 },
    { key: "cost", header: "Purchase Cost", align: "right", render: (r) => rupees(r.costPaise), value: (r) => r.costPaise / 100 },
    { key: "profit", header: "Profit (+) / Loss (-)", align: "right", render: (r) => <ProfitCell sale={r.salePaise} cost={r.costPaise} unknown={r.unknown} />, value: (r) => (r.salePaise - r.costPaise) / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="bill-wise-profit" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable
        title="Bill Wise Profit"
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        footer={
          <>
            <Total label="Total Sale Amount" paise={sum(rows, (r) => r.salePaise)} />
            <span>
              Total Profit(+) / Loss(-): <Money paise={sum(rows, (r) => r.salePaise - r.costPaise)} tone="auto" />
            </span>
          </>
        }
      />
      <p className="px-1 text-xs text-muted-foreground">Amounts are before GST. * Some lines have no linked purchase, so their full value is counted as profit.</p>
    </>
  );
}

function CashFlow() {
  const period = usePeriod();
  const tx = useTx(period);
  type Row = { id: string; date: number; name: string; type: string; inPaise: number; outPaise: number; running: number };
  const rows = useMemo(() => {
    if (!tx) return undefined;
    const raw: Omit<Row, "running">[] = [];
    for (const p of tx.payments) {
      if (p.mode !== "cash") continue;
      const sale = p.sourceTable === "sales" || p.sourceTable === "old_gold_exchanges";
      const type = sale ? "Sale" : p.sourceTable === "purchases" ? "Purchase" : p.direction === "receipt" ? "Payment-In" : "Payment-Out";
      raw.push({ id: p.id, date: p.date, name: p.partyName, type, inPaise: p.direction === "receipt" ? p.amountPaise : 0, outPaise: p.direction === "payment" ? p.amountPaise : 0 });
    }
    for (const e of tx.expenses) raw.push({ id: e.id, date: e.date, name: e.category, type: "Expense", inPaise: 0, outPaise: e.amountPaise });
    raw.sort((a, b) => a.date - b.date);
    let running = 0;
    return raw.map((r) => {
      running += r.inPaise - r.outPaise;
      return { ...r, running };
    });
  }, [tx]);
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
    { key: "name", header: "Name", render: (r) => r.name, value: (r) => r.name },
    { key: "type", header: "Type", render: (r) => r.type, value: (r) => r.type },
    { key: "in", header: "Cash In", align: "right", render: (r) => (r.inPaise ? <Money paise={r.inPaise} tone="in" /> : "—"), value: (r) => r.inPaise / 100 },
    { key: "out", header: "Cash Out", align: "right", render: (r) => (r.outPaise ? <Money paise={r.outPaise} tone="out" /> : "—"), value: (r) => r.outPaise / 100 },
    { key: "run", header: "Running Cash Flow", align: "right", render: (r) => <Money paise={r.running} tone="auto" />, value: (r) => r.running / 100 },
  ];
  const cin = sum(rows, (r) => r.inPaise);
  const cout = sum(rows, (r) => r.outPaise);
  return (
    <>
      <ReportHeader actions={<ReportActions filename="cash-flow" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable
        title="Cash Flow"
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        footer={
          <>
            <Total label="Total Cash In" paise={cin} tone="in" />
            <Total label="Total Cash Out" paise={cout} tone="out" />
            <span>
              Net Cash Flow: <Money paise={cin - cout} tone="auto" />
            </span>
          </>
        }
      />
    </>
  );
}

function SheetRow({ label, paise, level = 0, bold, children }: { label: string; paise: number; level?: number; bold?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div className={cn("flex items-center justify-between border-b border-border/60 py-2.5 pr-3 text-[14px]", bold && "font-semibold")} style={{ paddingLeft: 12 + level * 28 }}>
        <span className="flex items-center gap-2">
          {children ? (
            <button type="button" aria-label={open ? `Collapse ${label}` : `Expand ${label}`} onClick={() => setOpen(!open)} className="text-primary">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : (
            <span className="mx-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
          )}
          {label}
        </span>
        <span className="tabular-nums">{(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
      </div>
      {children && open && children}
    </div>
  );
}

function BalanceSheet() {
  const accounts = useQuery(api.vyaparReports.getAccounts, {});
  const parties = useQuery(api.vyaparReports.getParties, {});
  const stock = useQuery(api.vyaparReports.getStockSummary, {});
  const fyPeriod = usePeriod("this_year");
  const tx = useTx(fyPeriod);
  if (!accounts || !parties || !stock || !tx) return <p className="rounded-md bg-card py-16 text-center text-muted-foreground">Loading…</p>;

  const cash = sum(accounts.filter((a) => a.type === "cash"), (a) => a.balancePaise);
  const bank = sum(accounts.filter((a) => a.type === "bank"), (a) => a.balancePaise);
  const customers = parties.filter((p) => p.kind === "customer");
  const suppliers = parties.filter((p) => p.kind === "supplier");
  // A customer we owe money to (advance) is a liability; a supplier who owes us is an asset.
  const debtors = sum(customers, (p) => Math.max(0, p.balancePaise)) + sum(suppliers, (p) => Math.max(0, -p.balancePaise));
  const creditors = sum(suppliers, (p) => Math.max(0, p.balancePaise)) + sum(customers, (p) => Math.max(0, -p.balancePaise));
  const f = plFigures(tx);
  const dutiesNet = f.taxPayable - f.taxReceivable;
  const outwardDuties = Math.max(0, dutiesNet);
  const inputDuties = Math.max(0, -dutiesNet);
  const totalAssets = cash + bank + debtors + inputDuties;
  const liabilities = creditors + outwardDuties;
  const capital = totalAssets - liabilities;
  const stockWeight = sum(stock, (s) => s.weightMg);
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <div className="flex items-center justify-between rounded-md bg-card px-4 py-3">
        <h1 className="text-xl font-semibold">Balance Sheet</h1>
        <ReportActions
          filename="balance-sheet"
          headers={["Account", "Amount"]}
          rows={[
            ["Capital Account", capital / 100],
            ["Sundry Creditors", creditors / 100],
            ["Outward Duties & Taxes", outwardDuties / 100],
            ["Bank Accounts", bank / 100],
            ["Cash Accounts", cash / 100],
            ["Sundry Debtors", debtors / 100],
            ["Input Duties & Taxes", inputDuties / 100],
          ]}
        />
      </div>
      <div className="rounded-md bg-card">
        <p className="px-4 py-3 text-[15px] font-medium">Balance Sheet as on {today}</p>
        <div className="grid md:grid-cols-2 md:divide-x divide-border">
          <div>
            <div className="flex justify-between bg-[#f2f4f7] px-3 py-2 text-xs text-muted-foreground dark:bg-muted"><span>ACCOUNT</span><span>AMOUNT</span></div>
            <p className="px-3 py-3 text-lg">Equities &amp; Liabilities</p>
            <SheetRow label="Capital Account" paise={capital}>
              <SheetRow label="Owner's Equity (assets − liabilities)" paise={capital} level={1} />
              <SheetRow label={`Net Income (this financial year)`} paise={f.net} level={1} />
            </SheetRow>
            <SheetRow label="Long-term Liabilities" paise={0} />
            <SheetRow label="Current Liabilities" paise={liabilities}>
              <SheetRow label="Sundry Creditors" paise={creditors} level={1} />
              <SheetRow label="Outward Duties & Taxes" paise={outwardDuties} level={1} />
              <SheetRow label="Other Current Liabilities" paise={0} level={1} />
            </SheetRow>
          </div>
          <div>
            <div className="flex justify-between bg-[#f2f4f7] px-3 py-2 text-xs text-muted-foreground dark:bg-muted"><span>ACCOUNT</span><span>AMOUNT</span></div>
            <p className="px-3 py-3 text-lg">Assets</p>
            <SheetRow label="Fixed Assets" paise={0} />
            <SheetRow label="Current Assets" paise={totalAssets}>
              <SheetRow label="Sundry Debtors" paise={debtors} level={1} />
              <SheetRow label="Input Duties & Taxes" paise={inputDuties} level={1} />
              <SheetRow label="Bank Accounts" paise={bank} level={1}>
                {accounts.filter((a) => a.type === "bank").map((a) => <SheetRow key={a.id} label={a.name} paise={a.balancePaise} level={2} />)}
              </SheetRow>
              <SheetRow label="Cash Accounts" paise={cash} level={1}>
                {accounts.filter((a) => a.type === "cash").map((a) => <SheetRow key={a.id} label={a.name} paise={a.balancePaise} level={2} />)}
              </SheetRow>
            </SheetRow>
            <div className="flex justify-between border-b border-border/60 px-3 py-2.5 text-[14px] text-muted-foreground">
              <span>Stock-in-hand (by weight, not valued)</span>
              <span>{grams(stockWeight)}</span>
            </div>
          </div>
        </div>
        <div className="grid bg-[#e3effb] text-[17px] font-medium text-primary md:grid-cols-2 dark:bg-accent">
          <div className="flex justify-between px-3 py-3"><span>Total Equities &amp; Liabilities</span><span>{(totalAssets / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
          <div className="flex justify-between px-3 py-3"><span>Total Assets</span><span>{(totalAssets / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Party reports                                                       */
/* ------------------------------------------------------------------ */

function PartyStatement() {
  const period = usePeriod();
  const parties = useQuery(api.vyaparReports.getParties, {});
  const [partyId, setPartyId] = useState("");
  const party = parties?.find((p) => p.id === partyId);
  const customerLedger = useQuery(api.customers.getLedger, party?.kind === "customer" ? { customerId: party.id as Id<"customers"> } : "skip");
  const supplierLedger = useQuery(api.suppliers.getLedger, party?.kind === "supplier" ? { supplierId: party.id as Id<"suppliers"> } : "skip");
  const ledger = party?.kind === "customer" ? customerLedger : supplierLedger;
  const tx = useTx(period);
  type Row = { id: string; date: number; type: string; ref: string; debit: number; credit: number; balance: number };
  const refOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of tx?.sales ?? []) map.set(s.id, `${SALE_LABEL[s.type] ?? "Sale"}|${s.number}`);
    for (const p of tx?.purchases ?? []) map.set(p.id, `${PURCHASE_LABEL[p.type] ?? "Purchase"}|${p.number}`);
    return map;
  }, [tx]);
  const rows: Row[] | undefined = !party
    ? []
    : ledger?.entries
        .filter((e) => e.createdAt >= period.period.startDate && e.createdAt <= period.period.endDate)
        .map((e) => {
          const [type, ref] = (refOf.get(e.sourceId) ?? "").split("|");
          const fallback = e.sourceTable.includes("payment") ? (party.kind === "customer" ? "Payment-In" : "Payment-Out") : e.sourceTable.replaceAll("_", " ");
          return { id: e._id, date: e.createdAt, type: type || fallback, ref: ref ?? "", debit: e.debitPaise, credit: e.creditPaise, balance: e.balancePaise };
        })
        .reverse();
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
    { key: "type", header: "Txn Type", render: (r) => <span className="capitalize">{r.type}</span>, value: (r) => r.type },
    { key: "ref", header: "Ref No.", render: (r) => r.ref || "—", value: (r) => r.ref },
    { key: "debit", header: party?.kind === "supplier" ? "Paid / Return" : "Total", align: "right", render: (r) => (r.debit ? rupees(r.debit) : "—"), value: (r) => r.debit / 100 },
    { key: "credit", header: party?.kind === "supplier" ? "Total" : "Received", align: "right", render: (r) => (r.credit ? rupees(r.credit) : "—"), value: (r) => r.credit / 100 },
    {
      key: "bal",
      header: party?.kind === "supplier" ? "Payable Balance" : "Receivable Balance",
      align: "right",
      render: (r) => rupees(r.balance),
      value: (r) => r.balance / 100,
    },
  ];
  const partySales = (tx?.sales ?? []).filter((s) => s.partyId === partyId);
  const partyPurchases = (tx?.purchases ?? []).filter((p) => p.partyId === partyId);
  const partyPayments = (tx?.payments ?? []).filter((p) => p.partyId === partyId);
  const saleNet = sum(partySales, (s) => saleSign(s.type) * s.totalPaise);
  const purchaseNet = sum(partyPurchases, (p) => purchaseSign(p.type) * p.totalPaise);
  return (
    <>
      <ReportHeader actions={<ReportActions filename="party-statement" {...exportRows(columns, rows)} />}>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodBar state={period} />
          <PartyPicker parties={parties} value={partyId} onChange={setPartyId} placeholder="Select Party" />
        </div>
      </ReportHeader>
      <ReportTable title="Party Statement" columns={columns} rows={rows} getKey={(r) => r.id} empty={party ? "No transactions to show" : "Select a party to see the statement"} />
      {party && (
        <div className="rounded-md bg-card px-4 py-3">
          <h3 className="mb-2 text-[17px]">Party Statement Summary</h3>
          <div className="grid gap-3 text-[13px] sm:grid-cols-4">
            <div>
              Total Sale: {rupees(saleNet)}
              <p className="text-muted-foreground">(Sale - Sale Return)</p>
            </div>
            <div>
              Total Purchase: {rupees(purchaseNet)}
              <p className="text-muted-foreground">(Purchase - Purchase Return)</p>
            </div>
            <div>
              Total Money-In: {rupees(sum(partyPayments.filter((p) => p.direction === "receipt"), (p) => p.amountPaise))}
              <p>Total Money-Out: {rupees(sum(partyPayments.filter((p) => p.direction === "payment"), (p) => p.amountPaise))}</p>
            </div>
            <div className="sm:border-l sm:pl-4">
              <p className="font-semibold">{party.kind === "supplier" ? "Total Payable" : "Total Receivable"}</p>
              <p className="text-lg font-semibold text-success">{rupees(ledger?.outstandingPaise ?? party.balancePaise)}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PartyProfitLoss() {
  const period = usePeriod();
  const lines = useLines(period);
  const parties = useQuery(api.vyaparReports.getParties, {});
  const [partyId, setPartyId] = useState("");
  type Row = { id: string; name: string; phone: string; salePaise: number; costPaise: number; unknown: number };
  const rows = useMemo(() => {
    if (!lines) return undefined;
    const phone = new Map((parties ?? []).map((p) => [p.id, p.phone]));
    const map = new Map<string, Row>();
    for (const l of lines.saleLines) {
      if (l.docType !== "sales_invoice" || (partyId && l.partyId !== partyId)) continue;
      const row = map.get(l.partyId) ?? { id: l.partyId, name: l.partyName, phone: phone.get(l.partyId) ?? "", salePaise: 0, costPaise: 0, unknown: 0 };
      row.salePaise += l.amountPaise;
      if (l.costPaise === null) row.unknown += 1;
      else row.costPaise += l.costPaise;
      map.set(l.partyId, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [lines, parties, partyId]);
  const columns: Column<Row>[] = [
    { key: "name", header: "Party Name", render: (r) => r.name, value: (r) => r.name },
    { key: "phone", header: "Phone No.", render: (r) => r.phone || "—", value: (r) => r.phone },
    { key: "sale", header: "Total Sale Amount", align: "right", render: (r) => rupees(r.salePaise), value: (r) => r.salePaise / 100 },
    { key: "profit", header: "Profit (+) / Loss (-)", align: "right", render: (r) => <ProfitCell sale={r.salePaise} cost={r.costPaise} unknown={r.unknown} />, value: (r) => (r.salePaise - r.costPaise) / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="party-wise-profit-loss" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div>
          <PartyPicker parties={parties} value={partyId} onChange={setPartyId} kind="customer" />
        </div>
      </ReportHeader>
      <ReportTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        numbered
        footer={
          <>
            <Total label="Total Sale Amount" paise={sum(rows, (r) => r.salePaise)} />
            <span>
              Total Profit(+) / Loss (-): <Money paise={sum(rows, (r) => r.salePaise - r.costPaise)} tone="auto" />
            </span>
          </>
        }
      />
    </>
  );
}

function AllParties() {
  const parties = useQuery(api.vyaparReports.getParties, {});
  const [filter, setFilter] = useState("all");
  const rows = parties?.filter((p) => {
    if (filter === "receivable") return (p.kind === "customer" && p.balancePaise > 0) || (p.kind === "supplier" && p.balancePaise < 0);
    if (filter === "payable") return (p.kind === "supplier" && p.balancePaise > 0) || (p.kind === "customer" && p.balancePaise < 0);
    if (filter === "customers") return p.kind === "customer";
    if (filter === "suppliers") return p.kind === "supplier";
    return true;
  });
  const receivable = (p: Party) => (p.kind === "customer" ? Math.max(0, p.balancePaise) : Math.max(0, -p.balancePaise));
  const payable = (p: Party) => (p.kind === "supplier" ? Math.max(0, p.balancePaise) : Math.max(0, -p.balancePaise));
  const columns: Column<Party>[] = [
    { key: "name", header: "Party Name", render: (r) => r.name, value: (r) => r.name },
    { key: "email", header: "Email", render: (r) => r.email || "—", value: (r) => r.email },
    { key: "phone", header: "Phone No.", render: (r) => r.phone || "—", value: (r) => r.phone },
    { key: "rec", header: "Receivable Balance", align: "right", render: (r) => (receivable(r) ? <Money paise={receivable(r)} tone="in" /> : "—"), value: (r) => receivable(r) / 100 },
    { key: "pay", header: "Payable Balance", align: "right", render: (r) => (payable(r) ? <Money paise={payable(r)} tone="out" /> : "—"), value: (r) => payable(r) / 100 },
    { key: "limit", header: "Credit Limit", align: "right", render: (r) => (r.creditLimitPaise ? rupees(r.creditLimitPaise) : "—"), value: (r) => (r.creditLimitPaise ?? 0) / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="all-parties" {...exportRows(columns, rows)} />}>
        <div>
          <SelectChip
            label="Parties"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All parties" },
              { value: "customers", label: "Customers" },
              { value: "suppliers", label: "Suppliers" },
              { value: "receivable", label: "Receivable" },
              { value: "payable", label: "Payable" },
            ]}
          />
        </div>
      </ReportHeader>
      <ReportTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        numbered
        footer={
          <>
            <Total label="Total Receivable" paise={sum(rows, receivable)} tone="in" />
            <Total label="Total Payable" paise={sum(rows, payable)} tone="out" />
          </>
        }
      />
    </>
  );
}

type QtyRow = { id: string; name: string; saleQty: number; salePaise: number; saleWeightMg: number; purchaseQty: number; purchasePaise: number };

function groupLines(lines: Lines | undefined, key: (l: Line) => [string, string] | null) {
  if (!lines) return undefined;
  const map = new Map<string, QtyRow>();
  const add = (l: Line, sale: boolean) => {
    const k = key(l);
    if (!k) return;
    const sign = sale ? saleSign(l.docType) : purchaseSign(l.docType);
    if (!sign) return;
    const row = map.get(k[0]) ?? { id: k[0], name: k[1], saleQty: 0, salePaise: 0, saleWeightMg: 0, purchaseQty: 0, purchasePaise: 0 };
    if (sale) {
      row.saleQty += sign * l.quantity;
      row.salePaise += sign * l.amountPaise;
      row.saleWeightMg += sign * l.netWeightMg;
    } else {
      row.purchaseQty += sign * l.quantity;
      row.purchasePaise += sign * l.amountPaise;
    }
    map.set(k[0], row);
  };
  for (const l of lines.saleLines) add(l, true);
  for (const l of lines.purchaseLines) add(l, false);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function qtyColumns(nameHeader: string): Column<QtyRow>[] {
  return [
    { key: "name", header: nameHeader, render: (r) => r.name, value: (r) => r.name },
    { key: "sq", header: "Sale Quantity", align: "right", render: (r) => r.saleQty, value: (r) => r.saleQty },
    { key: "sa", header: "Sale Amount", align: "right", render: (r) => rupees(r.salePaise), value: (r) => r.salePaise / 100 },
    { key: "pq", header: "Purchase Quantity", align: "right", render: (r) => r.purchaseQty, value: (r) => r.purchaseQty },
    { key: "pa", header: "Purchase Amount", align: "right", render: (r) => rupees(r.purchasePaise), value: (r) => r.purchasePaise / 100 },
  ];
}

function QtyFooter({ rows }: { rows: QtyRow[] | undefined }) {
  return (
    <>
      <span className="font-medium">Total:</span>
      <span>Sale Qty {sum(rows, (r) => r.saleQty)}</span>
      <Total label="Sale" paise={sum(rows, (r) => r.salePaise)} tone="in" />
      <span>Purchase Qty {sum(rows, (r) => r.purchaseQty)}</span>
      <Total label="Purchase" paise={sum(rows, (r) => r.purchasePaise)} tone="out" />
    </>
  );
}

function PartyReportByItem() {
  const period = usePeriod();
  const lines = useLines(period);
  const [category, setCategory] = useState("");
  const [item, setItem] = useState("");
  const all = [...(lines?.saleLines ?? []), ...(lines?.purchaseLines ?? [])];
  const categories = [...new Set(all.map((l) => l.categoryName))].sort();
  const items = [...new Map(all.filter((l) => !category || l.categoryName === category).map((l) => [l.productId, l.productName])).entries()];
  const rows = groupLines(lines, (l) => ((!category || l.categoryName === category) && (!item || l.productId === item) ? [l.partyId, l.partyName] : null));
  const columns = qtyColumns("Party Name");
  return (
    <>
      <ReportHeader actions={<ReportActions filename="party-report-by-item" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div className="flex flex-wrap gap-2">
          <SelectChip label="Category" value={category} onChange={(v) => { setCategory(v); setItem(""); }} options={[{ value: "", label: "All Categories" }, ...categories.map((c) => ({ value: c, label: c }))]} />
          <SelectChip label="Item" value={item} onChange={setItem} options={[{ value: "", label: "All Items" }, ...items.map(([id, name]) => ({ value: id, label: name }))]} />
        </div>
      </ReportHeader>
      <ReportTable columns={columns} rows={rows} getKey={(r) => r.id} numbered footer={<QtyFooter rows={rows} />} />
    </>
  );
}

function SalePurchaseByParty({ byGroup = false }: { byGroup?: boolean }) {
  const period = usePeriod();
  const tx = useTx(period);
  type Row = { id: string; name: string; salePaise: number; purchasePaise: number };
  const rows = useMemo(() => {
    if (!tx) return undefined;
    const map = new Map<string, Row>();
    const add = (id: string, name: string, sale: number, purchase: number) => {
      const row = map.get(id) ?? { id, name, salePaise: 0, purchasePaise: 0 };
      row.salePaise += sale;
      row.purchasePaise += purchase;
      map.set(id, row);
    };
    for (const s of tx.sales) {
      const sign = saleSign(s.type);
      if (!sign) continue;
      if (byGroup) add(s.partyGroup, GROUP_LABEL[s.partyGroup] ?? s.partyGroup, sign * s.totalPaise, 0);
      else add(s.partyId, s.partyName, sign * s.totalPaise, 0);
    }
    for (const p of tx.purchases) {
      const sign = purchaseSign(p.type);
      if (!sign) continue;
      if (byGroup) add("supplier", GROUP_LABEL.supplier, 0, sign * p.totalPaise);
      else add(p.partyId, p.partyName, 0, sign * p.totalPaise);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tx, byGroup]);
  const columns: Column<Row>[] = [
    { key: "name", header: byGroup ? "Group Name" : "Party Name", render: (r) => r.name, value: (r) => r.name },
    { key: "sale", header: "Sale Amount", align: "right", render: (r) => (r.salePaise ? <Money paise={r.salePaise} tone={byGroup ? undefined : "in"} /> : "—"), value: (r) => r.salePaise / 100 },
    { key: "purchase", header: "Purchase Amount", align: "right", render: (r) => (r.purchasePaise ? rupees(r.purchasePaise) : "—"), value: (r) => r.purchasePaise / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename={byGroup ? "sale-purchase-by-party-group" : "sale-purchase-by-party"} {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable
        title={byGroup ? "Sale Purchase By Party Group" : undefined}
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        numbered={!byGroup}
        footer={
          <>
            <Total label="Total Sale Amount" paise={sum(rows, (r) => r.salePaise)} tone="in" />
            <Total label="Total Purchase Amount" paise={sum(rows, (r) => r.purchasePaise)} tone="out" />
          </>
        }
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* GST / Item / Stock reports                                          */
/* ------------------------------------------------------------------ */

function SaleSummaryByHsn() {
  const period = usePeriod();
  const lines = useLines(period);
  type Row = { hsn: string; qty: number; weightMg: number; taxable: number; tax: number; total: number };
  const rows = useMemo(() => {
    if (!lines) return undefined;
    const map = new Map<string, Row>();
    for (const l of lines.saleLines) {
      const sign = saleSign(l.docType);
      if (!sign) continue;
      const key = l.hsn || "No HSN";
      const row = map.get(key) ?? { hsn: key, qty: 0, weightMg: 0, taxable: 0, tax: 0, total: 0 };
      row.qty += sign * l.quantity;
      row.weightMg += sign * l.netWeightMg;
      row.taxable += sign * (l.amountPaise - l.taxPaise);
      row.tax += sign * l.taxPaise;
      row.total += sign * l.amountPaise;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn));
  }, [lines]);
  const columns: Column<Row>[] = [
    { key: "hsn", header: "HSN/SAC", render: (r) => r.hsn, value: (r) => r.hsn },
    { key: "qty", header: "Total Qty", align: "right", render: (r) => r.qty, value: (r) => r.qty },
    { key: "wt", header: "Net Weight", align: "right", render: (r) => grams(r.weightMg), value: (r) => r.weightMg / 1000 },
    { key: "taxable", header: "Taxable Value", align: "right", render: (r) => rupees(r.taxable), value: (r) => r.taxable / 100 },
    { key: "tax", header: "Total Tax", align: "right", render: (r) => rupees(r.tax), value: (r) => r.tax / 100 },
    { key: "total", header: "Total Value", align: "right", render: (r) => rupees(r.total), value: (r) => r.total / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="sale-summary-by-hsn" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable title="Sale Summary By HSN" columns={columns} rows={rows} getKey={(r) => r.hsn} footer={<><Total label="Taxable Value" paise={sum(rows, (r) => r.taxable)} /><Total label="Total Tax" paise={sum(rows, (r) => r.tax)} /><Total label="Total" paise={sum(rows, (r) => r.total)} tone="in" /></>} />
    </>
  );
}

type StockRow = FunctionReturnType<typeof api.vyaparReports.getStockSummary>[number];

function StockSummary({ lowOnly = false }: { lowOnly?: boolean }) {
  const stock = useQuery(api.vyaparReports.getStockSummary, {});
  const [category, setCategory] = useState("");
  const categories = [...new Set((stock ?? []).map((s) => s.categoryName))].sort();
  const rows = stock?.filter(
    (s) =>
      (!category || s.categoryName === category) &&
      (!lowOnly || (s.reorderLevelMg !== null && s.weightMg <= s.reorderLevelMg)),
  );
  const columns: Column<StockRow>[] = [
    { key: "name", header: "Item Name", render: (r) => r.name, value: (r) => r.name },
    { key: "cat", header: "Category", render: (r) => r.categoryName, value: (r) => r.categoryName },
    { key: "purity", header: "Purity", render: (r) => r.purityName || "—", value: (r) => r.purityName },
    ...(lowOnly
      ? [{ key: "min", header: "Minimum Stock", align: "right" as const, render: (r: StockRow) => grams(r.reorderLevelMg ?? 0), value: (r: StockRow) => (r.reorderLevelMg ?? 0) / 1000 }]
      : []),
    { key: "qty", header: "Stock Qty", align: "right", render: (r) => r.pieces, value: (r) => r.pieces },
    {
      key: "wt",
      header: "Stock Weight",
      align: "right",
      render: (r) => <span className={cn(r.reorderLevelMg !== null && r.weightMg <= r.reorderLevelMg && "text-destructive")}>{grams(r.weightMg)}</span>,
      value: (r) => r.weightMg / 1000,
    },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename={lowOnly ? "low-stock-summary" : "stock-summary"} {...exportRows(columns, rows)} />}>
        <h1 className="text-xl font-semibold">{lowOnly ? "Low Stock Summary" : "Stock Summary"}</h1>
        <div>
          <SelectChip label="Category" value={category} onChange={setCategory} options={[{ value: "", label: "All Categories" }, ...categories.map((c) => ({ value: c, label: c }))]} />
        </div>
      </ReportHeader>
      <ReportTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        numbered
        empty={lowOnly ? "No item is below its minimum stock (set it in Items → Min Stock To Maintain)" : "No items"}
        footer={
          <>
            <span>Total Qty: {sum(rows, (r) => r.pieces)}</span>
            <span>Total Weight: {grams(sum(rows, (r) => r.weightMg))}</span>
          </>
        }
      />
    </>
  );
}

function ItemReportByParty() {
  const period = usePeriod();
  const lines = useLines(period);
  const parties = useQuery(api.vyaparReports.getParties, {});
  const [partyId, setPartyId] = useState("");
  const rows = groupLines(lines, (l) => (!partyId || l.partyId === partyId ? [l.productId, l.productName] : null));
  const columns = qtyColumns("Item Name");
  return (
    <>
      <ReportHeader actions={<ReportActions filename="item-report-by-party" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div>
          <PartyPicker parties={parties} value={partyId} onChange={setPartyId} />
        </div>
      </ReportHeader>
      <ReportTable columns={columns} rows={rows} getKey={(r) => r.id} numbered footer={<QtyFooter rows={rows} />} />
    </>
  );
}

function ItemProfitLoss({ byCategory = false }: { byCategory?: boolean }) {
  const period = usePeriod();
  const lines = useLines(period);
  type Row = { id: string; name: string; qty: number; weightMg: number; salePaise: number; costPaise: number; unknown: number };
  const rows = useMemo(() => {
    if (!lines) return undefined;
    const map = new Map<string, Row>();
    for (const l of lines.saleLines) {
      if (l.docType !== "sales_invoice") continue;
      const [id, name] = byCategory ? [l.categoryName, l.categoryName] : [l.productId, l.productName];
      const row = map.get(id) ?? { id, name, qty: 0, weightMg: 0, salePaise: 0, costPaise: 0, unknown: 0 };
      row.qty += l.quantity;
      row.weightMg += l.netWeightMg;
      row.salePaise += l.amountPaise - l.taxPaise;
      if (l.costPaise === null) row.unknown += 1;
      else row.costPaise += l.costPaise;
      map.set(id, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [lines, byCategory]);
  const columns: Column<Row>[] = [
    { key: "name", header: byCategory ? "Category" : "Item Name", render: (r) => r.name, value: (r) => r.name },
    { key: "qty", header: "Sale Qty", align: "right", render: (r) => r.qty, value: (r) => r.qty },
    { key: "wt", header: "Net Weight", align: "right", render: (r) => grams(r.weightMg), value: (r) => r.weightMg / 1000 },
    { key: "sale", header: "Sale Amount", align: "right", render: (r) => rupees(r.salePaise), value: (r) => r.salePaise / 100 },
    { key: "cost", header: "Purchase Cost", align: "right", render: (r) => rupees(r.costPaise), value: (r) => r.costPaise / 100 },
    { key: "profit", header: "Net Profit/ Loss", align: "right", render: (r) => <ProfitCell sale={r.salePaise} cost={r.costPaise} unknown={r.unknown} />, value: (r) => (r.salePaise - r.costPaise) / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename={byCategory ? "item-category-profit-loss" : "item-wise-profit-loss"} {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        numbered
        footer={
          <span>
            Total Profit(+) / Loss(-): <Money paise={sum(rows, (r) => r.salePaise - r.costPaise)} tone="auto" />
          </span>
        }
      />
      <p className="px-1 text-xs text-muted-foreground">Amounts are before GST. * Some lines have no linked purchase, so their full value is counted as profit.</p>
    </>
  );
}

function SalePurchaseByCategory() {
  const period = usePeriod();
  const lines = useLines(period);
  const rows = groupLines(lines, (l) => [l.categoryName, l.categoryName]);
  const columns = qtyColumns("Item Category");
  return (
    <>
      <ReportHeader actions={<ReportActions filename="sale-purchase-by-category" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable columns={columns} rows={rows} getKey={(r) => r.id} numbered footer={<QtyFooter rows={rows} />} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Business status / expenses / orders                                */
/* ------------------------------------------------------------------ */

function BankStatement() {
  const period = usePeriod();
  const accounts = useQuery(api.vyaparReports.getAccounts, {});
  const [accountId, setAccountId] = useState("");
  const chosen = accountId || accounts?.[0]?.id || "";
  const ledger = useQuery(api.cashBank.getLedger, chosen ? { accountId: chosen as Id<"bankAccounts"> } : "skip");
  type Row = NonNullable<typeof ledger>["entries"][number];
  const rows = ledger?.entries.filter((e) => e.createdAt >= period.period.startDate && e.createdAt <= period.period.endDate).reverse();
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.createdAt), value: (r) => dmy(r.createdAt) },
    { key: "desc", header: "Description", render: (r) => r.description, value: (r) => r.description },
    { key: "in", header: "Deposit", align: "right", render: (r) => (r.creditPaise ? <Money paise={r.creditPaise} tone="in" /> : "—"), value: (r) => r.creditPaise / 100 },
    { key: "out", header: "Withdrawal", align: "right", render: (r) => (r.debitPaise ? <Money paise={r.debitPaise} tone="out" /> : "—"), value: (r) => r.debitPaise / 100 },
    { key: "bal", header: "Balance", align: "right", render: (r) => rupees(r.balancePaise), value: (r) => r.balancePaise / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="bank-statement" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
        <div>
          <SelectChip label="Account" value={chosen} onChange={setAccountId} options={(accounts ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.type === "cash" ? "Cash" : "Bank"})` }))} />
        </div>
      </ReportHeader>
      <ReportTable
        title="Bank Statement"
        columns={columns}
        rows={chosen ? rows : []}
        getKey={(r) => r._id}
        empty={accounts && accounts.length === 0 ? "No cash or bank account yet — add one in Cash & Bank" : "No transactions to show"}
        footer={ledger ? <Total label="Current Balance" paise={ledger.balancePaise} tone="in" /> : undefined}
      />
    </>
  );
}

function ExpenseReport({ byCategory = false }: { byCategory?: boolean }) {
  const period = usePeriod();
  const tx = useTx(period);
  type Row = { id: string; date: number; category: string; description: string; amountPaise: number; count: number };
  const rows: Row[] | undefined = useMemo(() => {
    if (!tx) return undefined;
    if (!byCategory) return tx.expenses.map((e) => ({ ...e, count: 1 })).sort((a, b) => b.date - a.date);
    const map = new Map<string, Row>();
    for (const e of tx.expenses) {
      const row = map.get(e.category) ?? { id: e.category, date: 0, category: e.category, description: "", amountPaise: 0, count: 0 };
      row.amountPaise += e.amountPaise;
      row.count += 1;
      map.set(e.category, row);
    }
    return [...map.values()].sort((a, b) => b.amountPaise - a.amountPaise);
  }, [tx, byCategory]);
  const columns: Column<Row>[] = byCategory
    ? [
        { key: "cat", header: "Expense Category", render: (r) => r.category, value: (r) => r.category },
        { key: "count", header: "Entries", align: "right", render: (r) => r.count, value: (r) => r.count },
        { key: "amt", header: "Amount", align: "right", render: (r) => rupees(r.amountPaise), value: (r) => r.amountPaise / 100 },
      ]
    : [
        { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
        { key: "cat", header: "Expense Category", render: (r) => r.category, value: (r) => r.category },
        { key: "desc", header: "Description", render: (r) => r.description || "—", value: (r) => r.description },
        { key: "amt", header: "Amount", align: "right", render: (r) => rupees(r.amountPaise), value: (r) => r.amountPaise / 100 },
      ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename={byCategory ? "expense-category-report" : "expense-report"} {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable title={byCategory ? "Expense Category Report" : "Expenses"} columns={columns} rows={rows} getKey={(r) => r.id} footer={<Total label="Total Expense" paise={sum(rows, (r) => r.amountPaise)} tone="out" />} />
    </>
  );
}

function OrdersReport() {
  const period = usePeriod();
  const tx = useTx(period);
  type Row = { id: string; date: number; number: string; party: string; type: string; totalPaise: number; paidPaise: number };
  const rows: Row[] | undefined = tx
    ? [
        ...tx.sales.filter((s) => s.type === "sales_order").map((s) => ({ id: s.id, date: s.date, number: s.number, party: s.partyName, type: "Sale Order", totalPaise: s.totalPaise, paidPaise: s.paidPaise })),
        ...tx.purchases.filter((p) => p.type === "purchase_order").map((p) => ({ id: p.id, date: p.date, number: p.number, party: p.partyName, type: "Purchase Order", totalPaise: p.totalPaise, paidPaise: p.paidPaise })),
      ].sort((a, b) => b.date - a.date)
    : undefined;
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", render: (r) => dmy(r.date), value: (r) => dmy(r.date) },
    { key: "no", header: "Order No.", render: (r) => r.number, value: (r) => r.number },
    { key: "party", header: "Party Name", render: (r) => r.party, value: (r) => r.party },
    { key: "type", header: "Type", render: (r) => r.type, value: (r) => r.type },
    { key: "total", header: "Total", align: "right", render: (r) => rupees(r.totalPaise), value: (r) => r.totalPaise / 100 },
    { key: "adv", header: "Advance", align: "right", render: (r) => rupees(r.paidPaise), value: (r) => r.paidPaise / 100 },
    { key: "bal", header: "Balance", align: "right", render: (r) => rupees(r.totalPaise - r.paidPaise), value: (r) => (r.totalPaise - r.paidPaise) / 100 },
  ];
  return (
    <>
      <ReportHeader actions={<ReportActions filename="sale-purchase-orders" {...exportRows(columns, rows)} />}>
        <PeriodBar state={period} />
      </ReportHeader>
      <ReportTable title="Sale/ Purchase Orders" columns={columns} rows={rows} getKey={(r) => r.id} />
    </>
  );
}

function sum<T>(rows: T[] | undefined, pick: (row: T) => number) {
  return (rows ?? []).reduce((total, row) => total + pick(row), 0);
}

export const VYAPAR_REPORTS: Record<string, () => ReactNode> = {
  sale: () => <SaleReport />,
  purchase: () => <PurchaseReport />,
  "day-book": () => <DayBook />,
  "all-transactions": () => <AllTransactions />,
  "profit-loss": () => <ProfitLoss />,
  "bill-wise-profit": () => <BillWiseProfit />,
  "cash-flow": () => <CashFlow />,
  "balance-sheet": () => <BalanceSheet />,
  "party-statement": () => <PartyStatement />,
  "party-profit-loss": () => <PartyProfitLoss />,
  "all-parties": () => <AllParties />,
  "party-report-by-item": () => <PartyReportByItem />,
  "sale-purchase-by-party": () => <SalePurchaseByParty />,
  "sale-purchase-by-party-group": () => <SalePurchaseByParty byGroup />,
  "sale-summary-by-hsn": () => <SaleSummaryByHsn />,
  "stock-summary": () => <StockSummary />,
  "low-stock": () => <StockSummary lowOnly />,
  "item-report-by-party": () => <ItemReportByParty />,
  "item-profit-loss": () => <ItemProfitLoss />,
  "item-category-profit-loss": () => <ItemProfitLoss byCategory />,
  "sale-purchase-by-category": () => <SalePurchaseByCategory />,
  "bank-statement": () => <BankStatement />,
  expense: () => <ExpenseReport />,
  "expense-category": () => <ExpenseReport byCategory />,
  orders: () => <OrdersReport />,
};
