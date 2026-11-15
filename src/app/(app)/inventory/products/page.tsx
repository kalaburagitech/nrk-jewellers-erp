"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Gem,
  Plus,
  Search,
  Pencil,
  Boxes,
  Sliders,
  Printer,
  ChevronRight,
  ExternalLink,
  Layers,
  Sparkles,
  Barcode,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportCsvDialog } from "@/components/import-csv-dialog";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { CustomFieldInputs, CustomFieldSummary } from "@/components/custom-field-inputs";
import { getUserErrorMessage } from "@/lib/user-error";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const UNITS = [
  { value: "gram", label: "Gram" },
  { value: "kilogram", label: "Kilogram" },
  { value: "piece", label: "Piece" },
  { value: "carat", label: "Carat" },
] as const;

const PRODUCT_IMPORT_HEADERS = [
  "Name",
  "SKU",
  "Unit (gram/kilogram/piece/carat)",
  "Purity Label",
  "HSN Code",
  "Reorder Level (g)",
];

function ImportProductsDialog({
  purities,
}: {
  purities: Doc<"metalPurities">[] | undefined;
}) {
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
        if (purityLabelInput && !metalPurityId)
          throw new Error(
            `No purity named "${r["Purity Label"]}" — check Settings > Metal Purity Configuration`,
          );
        const reorderLevelGrams = r["Reorder Level (g)"]?.trim();
        await createProduct({
          name,
          sku: r["SKU"] || undefined,
          unit,
          metalPurityId,
          hsnCode: r["HSN Code"] || undefined,
          reorderLevelMg: reorderLevelGrams
            ? Math.round(Number(reorderLevelGrams) * 1000)
            : undefined,
        });
      }}
    />
  );
}

const NONE = "NONE";

// Add / Edit Product Dialog (matching Vyapar Pages 12-14)
function ProductFormDialog({
  product,
  trigger,
}: {
  product?: Doc<"products">;
  trigger?: React.ReactNode;
}) {
  const create = useMutation(api.products.create);
  const update = useMutation(api.products.update);
  const purities = useQuery(api.metalPurities.list);
  const groups = useQuery(api.stockGroups.list);
  const categories = useQuery(api.stockCategories.list);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [unit, setUnit] = useState<"gram" | "kilogram" | "piece" | "carat">(
    product?.unit ?? "piece",
  );
  const [itemType, setItemType] = useState<"product" | "service">(
    product?.itemType ?? "product",
  );
  const [metalPurityId, setMetalPurityId] = useState<string>(
    product?.metalPurityId ?? NONE,
  );
  const [stockGroupId, setStockGroupId] = useState<string>(
    product?.stockGroupId ?? NONE,
  );
  const [stockCategoryId, setStockCategoryId] = useState<string>(
    product?.stockCategoryId ?? NONE,
  );
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [customFields, setCustomFields] = useState<Record<string, string>>(
    product?.customFields ?? {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!product;

  function reset() {
    setName(product?.name ?? "");
    setSku(product?.sku ?? "");
    setUnit(product?.unit ?? "piece");
    setItemType(product?.itemType ?? "product");
    setMetalPurityId(product?.metalPurityId ?? NONE);
    setStockGroupId(product?.stockGroupId ?? NONE);
    setStockCategoryId(product?.stockCategoryId ?? NONE);
    setHsnCode(product?.hsnCode ?? "");
    setDescription(product?.description ?? "");
    setCustomFields(product?.customFields ?? {});
    setError(null);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        sku: sku.trim() || undefined,
        unit,
        itemType,
        metalPurityId: metalPurityId === NONE ? undefined : (metalPurityId as Id<"metalPurities">),
        stockGroupId: stockGroupId === NONE ? undefined : (stockGroupId as Id<"stockGroups">),
        stockCategoryId:
          stockCategoryId === NONE ? undefined : (stockCategoryId as Id<"stockCategories">),
        hsnCode: hsnCode.trim() || undefined,
        description: description.trim() || undefined,
        customFields,
      };
      if (isEdit) {
        await update({ id: product._id, ...payload });
      } else {
        await create(payload);
      }
      setOpen(false);
      if (!isEdit) reset();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save this item."));
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
        {trigger ? (
          trigger
        ) : isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit item">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="bg-[#d93025] hover:bg-[#b3261e] text-white font-medium shadow-sm">
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {isEdit ? "Edit Item" : "Add Item"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Top Toggle: Product vs Service (Page 12) */}
          <div className="flex items-center gap-2 border-b pb-3">
            <span className="text-xs font-semibold text-muted-foreground">Item Type:</span>
            <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
              <button
                type="button"
                onClick={() => setItemType("product")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                  itemType === "product"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Product / Ornament
              </button>
              <button
                type="button"
                onClick={() => setItemType("service")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                  itemType === "service"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Service / Making
              </button>
            </div>
          </div>

          {/* Primary Fields (Page 12) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="item-name" className="text-xs font-semibold">
                Item Name *
              </Label>
              <Input
                id="item-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Gold Chain 22K (Box 112)"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="item-hsn" className="text-xs font-semibold">
                Item HSN
              </Label>
              <Input
                id="item-hsn"
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                placeholder="HSN Code (e.g. 7113)"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value} className="text-xs">
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Metal Purity</Label>
              <Select value={metalPurityId} onValueChange={setMetalPurityId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Choose Purity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">
                    None
                  </SelectItem>
                  {purities?.map((p) => (
                    <SelectItem key={p._id} value={p._id} className="text-xs">
                      {p.label} ({p.metal})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Item Code / SKU</Label>
              <Input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Optional SKU"
                className="h-9 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Category</Label>
              <Select value={stockCategoryId} onValueChange={setStockCategoryId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">
                    None
                  </SelectItem>
                  {categories?.map((c) => (
                    <SelectItem key={c._id} value={c._id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Stock Group</Label>
              <Select value={stockGroupId} onValueChange={setStockGroupId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select Stock Group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">
                    None
                  </SelectItem>
                  {groups?.map((g) => (
                    <SelectItem key={g._id} value={g._id} className="text-xs">
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="item-desc" className="text-xs font-semibold">
              Description / Notes
            </Label>
            <Textarea
              id="item-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Design details, gemstone specs, weight notes..."
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          <CustomFieldInputs entity="product" values={customFields} onChange={setCustomFields} />

          {error && <p className="text-xs text-destructive font-medium">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={submitting}
            className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white"
          >
            {submitting ? "Saving…" : isEdit ? "Update Item" : "Save Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Stock Adjustment Modal Dialog (Page 11)
function AdjustItemDialog({ product }: { product: Doc<"products"> }) {
  const [open, setOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<"add" | "reduce">("add");
  const [quantity, setQuantity] = useState("1");
  const [details, setDetails] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 font-medium">
          <Sliders className="h-3.5 w-3.5" />
          Adjust Item
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">Stock Adjustment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Add Stock vs Reduce Stock Toggle (Page 11) */}
          <div className="flex items-center gap-3 border-b pb-3">
            <button
              type="button"
              onClick={() => setAdjustType("add")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-semibold transition ${
                adjustType === "add"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              + Add Stock
            </button>
            <button
              type="button"
              onClick={() => setAdjustType("reduce")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-semibold transition ${
                adjustType === "reduce"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              - Reduce Stock
            </button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Item Name</Label>
            <p className="font-semibold text-sm">{product.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="adj-qty" className="text-xs font-semibold">
                Adjustment Quantity ({product.unit})
              </Label>
              <Input
                id="adj-qty"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Adjustment Date</Label>
              <Input
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="adj-details" className="text-xs font-semibold">
              Adjustment Reason / Details
            </Label>
            <Input
              id="adj-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. Counter count mismatch, reweighed"
              className="h-9 text-sm"
            />
          </div>

          {saved && (
            <p className="text-xs text-emerald-600 font-medium">
              Stock adjustment recorded successfully.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              setSaved(true);
              setTimeout(() => {
                setOpen(false);
                setSaved(false);
              }, 600);
            }}
            className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white"
          >
            Save Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Right Detail View for Selected Item (Page 10)
function ProductDetailView({
  product,
  purityLabel,
}: {
  product: Doc<"products">;
  purityLabel?: string;
}) {
  return (
    <div className="space-y-5">
      {/* Item Header & Controls (Page 10) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">
              {product.name}
            </h2>
            <Badge variant="outline" className="text-xs capitalize">
              {product.unit}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {product.sku && <span className="font-mono">Code: {product.sku}</span>}
            {purityLabel && <span>Purity: {purityLabel}</span>}
            {product.hsnCode && <span>HSN: {product.hsnCode}</span>}
            {product.description && <span>{product.description}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AdjustItemDialog product={product} />
          <ProductFormDialog
            product={product}
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
            <Link href="/sales/new">
              <Receipt className="h-3.5 w-3.5" />
              Sell Item
            </Link>
          </Button>
          <DeleteRecordButton table="products" id={product._id} name={product.name} />
        </div>
      </div>

      {/* 4 Summary Stats Cards matching Page 10 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sale Price
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              Daily Rate <span className="text-xs font-normal text-muted-foreground">(excl)</span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Purchase Price
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              ₹ 0.00 <span className="text-xs font-normal text-muted-foreground">(excl)</span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Stock Quantity
            </p>
            <p className="mt-1 text-lg font-bold text-emerald-600">
              Active Stock
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Stock Value
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              In Inventory
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Box Links & Barcode Labeling Quick Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
          <Link href="/boxes">
            <Boxes className="h-4 w-4 text-primary" />
            <span>Manage Physical Stock Boxes</span>
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
          <Link href="/boxes/labels">
            <Barcode className="h-4 w-4" />
            <span>Print Item Barcodes</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}

// Main 2-Pane Items / Products Screen (Page 10 Layout)
export default function ProductsPage() {
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalPurities.list);
  const boxes = useQuery(api.boxes.list);
  const boxOverview = useQuery(api.boxes.getInventoryOverview);
  const recentSales = useQuery(api.sales.list);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("products");
  const [selectedBoxId, setSelectedBoxId] = useState<Id<"boxes"> | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<Id<"products"> | null>(null);

  const purityMap = useMemo(() => {
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
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const filteredBoxes = useMemo(() => {
    if (!boxOverview?.boxes) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return boxOverview.boxes;
    return boxOverview.boxes.filter(
      (b) =>
        String(b.box.boxNumber).includes(q) ||
        (b.box.label && b.box.label.toLowerCase().includes(q)),
    );
  }, [boxOverview, search]);

  const activeBox = useMemo(() => {
    if (!filteredBoxes || filteredBoxes.length === 0) return null;
    if (selectedBoxId) {
      const match = filteredBoxes.find((b) => b.box._id === selectedBoxId);
      if (match) return match;
    }
    return filteredBoxes[0];
  }, [filteredBoxes, selectedBoxId]);

  const activeProduct = useMemo(() => {
    if (!filtered || filtered.length === 0) return null;
    if (selectedProductId) {
      const match = filtered.find((p) => p._id === selectedProductId);
      if (match) return match;
    }
    return filtered[0];
  }, [filtered, selectedProductId]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/* Top Header & Import / Add Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Items / Products</h1>
          <p className="text-xs text-muted-foreground">
            Manage jewellery stock, physical boxes, purities, barcodes, and stock adjustments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportProductsDialog purities={purities} />
          <ProductFormDialog />
        </div>
      </div>

      {/* Top Navigation Tabs matching Page 10 */}
      <div className="border-b">
        <div className="flex gap-4 text-xs font-semibold uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setActiveTab("products")}
            className={`pb-2.5 border-b-2 transition ${
              activeTab === "products"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Products ({products?.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("boxes")}
            className={`pb-2.5 border-b-2 transition ${
              activeTab === "boxes"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Boxes & Physical Stock ({boxOverview?.boxes?.length ?? boxes?.length ?? 0})
          </button>
          <Link
            href="/inventory/categories"
            className="pb-2.5 border-b-2 border-transparent text-muted-foreground hover:text-foreground"
          >
            Categories
          </Link>
          <Link
            href="/inventory/groups"
            className="pb-2.5 border-b-2 border-transparent text-muted-foreground hover:text-foreground"
          >
            Stock Groups
          </Link>
        </div>
      </div>

      {/* 2-Pane Split Master-Detail Layout (Page 10) */}
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] lg:grid-cols-[380px_1fr] gap-5 items-start">
        {/* Left Pane: Items / Boxes List with Quantity (Page 10) */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
          <div className="p-3 border-b bg-muted/20">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search Items"
                placeholder={activeTab === "boxes" ? "Search Box No / Label" : "Search Item / SKU"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8.5 h-9 text-xs rounded-lg"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item / Box</span>
              <span>Stock Quantity</span>
            </div>
          </div>

          <div className="max-h-[650px] overflow-y-auto divide-y divide-border/60">
            {activeTab === "boxes" ? (
              filteredBoxes === undefined ? (
                <p className="p-5 text-xs text-muted-foreground text-center">Loading boxes…</p>
              ) : filteredBoxes.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  <Boxes className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
                  <p>No stock boxes found</p>
                </div>
              ) : (
                filteredBoxes.map((b) => {
                  const isSelected = activeBox?.box._id === b.box._id;
                  const label = b.box.label ? ` (${b.box.label})` : "";
                  const boxName = `Box No${b.box.boxNumber}${label}`;
                  const isPositive = b.quantity > 0;
                  return (
                    <button
                      key={b.box._id}
                      type="button"
                      onClick={() => setSelectedBoxId(b.box._id)}
                      className={`w-full p-3 text-left transition-colors flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-primary/10 border-l-4 border-l-primary"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-xs sm:text-sm truncate">{boxName}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {b.quantity} pieces · {(b.weightMg / 1000).toFixed(3)}g
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                            isPositive
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {b.quantity}
                        </span>
                      </div>
                    </button>
                  );
                })
              )
            ) : filtered === undefined ? (
              <p className="p-5 text-xs text-muted-foreground text-center">Loading items…</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <Gem className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
                <p>No items found</p>
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = activeProduct?._id === p._id;
                const purity = p.metalPurityId ? purityMap.get(p.metalPurityId) : null;
                return (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => setSelectedProductId(p._id)}
                    className={`w-full p-3 text-left transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-xs sm:text-sm truncate">{p.name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {purity && <span className="font-medium">{purity}</span>}
                        {p.sku && <span>· {p.sku}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-600">
                        In Stock
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Selected Item / Box Details & Transactions (Page 10) */}
        <div className="min-w-0 space-y-5">
          {activeTab === "boxes" && activeBox ? (
            <div className="space-y-5">
              {/* Box Header & Controls matching Page 10 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">
                      BOX NO{activeBox.box.boxNumber}
                      {activeBox.box.label ? ` (${activeBox.box.label})` : ""}
                    </h2>
                    <Badge variant="outline" className="text-xs">
                      {activeBox.quantity} Pcs
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Physical Box #{activeBox.box.boxNumber}</span>
                    <span>Total Weight: {(activeBox.weightMg / 1000).toFixed(3)}g</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button asChild size="sm" className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white">
                    <Link href={`/inventory/adjustments?boxId=${activeBox.box._id}`}>
                      <Sliders className="h-3.5 w-3.5 mr-1" />
                      Adjust Item
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="h-9 bg-[#d93025] hover:bg-[#b3261e] text-white">
                    <Link href="/sales/new">
                      <Receipt className="h-3.5 w-3.5 mr-1" />
                      Sell from Box
                    </Link>
                  </Button>
                </div>
              </div>

              {/* 4 Summary Stats Cards matching Page 10 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="border-border/80 shadow-xs">
                  <CardContent className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Sale Price
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      Live Rate <span className="text-xs font-normal text-muted-foreground">(excl)</span>
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border/80 shadow-xs">
                  <CardContent className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Purchase Price
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      ₹ 0.00 <span className="text-xs font-normal text-muted-foreground">(excl)</span>
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border/80 shadow-xs">
                  <CardContent className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Stock Quantity
                    </p>
                    <p
                      className={`mt-1 text-lg font-bold tabular-nums ${
                        activeBox.quantity >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {activeBox.quantity} Pcs · {(activeBox.weightMg / 1000).toFixed(2)}g
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border/80 shadow-xs">
                  <CardContent className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Stock Value
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      In Inventory
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Box Transactions Table matching Page 10 */}
              <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3 border-b pb-2">
                  <h3 className="font-bold text-sm uppercase tracking-wide">
                    Transactions
                  </h3>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/boxes`}>
                      View Box Details <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left font-semibold">
                        <th className="pb-2">TYPE</th>
                        <th className="pb-2">ITEM / LABEL</th>
                        <th className="pb-2">WEIGHT</th>
                        <th className="pb-2">STATUS</th>
                        <th className="pb-2 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {activeBox.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-muted-foreground">
                            No active items in Box {activeBox.box.boxNumber}.
                          </td>
                        </tr>
                      ) : (
                        activeBox.items.slice(0, 10).map((it) => (
                          <tr key={it._id} className="hover:bg-muted/30">
                            <td className="py-2.5">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">
                                In Stock
                              </span>
                            </td>
                            <td className="py-2.5 font-medium">{it.label}</td>
                            <td className="py-2.5 font-mono">{(it.netWeightMg / 1000).toFixed(3)}g</td>
                            <td className="py-2.5 capitalize">{it.status}</td>
                            <td className="py-2.5 text-right">
                              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                                <Link href="/sales/new">Sell</Link>
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeProduct ? (
            <ProductDetailView
              product={activeProduct}
              purityLabel={
                activeProduct.metalPurityId ? purityMap.get(activeProduct.metalPurityId) : undefined
              }
            />
          ) : (
            <Card className="p-12 text-center text-muted-foreground">
              <Gem className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">Select an item to view details and transactions</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
