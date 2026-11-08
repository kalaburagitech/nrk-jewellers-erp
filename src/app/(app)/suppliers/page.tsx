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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { ImportCsvDialog } from "@/components/import-csv-dialog";
import { supplierFormSchema, type SupplierFormValues } from "@/lib/schemas/party";
import { formatPaise } from "@/lib/money";
import { CustomFieldInputs, CustomFieldSummary } from "@/components/custom-field-inputs";

const SUPPLIER_IMPORT_HEADERS = ["Name", "Phone", "Email", "Address", "GSTIN"];

function ImportSuppliersDialog() {
  const createSupplier = useMutation(api.suppliers.create);
  return (
    <ImportCsvDialog
      title="Import suppliers"
      templateFilename="suppliers-template"
      templateHeaders={SUPPLIER_IMPORT_HEADERS}
      templateExampleRow={["Bharat Bullion Suppliers", "9123456780", "", "Station Road, Kalaburagi", ""]}
      rowLabel={(r) => r["Name"] ?? ""}
      onImportRow={async (r) => {
        const name = r["Name"]?.trim();
        if (!name) throw new Error("Name is required");
        await createSupplier({
          name,
          phone: r["Phone"] || undefined,
          email: r["Email"] || undefined,
          address: r["Address"] || undefined,
          gstin: r["GSTIN"] || undefined,
        });
      }}
    />
  );
}

function CreateSupplierDialog() {
  const createSupplier = useMutation(api.suppliers.create);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: { name: "", phone: "", email: "", address: "", gstin: "" },
  });

  async function onSubmit(values: SupplierFormValues) {
    setServerError(null);
    try {
      await createSupplier({
        name: values.name,
        phone: values.phone || undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        gstin: values.gstin || undefined,
        customFields,
      });
      setOpen(false);
      form.reset();
      setCustomFields({});
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not save this supplier. Please try again."));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) { form.reset(); setCustomFields({}); }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Add Supplier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
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
                    <Input {...field} placeholder="Supplier name" />
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
            </div>
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
            <CustomFieldInputs entity="supplier" values={customFields} onChange={setCustomFields} />
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save supplier"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function SuppliersPage() {
  const router = useRouter();
  const suppliers = useQuery(api.suppliers.listWithOutstanding);
  const customFieldDefinitions = useQuery(api.customFields.getDefinitions);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!suppliers) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.phone?.toLowerCase().includes(q),
    );
  }, [suppliers, search]);

  const selection = useRecordSelection(filtered?.map(row => row._id) ?? [], `suppliers:${search}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Supplier Directory</h1>
          <p className="text-sm text-muted-foreground">{suppliers?.length ?? 0} suppliers</p>
        </div>
        <div className="flex gap-2">
          <ImportSuppliersDialog />
          <CreateSupplierDialog />
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

      <BulkRecordActions selection={selection} table="suppliers" />

      <Card>
        <CardContent className="p-0">
          {filtered === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Truck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {suppliers?.length === 0 ? "No suppliers yet." : "No suppliers match your search."}
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
                    <TableHead>GSTIN</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow
                      key={s._id} data-state={selection.has(s._id) ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => router.push(`/suppliers/history?supplierId=${s._id}`)}
                    >
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox aria-label={`Select ${s.name}`} checked={selection.has(s._id)} onCheckedChange={() => selection.toggle(s._id)} /></TableCell>
                      <TableCell className="font-medium"><div className="flex items-center justify-between gap-3"><div>{s.name}<CustomFieldSummary fields={customFieldDefinitions?.filter(field => field.entity === "supplier")} values={s.customFields} /></div><DeleteRecordButton table="suppliers" id={s._id} name={s.name} /></div></TableCell>
                      <TableCell>{s.phone ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.gstin ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatPaise(s.outstandingPaise)}</TableCell>
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
