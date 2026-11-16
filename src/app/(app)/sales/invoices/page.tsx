"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  BarChart3,
  ChevronDown,
  EllipsisVertical,
  Eye,
  Forward,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Search,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChipMenu, FirmChip, ListHeader, PeriodChip, rupeeShort, useListPeriod, useUserOptions } from "@/components/vyapar/list-kit";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
                    {formatPaise(i.ratePerGramPaise)}/g
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

// Sale Invoices — laid out like Vyapar desktop.
export default function SalesInvoicesPage() {
  const sales = useQuery(api.sales.list);
  const customers = useQuery(api.customers.list);
  const access = useQuery(api.organizations.getMyAccess);
  const router = useRouter();
  const [selected, setSelected] = useState<Id<"sales"> | null>(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [status, setStatus] = useState("all");
  const [user, setUser] = useState("");
  const period = useListPeriod("all");
  const userOptions = useUserOptions();

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
      const balance = row.totalPaise - row.amountPaidPaise;
      return (
        (!q || row.invoiceNumber.toLowerCase().includes(q) || customer.includes(q)) &&
        period.contains(row.createdAt) &&
        (!user || row.createdByUserId === user) &&
        (status === "all" ||
          (status === "paid" && balance <= 0) ||
          (status === "unpaid" && row.amountPaidPaise === 0 && balance > 0) ||
          (status === "partial" && row.amountPaidPaise > 0 && balance > 0) ||
          (status === "gst" && row.isGst) ||
          (status === "daily" && !row.isGst))
      );
    });
  }, [sales, search, customerName, period, user, status]);

  const selection = useRecordSelection(
    filteredSales?.map((row) => row._id) ?? [],
    `sales:${search}:${status}:${user}:${period.preset}`,
  );

  const totals = filteredSales?.reduce(
    (sum, row) => ({ total: sum.total + row.totalPaise, paid: sum.paid + row.amountPaidPaise }),
    { total: 0, paid: 0 },
  );
  const totalAmount = totals?.total ?? 0;
  const receivedAmount = totals?.paid ?? 0;
  const balanceAmount = Math.max(0, totalAmount - receivedAmount);
  const exportRowsList = selection.count
    ? (filteredSales ?? []).filter((row) => selection.has(row._id))
    : filteredSales ?? [];

  return (
    <div className="flex flex-col gap-2">
      <ListHeader
        title={
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 outline-none">
              Sale Invoices <ChevronDown className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {[
                ["Sale Invoices", "/sales/invoices"],
                ["Estimate/ Quotation", "/sales/quotations"],
                ["Proforma Invoice", "/sales/proforma"],
                ["Sale Order", "/sales/orders"],
                ["Delivery Challan", "/sales/challans"],
                ["Sale Return", "/sales/returns"],
                ["Credit Note", "/sales/credit-notes"],
              ].map(([label, href]) => (
                <DropdownMenuItem key={href} onSelect={() => router.push(href)}>{label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {canEdit && (
          <Link
            href="/sales/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-sale px-5 text-[15px] font-semibold text-white shadow-sm hover:bg-sale/90"
          >
            <Plus className="h-4 w-4" />
            Add Sale
          </Link>
        )}
        <Link href="/settings/general?tab=transaction" aria-label="Transaction settings" title="Transaction settings" className="text-muted-foreground hover:text-foreground">
          <Settings className="h-5 w-5" />
        </Link>
      </ListHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-md bg-card px-4 py-3">
        <span className="mr-1 text-[15px] font-medium">Filter by :</span>
        <ChipMenu
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All Sale Invoices" },
            { value: "paid", label: "Paid" },
            { value: "unpaid", label: "Unpaid" },
            { value: "partial", label: "Partially Paid" },
            { value: "gst", label: "GST Bills" },
            { value: "daily", label: "Daily Sales Bills" },
          ]}
        />
        <PeriodChip state={period} />
        <FirmChip />
        <ChipMenu value={user} onChange={setUser} options={userOptions} />
      </div>

      <div className="rounded-md bg-card px-4 py-3">
        <div className="inline-flex min-w-72 flex-col rounded-lg border border-[#dcd3f3] bg-[#f6f3fe] px-4 py-3 dark:border-border dark:bg-accent">
          <span className="text-[15px] text-muted-foreground">Total Sales Amount</span>
          <span className="text-2xl font-semibold tabular-nums">{rupeeShort(totalAmount)}</span>
          <span className="mt-2 text-[15px] text-muted-foreground">
            Received: <b className="font-semibold text-foreground">{rupeeShort(receivedAmount)}</b>
            <span className="mx-2 text-border">|</span>
            Balance: <b className="font-semibold text-foreground">{rupeeShort(balanceAmount)}</b>
          </span>
        </div>
      </div>

      <BulkRecordActions selection={selection} table="sales" />

      <div className="rounded-md bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h3 className="text-lg font-semibold">Transactions</h3>
          <div className="flex items-center gap-3">
            {showSearch && (
              <Input
                autoFocus
                placeholder="Search invoice or party"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-56 text-sm"
              />
            )}
            <button type="button" aria-label="Search transactions" title="Search" onClick={() => setShowSearch((v) => !v)} className="text-foreground/80 hover:text-primary">
              <Search className="h-5 w-5" />
            </button>
            <Link href="/reports/sale" aria-label="Sale report" title="Sale report" className="text-foreground/80 hover:text-primary">
              <BarChart3 className="h-5 w-5" />
            </Link>
            {sales && (
              <TransactionReportDialog
                label="Export to Excel"
                variant="xls"
                filename="sales-invoices"
                rows={exportRowsList}
                fields={[
                  { id: "date", label: "Date", value: (s) => new Date(s.createdAt).toLocaleDateString("en-IN") },
                  { id: "invoice", label: "Invoice No.", value: (s) => s.invoiceNumber },
                  { id: "party", label: "Party Name", value: (s) => customerName.get(s.customerId) ?? "—" },
                  { id: "total", label: "Total", value: (s) => formatPaise(s.totalPaise) },
                  { id: "paid", label: "Received / Paid", value: (s) => formatPaise(s.amountPaidPaise) },
                  { id: "balance", label: "Balance Due", value: (s) => formatPaise(Math.max(0, s.totalPaise - s.amountPaidPaise)) },
                  { id: "gst", label: "GST Type", value: (s) => (s.isGst ? "GST" : "Non-GST") },
                  { id: "payment", label: "Payment Type", value: (s) => s.reportPaymentType },
                ]}
              />
            )}
            <button type="button" aria-label="Print list" title="Print" onClick={() => window.print()} className="text-foreground/80 hover:text-primary">
              <Printer className="h-5 w-5" />
            </button>
          </div>
        </div>
        {sales === undefined ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading invoices…</p>
        ) : filteredSales?.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Receipt className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">No Transaction Found</p>
            <p className="text-xs text-muted-foreground">We could not find any transactions.</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all"
                      checked={selection.all ? true : selection.partial ? "indeterminate" : false}
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
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales?.map((s) => {
                  const balance = Math.max(0, s.totalPaise - s.amountPaidPaise);
                  return (
                    <TableRow
                      key={s._id}
                      data-state={selection.has(s._id) ? "selected" : undefined}
                      className="h-14 cursor-pointer text-[15px]"
                      onClick={() => setSelected(s._id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${s.invoiceNumber}`}
                          checked={selection.has(s._id)}
                          onCheckedChange={() => selection.toggle(s._id)}
                        />
                      </TableCell>
                      <TableCell>{new Date(s.createdAt).toLocaleDateString("en-GB")}</TableCell>
                      <TableCell className="text-right">{s.invoiceNumber}</TableCell>
                      <TableCell>{customerName.get(s.customerId) ?? "Cash Sale"}</TableCell>
                      <TableCell>{s.isGst ? "Sale (GST)" : "Sale"}</TableCell>
                      <TableCell className="capitalize">{s.reportPaymentType === "upi" ? "G-Pay/Phone" : s.reportPaymentType}</TableCell>
                      <TableCell className="text-right">{rupeeShort(s.totalPaise)}</TableCell>
                      <TableCell className={balance > 0 ? "text-right text-destructive" : "text-right"}>{rupeeShort(balance)}</TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center gap-2.5">
                          <Link href={`/sales/invoices/${s._id}/print`} target="_blank" aria-label={`Print ${s.invoiceNumber}`} title="Print" className="text-foreground/80 hover:text-primary">
                            <Printer className="h-5 w-5" />
                          </Link>
                          <Link href={`/sales/invoices/${s._id}/print?autoShare=1`} target="_blank" aria-label={`Share ${s.invoiceNumber}`} title="Share" className="text-foreground/80 hover:text-primary">
                            <Forward className="h-5 w-5" />
                          </Link>
                          <DropdownMenu>
                            <DropdownMenuTrigger aria-label={`More actions for ${s.invoiceNumber}`} className="rounded p-0.5 text-foreground/80 outline-none hover:bg-muted">
                              <EllipsisVertical className="h-5 w-5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setSelected(s._id)}><Eye className="h-4 w-4" />View items</DropdownMenuItem>
                              {canEdit && s.status === "finalized" && (
                                <DropdownMenuItem onSelect={() => router.push(`/sales/new?edit=${s._id}`)}><Pencil className="h-4 w-4" />Edit</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {canEdit && s.status === "finalized" && (
                            <DeleteDocumentButton compact table="sales" id={s._id} name={s.invoiceNumber} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {selected && <SaleDetailDialog saleId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
