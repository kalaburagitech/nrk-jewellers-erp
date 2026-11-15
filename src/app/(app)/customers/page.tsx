"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Search,
  Users,
  Pencil,
  Phone,
  MessageCircle,
  Receipt,
  Printer,
  ChevronRight,
  SlidersHorizontal,
  ArrowDownRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ImportCsvDialog } from "@/components/import-csv-dialog";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { customerFormSchema, GST_TYPE_OPTIONS, type CustomerFormValues } from "@/lib/schemas/party";
import { rupeesToPaise, paiseToRupeesInput, formatPaise } from "@/lib/money";
import { CustomFieldInputs, CustomFieldSummary } from "@/components/custom-field-inputs";
import { getUserErrorMessage } from "@/lib/user-error";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const CUSTOMER_IMPORT_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "Address",
  "GSTIN",
  "Type (cash/regular/credit)",
  "Credit Limit",
  "Notes",
];

function ImportCustomersDialog() {
  const createCustomer = useMutation(api.customers.create);
  return (
    <ImportCsvDialog
      title="Import customers"
      templateFilename="customers-template"
      templateHeaders={CUSTOMER_IMPORT_HEADERS}
      templateExampleRow={[
        "Ramesh Kumar",
        "9876543210",
        "",
        "MG Road, Kalaburagi",
        "",
        "regular",
        "",
        "",
      ]}
      rowLabel={(r) => r["Name"] ?? ""}
      onImportRow={async (r) => {
        const name = r["Name"]?.trim();
        if (!name) throw new Error("Name is required");
        const rawType = r["Type (cash/regular/credit)"]?.trim().toLowerCase();
        const customerType =
          rawType === "cash" || rawType === "credit" ? rawType : "regular";
        await createCustomer({
          name,
          phone: r["Phone"] || undefined,
          email: r["Email"] || undefined,
          address: r["Address"] || undefined,
          gstin: r["GSTIN"] || undefined,
          customerType,
          creditLimitPaise: r["Credit Limit"]
            ? rupeesToPaise(r["Credit Limit"]) ?? undefined
            : undefined,
          notes: r["Notes"] || undefined,
        });
      }}
    />
  );
}

const CUSTOMER_TYPE_LABEL: Record<string, string> = {
  cash: "Cash",
  regular: "Regular",
  credit: "Credit",
};

// Add / Edit Party Dialog Matching Vyapar Page 9 Layout
function CustomerFormDialog({
  customer,
  trigger,
}: {
  customer?: Doc<"customers">;
  trigger?: React.ReactNode;
}) {
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, string>>(
    customer?.customFields ?? {},
  );
  const isEdit = !!customer;

  const defaultValues: CustomerFormValues = {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    gstin: customer?.gstin ?? "",
    gstType: customer?.gstType ?? "unregistered_consumer",
    state: customer?.state ?? "Karnataka",
    customerType: customer?.customerType ?? "regular",
    creditLimitRupees:
      customer?.creditLimitPaise !== undefined
        ? paiseToRupeesInput(customer.creditLimitPaise)
        : "",
    dueDate: customer?.dueDateMs
      ? new Date(customer.dueDateMs).toISOString().slice(0, 10)
      : "",
    openingBalanceRupees: customer?.openingBalancePaise
      ? paiseToRupeesInput(customer.openingBalancePaise)
      : "",
    openingBalanceDate: customer?.openingBalanceDateMs
      ? new Date(customer.openingBalanceDateMs).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    notes: customer?.notes ?? "",
  };

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues,
  });

  function resetForm() {
    form.reset(defaultValues);
    setCustomFields(customer?.customFields ?? {});
  }

  async function onSubmit(values: CustomerFormValues) {
    setServerError(null);
    try {
      const payload = {
        name: values.name,
        phone: values.phone || undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        gstin: values.gstin || undefined,
        gstType: (values.gstType || undefined) as Doc<"customers">["gstType"],
        state: values.state || undefined,
        customerType: values.customerType,
        creditLimitPaise: values.creditLimitRupees
          ? rupeesToPaise(values.creditLimitRupees) ?? undefined
          : undefined,
        dueDateMs: values.dueDate ? new Date(values.dueDate).getTime() : undefined,
        openingBalancePaise: values.openingBalanceRupees
          ? rupeesToPaise(values.openingBalanceRupees) ?? undefined
          : undefined,
        openingBalanceDateMs: values.openingBalanceDate
          ? new Date(values.openingBalanceDate).getTime()
          : undefined,
        notes: values.notes || undefined,
        customFields,
      };
      if (isEdit) {
        await updateCustomer({ id: customer._id, ...payload });
      } else {
        await createCustomer(payload);
      }
      setOpen(false);
      if (!isEdit) {
        form.reset();
        setCustomFields({});
      }
    } catch (e) {
      setServerError(
        getUserErrorMessage(e, "Could not save this customer. Please try again."),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        {trigger ? (
          trigger
        ) : isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit customer">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="bg-[#d93025] hover:bg-[#b3261e] text-white font-medium shadow-sm">
            <Plus className="h-4 w-4" />
            Add Party
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {isEdit ? "Edit Party" : "Add Party"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            {/* Top Primary Fields (Page 9) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="sm:col-span-1">
                    <FormLabel className="text-xs font-semibold">Party Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Party Name" className="h-9 text-sm" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gstin"
                render={({ field }) => (
                  <FormItem className="sm:col-span-1">
                    <FormLabel className="text-xs font-semibold">GSTIN</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="GSTIN" className="h-9 text-sm uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem className="sm:col-span-1">
                    <FormLabel className="text-xs font-semibold">Phone Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Phone Number" className="h-9 text-sm" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Vyapar Tabs: GST & Address / Credit & Balance / Additional Fields (Page 9) */}
            <Tabs defaultValue="gst" className="w-full">
              <TabsList className="grid w-full grid-cols-3 h-9">
                <TabsTrigger value="gst" className="text-xs">
                  GST & Address
                </TabsTrigger>
                <TabsTrigger value="credit" className="text-xs">
                  Credit & Balance
                </TabsTrigger>
                <TabsTrigger value="additional" className="text-xs">
                  Additional Fields
                </TabsTrigger>
              </TabsList>

              <TabsContent value="gst" className="space-y-3 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="gstType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">GST Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {GST_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">State</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Karnataka" className="h-9 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Email ID</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="email@domain.com" className="h-9 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Billing Address</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Billing address details"
                          rows={2}
                          className="text-sm resize-none"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="credit" className="space-y-3 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="openingBalanceRupees"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Opening Balance (₹)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="0.00" className="h-9 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="creditLimitRupees"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Credit Limit (₹)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Optional" className="h-9 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Internal Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Notes about this customer"
                          rows={2}
                          className="text-sm resize-none"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="additional" className="space-y-3 pt-3">
                <CustomFieldInputs
                  entity="customer"
                  values={customFields}
                  onChange={setCustomFields}
                />
              </TabsContent>
            </Tabs>

            {serverError && <p className="text-xs text-destructive font-medium">{serverError}</p>}

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className="h-9"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white"
              >
                {form.formState.isSubmitting ? "Saving…" : "Save Party"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Party Transactions List Component
function PartyTransactionsView({ customer }: { customer: Doc<"customers"> }) {
  const router = useRouter();
  const sales = useQuery(api.sales.listByCustomer, { customerId: customer._id });

  const cleanPhone = customer.phone?.replace(/\D/g, "");

  return (
    <div className="space-y-5">
      {/* Selected Party Header with Actions (Page 8) */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">{customer.name}</h2>
            <Badge variant="outline" className="text-xs capitalize">
              {CUSTOMER_TYPE_LABEL[customer.customerType] || "Regular"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {customer.phone && (
              <span className="flex items-center gap-1 font-mono">
                <Phone className="h-3 w-3" />
                {customer.phone}
              </span>
            )}
            {customer.gstin && <span>GSTIN: {customer.gstin}</span>}
            {customer.address && <span>{customer.address}</span>}
          </div>
        </div>

        {/* Action icons: WhatsApp, Call, Edit, Add Sale */}
        <div className="flex flex-wrap items-center gap-2">
          {cleanPhone && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
            >
              <a
                href={`https://wa.me/91${cleanPhone}?text=Hello%20${encodeURIComponent(customer.name)}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </a>
            </Button>
          )}

          <CustomerFormDialog
            customer={customer}
            trigger={
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            }
          />

          <Button
            asChild
            size="sm"
            className="h-9 bg-[#d93025] hover:bg-[#b3261e] text-white font-medium"
          >
            <Link href={`/sales/new?customerId=${customer._id}`}>
              <Plus className="h-3.5 w-3.5" />
              Add Sale
            </Link>
          </Button>

          <DeleteRecordButton table="customers" id={customer._id} name={customer.name} />
        </div>
      </div>

      {/* Transactions Subheader and Table (Page 8) */}
      <Card className="border-border/80 shadow-xs">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h3 className="font-semibold text-sm">Transactions</h3>
          <span className="text-xs text-muted-foreground">
            {sales ? `${sales.length} transactions` : "Loading…"}
          </span>
        </div>
        <CardContent className="p-0">
          {sales === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading transactions…</p>
          ) : sales.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">No Transactions Found</p>
              <p className="text-xs text-muted-foreground">
                No invoices recorded for {customer.name} yet.
              </p>
              <Button
                asChild
                size="sm"
                className="mt-1 bg-[#d93025] hover:bg-[#b3261e] text-white"
              >
                <Link href={`/sales/new?customerId=${customer._id}`}>Create First Invoice</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <TableHead className="py-2.5">Bill No.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Print</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {sales.map((sale) => (
                    <TableRow
                      key={sale._id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => router.push(`/sales/invoices/${sale._id}/print`)}
                    >
                      <TableCell className="text-xs">
                        <span className="font-semibold text-primary">{sale.invoiceNumber}</span>
                        <Badge variant="outline" className="ml-2 text-[10px] font-normal">Sale</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(sale.createdAt).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right font-medium text-xs tabular-nums">
                        {formatPaise(sale.totalPaise)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs tabular-nums">
                        {sale.amountPaidPaise >= sale.totalPaise ? (
                          <span className="text-emerald-600">₹ 0.00</span>
                        ) : (
                          <span className="text-rose-600">
                            {formatPaise(sale.totalPaise - sale.amountPaidPaise)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                          <Link href={`/sales/invoices/${sale._id}/print`} target="_blank" aria-label={`Print bill ${sale.invoiceNumber}`}>
                            <Printer className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Print</span>
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Main 2-Pane Parties / Customers Screen (Page 8 Layout)
export default function CustomersPage() {
  const customers = useQuery(api.customers.list);
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<Id<"customers"> | null>(null);

  const filtered = useMemo(() => {
    if (!customers) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)),
    );
  }, [customers, search]);

  // Set default selected customer if none selected
  const activeCustomer = useMemo(() => {
    if (!filtered || filtered.length === 0) return null;
    if (selectedCustomerId) {
      const match = filtered.find((c) => c._id === selectedCustomerId);
      if (match) return match;
    }
    return filtered[0];
  }, [filtered, selectedCustomerId]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Parties</h1>
          <p className="text-xs text-muted-foreground">
            Manage customer directories, addresses, GST details, and transaction ledgers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportCustomersDialog />
          <CustomerFormDialog />
        </div>
      </div>

      {/* 2-Pane Master-Detail Split Layout (Page 8) */}
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] lg:grid-cols-[380px_1fr] gap-5 items-start">
        {/* Left Pane: Searchable Party List */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
          <div className="p-3 border-b bg-muted/20">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search Party Name"
                placeholder="Search Party Name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8.5 h-9 text-xs rounded-lg"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Party Name</span>
              <span>Amount</span>
            </div>
          </div>

          <div className="max-h-[650px] overflow-y-auto divide-y divide-border/60">
            {filtered === undefined ? (
              <p className="p-5 text-xs text-muted-foreground text-center">Loading parties…</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <Users className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
                <p>No parties found</p>
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = activeCustomer?._id === c._id;
                const initials = c.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join("")
                  .toUpperCase();
                return (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() => setSelectedCustomerId(c._id)}
                    className={`w-full p-3 text-left transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-muted font-bold text-xs flex items-center justify-center shrink-0 text-muted-foreground">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-xs sm:text-sm truncate">{c.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {c.phone || "No phone"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-semibold tabular-nums text-foreground">
                        ₹ 0.00
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Selected Party Details & Transactions (Page 8) */}
        <div className="min-w-0">
          {activeCustomer ? (
            <PartyTransactionsView customer={activeCustomer} />
          ) : (
            <Card className="p-12 text-center text-muted-foreground">
              <Users className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">Select a party to view details and transactions</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
