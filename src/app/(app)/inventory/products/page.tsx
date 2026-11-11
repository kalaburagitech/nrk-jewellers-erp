"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { DeleteRecordButton } from "@/components/delete-record-button";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Gem, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportCsvDialog } from "@/components/import-csv-dialog";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { CustomFieldInputs, CustomFieldSummary } from "@/components/custom-field-inputs";

const UNITS = [
  { value: "gram", label: "Gram" },
  { value: "kilogram", label: "Kilogram" },
  { value: "piece", label: "Piece" },
  { value: "carat", label: "Carat" },
] as const;

const PRODUCT_IMPORT_HEADERS = ["Name", "SKU", "Unit (gram/kilogram/piece/carat)", "Purity Label", "HSN Code", "Reorder Level (g)"];

function ImportProductsDialog({ purities }: { purities: Doc<"metalPurities">[] | undefined }) {
  const createProduct = useMutation(api.products.create);
  return (
    <ImportCsvDialog
      title="Import products"
      templateFilename="products-template"
      templateHeaders={PRODUCT_IMPORT_HEADERS}
      templateExampleRow={["Gold Chain 20g", "", "gram", "22K", "", ""]}
      rowLabel={(r) => r["Name"] ?? ""}
      onImportRow={async (r) => {
        const name = r["Name"]?.trim();
        if (!name) throw new Error("Name is required");
        const rawUnit = r["Unit (gram/kilogram/piece/carat)"]?.trim().toLowerCase();
        const unit = UNITS.find((u) => u.value === rawUnit)?.value ?? "gram";
        const purityLabelInput = r["Purity Label"]?.trim().toLowerCase();
        const metalPurityId = purityLabelInput
          ? purities?.find((p) => p.label.toLowerCase() === purityLabelInput)?._id
          : undefined;
        if (purityLabelInput && !metalPurityId) throw new Error(`No purity named "${r["Purity Label"]}" — check Settings > Metal Purity Configuration`);
        const reorderLevelGrams = r["Reorder Level (g)"]?.trim();
        await createProduct({
          name,
          sku: r["SKU"] || undefined,
          unit,
          metalPurityId,
          hsnCode: r["HSN Code"] || undefined,
          reorderLevelMg: reorderLevelGrams ? Math.round(Number(reorderLevelGrams) * 1000) : undefined,
        });
      }}
    />
  );
}

const NONE = "__none__";

function CreateProductDialog() {
  const createProduct = useMutation(api.products.create);
  const groups = useQuery(api.stockGroups.list);
  const categories = useQuery(api.stockCategories.list);
  const purities = useQuery(api.metalPurities.list);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]["value"]>("gram");
  const [stockGroupId, setStockGroupId] = useState<string>(NONE);
  const [stockCategoryId, setStockCategoryId] = useState<string>(NONE);
  const [metalPurityId, setMetalPurityId] = useState<string>(NONE);
  const [hsnCode, setHsnCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});

  function reset() {
    setName("");
    setDescription("");
    setSku("");
    setUnit("gram");
    setStockGroupId(NONE);
    setStockCategoryId(NONE);
    setMetalPurityId(NONE);
    setHsnCode("");
    setError(null);
    setCustomFields({});
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createProduct({
        name,
        description: description.trim() || undefined,
        sku: sku || undefined,
        unit,
        stockGroupId: stockGroupId === NONE ? undefined : (stockGroupId as Id<"stockGroups">),
        stockCategoryId: stockCategoryId === NONE ? undefined : (stockCategoryId as Id<"stockCategories">),
        metalPurityId: metalPurityId === NONE ? undefined : (metalPurityId as Id<"metalPurities">),
        hsnCode: hsnCode || undefined,
        customFields,
      });
      reset();
      setOpen(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save these changes. Check your access and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_0.8fr]">
            <div className="grid gap-2">
              <Label htmlFor="item-name">Item name</Label>
              <Input id="item-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold Chain 22K" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-hsn">Item HSN</Label>
              <Input id="item-hsn" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="Enter HSN code" />
            </div>
            <div className="grid gap-2">
              <Label>Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="item-code">Item code</Label>
              <Input id="item-code" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional code / SKU" />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={stockCategoryId} onValueChange={setStockCategoryId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose category" /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>None</SelectItem>{categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Stock group</Label>
              <Select value={stockGroupId} onValueChange={setStockGroupId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {groups?.map((g) => (
                    <SelectItem key={g._id} value={g._id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Stock category</Label>
              <Select value={stockCategoryId} onValueChange={setStockCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {categories?.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Metal purity</Label>
              <Select value={metalPurityId} onValueChange={setMetalPurityId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {purities?.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-description">Description</Label>
              <Textarea id="item-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Item details, design, or notes" rows={3} />
            </div>
          </div>
          <CustomFieldInputs entity="product" values={customFields} onChange={setCustomFields} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? "Saving…" : "Save product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalPurities.list);
  const customFieldDefinitions = useQuery(api.customFields.getDefinitions);
  const [search, setSearch] = useState("");

  const purityLabel = useMemo(() => {
    const map = new Map<string, string>();
    purities?.forEach((p) => map.set(p._id, p.label));
    return map;
  }, [purities]);

  const filtered = useMemo(() => {
    if (!products) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        Object.values(p.customFields ?? {}).some((value) =>
          value.toLowerCase().includes(q),
        ),
    );
  }, [products, search]);

  const selection = useRecordSelection(filtered?.map(row => row._id) ?? [], `products:${search}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products / Ornaments</h1>
          <p className="text-sm text-muted-foreground">{products?.length ?? 0} products</p>
        </div>
        <div className="flex gap-2">
          <ImportProductsDialog purities={purities} />
          <CreateProductDialog />
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <BulkRecordActions selection={selection} table="products" />

      <Card>
        <CardContent className="p-0">
          {filtered === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Gem className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {products?.length === 0 ? "No products yet." : "No products match your search."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Purity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p._id} data-state={selection.has(p._id) ? "selected" : undefined}>
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox aria-label={`Select ${p.name}`} checked={selection.has(p._id)} onCheckedChange={() => selection.toggle(p._id)} /></TableCell>
                      <TableCell className="font-medium"><div className="flex items-center justify-between gap-3"><div>{p.name}{p.description && <p className="mt-0.5 max-w-lg truncate text-xs font-normal text-muted-foreground">{p.description}</p>}<CustomFieldSummary fields={customFieldDefinitions?.filter(field => field.entity === "product")} values={p.customFields} /></div><DeleteRecordButton table="products" id={p._id} name={p.name} /></div></TableCell>
                      <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {p.unit}
                        </Badge>
                      </TableCell>
                      <TableCell>{p.metalPurityId ? purityLabel.get(p.metalPurityId) ?? "—" : "—"}</TableCell>
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
