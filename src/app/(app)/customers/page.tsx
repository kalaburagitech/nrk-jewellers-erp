"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { DeleteRecordButton } from "@/components/delete-record-button";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Users } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ImportCsvDialog } from "@/components/import-csv-dialog";
import { customerFormSchema, GST_TYPE_OPTIONS, type CustomerFormValues } from "@/lib/schemas/party";
import { rupeesToPaise, paiseToRupeesInput } from "@/lib/money";
import { CustomFieldInputs, CustomFieldSummary } from "@/components/custom-field-inputs";
import { Pencil } from "lucide-react";
import type { Doc } from "../../../../convex/_generated/dataModel";

const CUSTOMER_IMPORT_HEADERS = ["Name", "Phone", "Email", "Address", "GSTIN", "Type (cash/regular/credit)", "Credit Limit", "Notes"];

function ImportCustomersDialog() {
  const createCustomer = useMutation(api.customers.create);
  return (
    <ImportCsvDialog
      title="Import customers"
      templateFilename="customers-template"
      templateHeaders={CUSTOMER_IMPORT_HEADERS}
      templateExampleRow={["Ramesh Kumar", "9876543210", "", "MG Road, Kalaburagi", "", "regular", "", ""]}
      rowLabel={(r) => r["Name"] ?? ""}
      onImportRow={async (r) => {
        const name = r["Name"]?.trim();
        if (!name) throw new Error("Name is required");
        const rawType = r["Type (cash/regular/credit)"]?.trim().toLowerCase();
        const customerType = rawType === "cash" || rawType === "credit" ? rawType : "regular";
        await createCustomer({
          name,
          phone: r["Phone"] || undefined,
          email: r["Email"] || undefined,
          address: r["Address"] || undefined,
          gstin: r["GSTIN"] || undefined,
          customerType,
          creditLimitPaise: r["Credit Limit"] ? (rupeesToPaise(r["Credit Limit"]) ?? undefined) : undefined,
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

function CustomerFormDialog({ customer }: { customer?: Doc<"customers"> }) {
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, string>>(customer?.customFields ?? {});
  const isEdit = !!customer;

  const defaultValues: CustomerFormValues = {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    gstin: customer?.gstin ?? "",
    gstType: customer?.gstType ?? "unregistered_consumer",
    state: customer?.state ?? "",
    customerType: customer?.customerType ?? "regular",
    creditLimitRupees: customer?.creditLimitPaise !== undefined ? paiseToRupeesInput(customer.creditLimitPaise) : "",
    dueDate: customer?.dueDateMs ? new Date(customer.dueDateMs).toISOString().slice(0, 10) : "",
    openingBalanceRupees: customer?.openingBalancePaise ? paiseToRupeesInput(customer.openingBalancePaise) : "",
    openingBalanceDate: customer?.openingBalanceDateMs
      ? new Date(customer.openingBalanceDateMs).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    notes: customer?.notes ?? "",
  };

  const form = useForm<CustomerFormValues>({ resolver: zodResolver(customerFormSchema), defaultValues });
  const customerType = useWatch({ control: form.control, name: "customerType" });

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
        creditLimitPaise: values.creditLimitRupees ? (rupeesToPaise(values.creditLimitRupees) ?? undefined) : undefined,
        dueDateMs: values.dueDate ? new Date(values.dueDate).getTime() : undefined,
        openingBalancePaise: values.openingBalanceRupees ? (rupeesToPaise(values.openingBalanceRupees) ?? undefined) : undefined,
        openingBalanceDateMs: values.openingBalanceDate ? new Date(values.openingBalanceDate).getTime() : undefined,
        notes: values.notes || undefined,
        customFields,
      };
      if (isEdit) {
        await updateCustomer({ id: customer._id, ...payload });
      } else {
        await createCustomer(payload);
      }
      setOpen(false);
      if (!isEdit) { form.reset(); setCustomFields({}); }
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not save this customer. Please try again."));
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
        {isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit customer">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" />
            Add Customer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit customer" : "Add customer"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Customer name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="98765 43210" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="optional" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="gstin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GSTIN</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="optional" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="optional" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="gstType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GST type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GST_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customerType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="regular">Regular</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {customerType === "credit" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="creditLimitRupees"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit limit (₹)</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" placeholder="0.00" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment due date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            {/* ponytail: opening balance is create-only — editing it post-transactions would silently diverge from the posted ledger; add a guarded re-opening-balance flow if that's ever needed */}
            {!isEdit && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="openingBalanceRupees"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opening balance (₹)</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" placeholder="0.00" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="openingBalanceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>As of date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} placeholder="optional" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <CustomFieldInputs entity="customer" values={customFields} onChange={setCustomFields} />
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save customer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomersPage() {
  const router = useRouter();
  const customers = useQuery(api.customers.list);
  const customFieldDefinitions = useQuery(api.customFields.getDefinitions);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!customers) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q),
    );
  }, [customers, search]);

  const selection = useRecordSelection(filtered?.map(row => row._id) ?? [], `customers:${search}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Directory</h1>
          <p className="text-sm text-muted-foreground">{customers?.length ?? 0} customers</p>
        </div>
        <div className="flex gap-2">
          <ImportCustomersDialog />
          <CustomerFormDialog />
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <BulkRecordActions selection={selection} table="customers" />

      <Card>
        <CardContent className="p-0">
          {filtered === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {customers?.length === 0 ? "No customers yet." : "No customers match your search."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>GSTIN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow
                      key={c._id} data-state={selection.has(c._id) ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => router.push(`/customers/ledgers?customerId=${c._id}`)}
                    >
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox aria-label={`Select ${c.name}`} checked={selection.has(c._id)} onCheckedChange={() => selection.toggle(c._id)} /></TableCell>
                      <TableCell className="font-medium"><div className="flex items-center justify-between gap-3"><div><span>{c.name}</span><CustomFieldSummary fields={customFieldDefinitions?.filter(field => field.entity === "customer")} values={c.customFields} /></div><div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}><CustomerFormDialog customer={c} /><DeleteRecordButton table="customers" id={c._id} name={c.name} /></div></div></TableCell>
                      <TableCell>{c.phone ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{CUSTOMER_TYPE_LABEL[c.customerType]}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.gstin ?? "—"}</TableCell>
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
