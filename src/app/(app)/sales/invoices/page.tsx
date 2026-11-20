"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Eye,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Search,
  Filter,
  Calendar,
  Building2,
  FileSpreadsheet,
  Pause,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { periodRange } from "@/components/report-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransactionReportDialog } from "@/components/transaction-report-dialog";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { getUserErrorMessage } from "@/lib/user-error";
import type { Id } from "../../../../../convex/_generated/dataModel";

function SaleDetailDialog({
  saleId,
  onClose,
}: {
  saleId: Id<"sales">;
  onClose: () => void;
}) {
  const cancel = useMutation(api.sales.cancel);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const items = useQuery(api.sales.getItems, { saleId });
  const oldGoldExchange = useQuery(api.sales.getOldGoldExchange, { saleId });
  const access = useQuery(api.organizations.getMyAccess);
  const canEdit =
    access?.membership?.role === "owner" || access?.membership?.role === "admin";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-center justify-between pr-6">
          <DialogTitle>Sale items</DialogTitle>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  const reason = window.prompt(
                    "Delete invoice and reverse its stock and payments. Enter a reason:",
                  );
                  if (!reason?.trim()) return;
                  setDeleting(true);
                  try {
                    await cancel({ saleId, reason });
                    onClose();
                  } catch (e) {
                    setError(getUserErrorMessage(e, "Delete failed"));
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                Delete
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sales/new?edit=${saleId}`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sales/invoices/${saleId}/print`} target="_blank">
                <Printer className="h-4 w-4" />
                Print A5 / Share
              </Link>
            </Button>
          </div>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {items === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items</p>
        ) : (
          <div className="space-y-3">
            {items.map((i) => (
              <div
                key={i._id}
                className="flex items-center justify-between border-b pb-2 text-sm"
              >
                <div>
                  <p className="font-medium">Jewellery Item · {mgToGramsDisplay(i.netWeightMg)}g</p>
                  <p className="text-xs text-muted-foreground">
                    Gross {mgToGramsDisplay(i.grossWeightMg)}g
                    {i.stoneWeightMg ? ` (${mgToGramsDisplay(i.stoneWeightMg)}g stone)` : ""} @{" "}
                    {i.unitPricePaise ? `${formatPaise(i.unitPricePaise)}/pc` : `${formatPaise(i.ratePerGramPaise)}/g`}
                  </p>
                </div>
                <p className="font-medium">{formatPaise(i.lineTotalPaise)}</p>
              </div>
            ))}
          </div>
        )}
        {oldGoldExchange && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Old gold / silver exchange</p>
            <p className="text-muted-foreground">
              {mgToGramsDisplay(oldGoldExchange.netWeightMg)}g net (after{" "}
              {(oldGoldExchange.meltingDeductionBasisPoints / 100).toFixed(2)}% melting deduction) @{" "}
              {formatPaise(oldGoldExchange.ratePerGramPaise)}/g ={" "}
              <span className="font-medium text-foreground">
                {formatPaise(oldGoldExchange.exchangeValuePaise)}
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Bills parked with "Hold" on New Bill: open one to finish and generate the invoice, or drop it. */
function HeldBillsCard() {
  const heldBills = useQuery(api.heldBills.list);
  const members = useQuery(api.memberships.listMembers);
  const removeHeld = useMutation(api.heldBills.remove);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!heldBills || heldBills.length === 0) return null;
  const memberName = new Map(members?.map((m) => [m.userId as string, m.name]) ?? []);
  return (
    <Card className="border-amber-300 bg-amber-50/40 shadow-xs dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-5 py-3 dark:border-amber-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
          <Pause className="h-4 w-4" /> On hold - waiting to be billed ({heldBills.length})
        </h3>
        <span className="text-xs text-muted-foreground">No invoice number, stock or payment is booked until you open the bill and save it.</span>
      </div>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Held at</TableHead>
              <TableHead>Held by</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {heldBills.map((h) => (
              <TableRow key={h._id}>
                <TableCell className="font-medium">{h.customerName}</TableCell>
                <TableCell className="text-right tabular-nums">{h.itemCount}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatPaise(h.totalPaise)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(h.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{memberName.get(h.createdByUserId) ?? "-"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button asChild size="sm" className="h-8 bg-[#1a73e8] text-white hover:bg-[#1557b0]">
                      <Link href={`/sales/new?held=${h._id}`}>
                        <Receipt className="h-3.5 w-3.5" /> Open &amp; generate bill
                      </Link>
                    </Button>
                    {confirmId === h._id ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="font-semibold text-destructive">Delete this bill?</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-8"
                          onClick={async () => {
                            setError(null);
                            setConfirmId(null);
                            try {
                              await removeHeld({ heldBillId: h._id });
                            } catch (e) {
                              setError(getUserErrorMessage(e, "Could not delete the held bill."));
                            }
                          }}
                        >
                          Yes, delete
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setConfirmId(null)}>
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        aria-label={`Delete held bill for ${h.customerName}`}
                        title="Delete this held bill (the customer left)"
                        onClick={() => setConfirmId(h._id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error && <p className="px-5 py-2 text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

// Sale Invoices matching Page 16 of Client PDF
export default function SalesInvoicesPage() {
  const sales = useQuery(api.sales.list);
  const customers = useQuery(api.customers.list);
  const access = useQuery(api.organizations.getMyAccess);
  const [selected, setSelected] = useState<Id<"sales"> | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [timePeriod, setTimePeriod] = useState("all-time");
  const [userFilter, setUserFilter] = useState("all");
  const members = useQuery(api.memberships.listMembers);
  const selectCompany = useMutation(api.organizations.selectCompany);

  function applyPeriod(value: string) {
    setTimePeriod(value);
    if (value === "all-time") {
      setDateFrom("");
      setDateTo("");
    } else if (value !== "custom") {
      const r = periodRange(value as Parameters<typeof periodRange>[0]);
      setDateFrom(localDay(r.startDate));
      setDateTo(localDay(r.endDate));
    }
  }

  const canEdit =
    access?.membership?.role === "owner" || access?.membership?.role === "admin";

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    customers?.forEach((c) => map.set(c._id, c.name));
    return map;
  }, [customers]);

  const filteredSales = useMemo(() => {
    return sales?.filter((row) => {
      const q = search.trim().toLowerCase();
      const customer = customerName.get(row.customerId)?.toLowerCase() ?? "";
      const day = localDay(row.createdAt);
      return (
        (!q || row.invoiceNumber.toLowerCase().includes(q) || customer.includes(q)) &&
        (userFilter === "all" || row.createdByUserId === userFilter) &&
        (!dateFrom || day >= dateFrom) &&
        (!dateTo || day <= dateTo)
      );
    });
  }, [sales, search, dateFrom, dateTo, userFilter, customerName]);

  const selection = useRecordSelection(
    filteredSales?.map((row) => row._id) ?? [],
    `sales:${search}:${dateFrom}:${dateTo}:${userFilter}`,
  );

  const totals = filteredSales?.reduce(
    (sum, row) => ({
      total: sum.total + row.totalPaise,
      paid: sum.paid + row.amountPaidPaise,
    }),
    { total: 0, paid: 0 },
  );

  const totalAmount = totals?.total ?? 0;
  const receivedAmount = totals?.paid ?? 0;
  const balanceAmount = Math.max(0, totalAmount - receivedAmount);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/* Top Header & New Bill Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sale Invoices</h1>
          <p className="text-xs text-muted-foreground">
            Manage sales bills, invoices, received amounts, and outstanding customer balances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sales && (
            <TransactionReportDialog
              label={selection.count ? `Export ${selection.count} selected` : "Export Excel / CSV"}
              filename="sales-invoices"
              rows={
                selection.count
                  ? (filteredSales ?? []).filter((row) => selection.has(row._id))
                  : filteredSales ?? []
              }
              fields={[
                {
                  id: "date",
                  label: "Date",
                  value: (s) => new Date(s.createdAt).toLocaleDateString("en-IN"),
                },
                { id: "invoice", label: "Invoice No.", value: (s) => s.invoiceNumber },
                {
                  id: "party",
                  label: "Party Name",
                  value: (s) => customerName.get(s.customerId) ?? "—",
                },
                { id: "total", label: "Total", value: (s) => formatPaise(s.totalPaise) },
                { id: "paid", label: "Received / Paid", value: (s) => formatPaise(s.amountPaidPaise) },
                {
                  id: "balance",
                  label: "Balance Due",
                  value: (s) => formatPaise(Math.max(0, s.totalPaise - s.amountPaidPaise)),
                },
                { id: "gst", label: "GST Type", value: (s) => (s.isGst ? "GST" : "Non-GST") },
                {
                  id: "payment",
                  label: "Payment Status",
                  value: (s) =>
                    s.amountPaidPaise >= s.totalPaise
                      ? "Paid"
                      : s.amountPaidPaise > 0
                        ? "Partly paid"
                        : "Unpaid",
                },
              ]}
            />
          )}
          <Button
            asChild
            className="bg-[#d93025] hover:bg-[#b3261e] text-white font-medium shadow-sm"
          >
            <Link href="/sales/new">
              <Plus className="h-4 w-4" />
              Add Sale
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter Bar matching Page 16 (Filter by: [This Month] [Date Range] [All Firms]) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-muted-foreground">Filter by :</span>
          <Select value={timePeriod} onValueChange={applyPeriod}>
            <SelectTrigger className="h-8.5 w-40 text-xs" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-time">All Sale Invoices</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this-week">This Week</SelectItem>
              <SelectItem value="this-month">This Month</SelectItem>
              <SelectItem value="last-month">Last Month</SelectItem>
              <SelectItem value="this-quarter">This Quarter</SelectItem>
              <SelectItem value="this-fy">This Financial Year</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setTimePeriod("custom"); }}
              className="h-8.5 text-xs w-32"
            />
            <span className="text-xs text-muted-foreground">To</span>
            <Input
              type="date"
              aria-label="To date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setTimePeriod("custom"); }}
              className="h-8.5 text-xs w-32"
            />
          </div>

          {/* Each firm (company) keeps its own books, so picking another firm switches to it. */}
          {access?.organization && (
            <Select
              value={access.organization._id}
              onValueChange={(id) => id !== access.organization?._id && void selectCompany({ organizationId: id as Id<"organizations"> })}
            >
              <SelectTrigger className="h-8.5 max-w-52 text-xs" aria-label="Firm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {access.companies.map((c) => (
                  <SelectItem key={c.organizationId} value={c.organizationId}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="h-8.5 w-32 text-xs" aria-label="User">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {members?.map((m) => (
                <SelectItem key={m._id} value={m.userId}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search invoice or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8.5 h-8.5 text-xs rounded-lg"
          />
        </div>
      </div>

      {/* 3 Summary Cards matching Page 16 (Total Sales Amount / Received / Balance) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Sales Amount
              </p>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-foreground tabular-nums">
              {formatPaise(totalAmount)}
            </h2>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Received
            </p>
            <h2 className="mt-2 text-2xl font-bold text-emerald-600 tabular-nums">
              {formatPaise(receivedAmount)}
            </h2>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Balance Due
            </p>
            <h2 className="mt-2 text-2xl font-bold text-rose-600 tabular-nums">
              {formatPaise(balanceAmount)}
            </h2>
          </CardContent>
        </Card>
      </div>

      <HeldBillsCard />

      <BulkRecordActions selection={selection} table="sales" />

      {/* Transactions Table matching Page 16 */}
      <Card className="border-border/80 shadow-xs">
        <div className="flex items-center justify-between border-b px-5 py-3.5 bg-muted/10">
          <h3 className="font-semibold text-sm">Transactions</h3>
          <span className="text-xs text-muted-foreground">
            {filteredSales ? `${filteredSales.length} Invoices` : "Loading…"}
          </span>
        </div>
        <CardContent className="p-0">
          {sales === undefined ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Loading invoices…</p>
          ) : filteredSales?.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">No Transaction Found</p>
              <p className="text-xs text-muted-foreground">We could not find any transactions.</p>
              <Button
                asChild
                size="sm"
                className="mt-2 bg-[#d93025] hover:bg-[#b3261e] text-white"
              >
                <Link href="/sales/new">Add Sale</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all"
                        checked={
                          selection.all ? true : selection.partial ? "indeterminate" : false
                        }
                        onCheckedChange={(checked) => selection.selectAll(checked === true)}
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice no</TableHead>
                    <TableHead>Party Name</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Payment Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSales?.map((s) => (
                    <TableRow
                      key={s._id}
                      data-state={selection.has(s._id) ? "selected" : undefined}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setSelected(s._id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${s.invoiceNumber}`}
                          checked={selection.has(s._id)}
                          onCheckedChange={() => selection.toggle(s._id)}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell className="font-semibold text-xs text-primary">
                        {s.invoiceNumber}
                      </TableCell>
                      <TableCell className="font-medium text-xs">
                        {customerName.get(s.customerId) ?? "Cash Customer"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {s.isGst ? "GST Sale" : "Retail Sale"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {s.reportPaymentType || "Cash / Mixed"}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs tabular-nums text-foreground">
                        {formatPaise(s.totalPaise)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-xs tabular-nums">
                        {s.totalPaise - s.amountPaidPaise > 0 ? (
                          <span className="text-rose-600">
                            {formatPaise(s.totalPaise - s.amountPaidPaise)}
                          </span>
                        ) : (
                          <span className="text-emerald-600">₹ 0.00</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title={`View ${s.invoiceNumber}`}
                            onClick={() => setSelected(s._id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                            <Link href={`/sales/invoices/${s._id}/print`} target="_blank">
                              <Printer className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          {canEdit && s.status === "finalized" && (
                            <>
                              <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                                <Link href={`/sales/new?edit=${s._id}`}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              <DeleteDocumentButton
                                compact
                                table="sales"
                                id={s._id}
                                name={s.invoiceNumber}
                              />
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && <SaleDetailDialog saleId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
