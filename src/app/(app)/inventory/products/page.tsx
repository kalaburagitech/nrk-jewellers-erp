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
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { toast } from "@/components/toaster";
import { formatPaise } from "@/lib/money";
import { purityKaratLabel, type PurityKarat } from "@/lib/jewelry-calc";
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

const PURITY_OPTIONS: { value: PurityKarat; label: string }[] = [
  { value: "24K", label: "24 Karat (24K)" },
  { value: "22K", label: "22 Karat (22K)" },
  { value: "20K", label: "20 Karat (20K)" },
  { value: "18K", label: "18 Karat (18K)" },
  { value: "14K", label: "14 Karat (14K)" },
  { value: "12K", label: "12 Karat (12K)" },
  { value: "10K", label: "10 Karat (10K)" },
  { value: "9K", label: "9 Karat (9K)" },
  { value: "other", label: "Other" },
];

function mgToInput(mg: number | undefined) {
  return mg === undefined ? "" : (mg / 1000).toFixed(3);
}
function paiseToInput(paise: number | undefined) {
  return paise === undefined ? "" : (paise / 100).toFixed(2);
}
function bpToInput(bp: number | undefined) {
  return bp === undefined ? "" : (bp / 100).toFixed(2);
}
/** "" → undefined (field left blank); otherwise a validated whole number, or an error string. */
function parseOptional(raw: string, scale: number, label: string, max?: number): { value?: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { error: `${label}: enter a valid number of zero or more` };
  if (max !== undefined && n > max) return { error: `${label}: cannot exceed ${max}` };
  return { value: Math.round(n * scale) };
}

// Add / Edit Item dialog. Existing fields, validation and save path are kept;
// jewellery master fields (purity, box, weights, prices, GST, opening stock) are added.
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
  const boxes = useQuery(api.boxes.list);
  const taxConfigs = useQuery(api.taxConfigurations.list);
  const access = useQuery(api.organizations.getMyAccess);
  const pricing = useQuery(api.products.myPricingAccess);
  const gstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";

  const initialKarat = (): string => {
    if (product?.purityKarat) return product.purityKarat;
    // Older items only have metalPurityId: show the karat if its label is one, else "Other".
    const label = purities?.find((p) => p._id === product?.metalPurityId)?.label?.replace(/\s+/g, "").toUpperCase();
    if (label && PURITY_OPTIONS.some((o) => o.value === label)) return label;
    return product?.metalPurityId ? "other" : NONE;
  };

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [unit, setUnit] = useState<"gram" | "kilogram" | "piece" | "carat">(product?.unit ?? "piece");
  const [itemType, setItemType] = useState<"product" | "service">(product?.itemType ?? "product");
  const [karat, setKarat] = useState<string>(NONE);
  const [purityOther, setPurityOther] = useState(product?.purityOther ?? "");
  const [metalPurityId, setMetalPurityId] = useState<string>(product?.metalPurityId ?? NONE);
  const [stockGroupId, setStockGroupId] = useState<string>(product?.stockGroupId ?? NONE);
  const [stockCategoryId, setStockCategoryId] = useState<string>(product?.stockCategoryId ?? NONE);
  const [defaultBoxId, setDefaultBoxId] = useState<string>(product?.defaultBoxId ?? NONE);
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? "");
  const [taxConfigurationId, setTaxConfigurationId] = useState<string>(product?.taxConfigurationId ?? NONE);
  const [gross, setGross] = useState(mgToInput(product?.grossWeightMg));
  const [stone, setStone] = useState(mgToInput(product?.stoneWeightMg));
  const [net, setNet] = useState(mgToInput(product?.netWeightMg));
  const [netTouched, setNetTouched] = useState(product?.netWeightMg !== undefined);
  const [purchasePrice, setPurchasePrice] = useState(paiseToInput(product?.purchasePricePaise));
  const [sellingPrice, setSellingPrice] = useState(paiseToInput(product?.sellingPricePaise));
  const [making, setMaking] = useState(paiseToInput(product?.makingChargePaise));
  const [wastage, setWastage] = useState(bpToInput(product?.wastageBasisPoints));
  const [openingStock, setOpeningStock] = useState("");
  const [description, setDescription] = useState(product?.description ?? "");
  const [customFields, setCustomFields] = useState<Record<string, string>>(product?.customFields ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!product;
  const showCost = pricing?.canViewCost ?? false;

  function reset() {
    setName(product?.name ?? "");
    setSku(product?.sku ?? "");
    setUnit(product?.unit ?? "piece");
    setItemType(product?.itemType ?? "product");
    setKarat(initialKarat());
    setPurityOther(product?.purityOther ?? "");
    setMetalPurityId(product?.metalPurityId ?? NONE);
    setStockGroupId(product?.stockGroupId ?? NONE);
    setStockCategoryId(product?.stockCategoryId ?? NONE);
    setDefaultBoxId(product?.defaultBoxId ?? NONE);
    setHsnCode(product?.hsnCode ?? "");
    setTaxConfigurationId(product?.taxConfigurationId ?? NONE);
    setGross(mgToInput(product?.grossWeightMg));
    setStone(mgToInput(product?.stoneWeightMg));
    setNet(mgToInput(product?.netWeightMg));
    setNetTouched(product?.netWeightMg !== undefined);
    setPurchasePrice(paiseToInput(product?.purchasePricePaise));
    setSellingPrice(paiseToInput(product?.sellingPricePaise));
    setMaking(paiseToInput(product?.makingChargePaise));
    setWastage(bpToInput(product?.wastageBasisPoints));
    setOpeningStock("");
    setDescription(product?.description ?? "");
    setCustomFields(product?.customFields ?? {});
    setError(null);
  }

  // Net weight follows gross − stone until the user types their own net weight.
  function updateWeights(nextGross: string, nextStone: string) {
    setGross(nextGross);
    setStone(nextStone);
    if (!netTouched) {
      const g = Number(nextGross || "0");
      const s = Number(nextStone || "0");
      setNet(nextGross.trim() && Number.isFinite(g - s) && g - s >= 0 ? (g - s).toFixed(3) : "");
    }
  }

  const otherPurities = (purities ?? []).filter(
    (p) => !PURITY_OPTIONS.some((o) => o.value !== "other" && o.value === p.label.replace(/\s+/g, "").toUpperCase()),
  );

  async function handleSave() {
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    const parsed = {
      gross: parseOptional(gross, 1000, "Gross weight"),
      stone: parseOptional(stone, 1000, "Stone weight"),
      net: parseOptional(net, 1000, "Net weight"),
      purchase: parseOptional(purchasePrice, 100, "Purchase price"),
      selling: parseOptional(sellingPrice, 100, "Selling price"),
      making: parseOptional(making, 100, "Making charges"),
      wastage: parseOptional(wastage, 100, "Wastage %", 100),
      opening: parseOptional(openingStock, 1, "Opening stock", 500),
    };
    const firstError = Object.values(parsed).find((p) => p.error)?.error;
    if (firstError) {
      setError(firstError);
      return;
    }
    const g = parsed.gross.value;
    const s = parsed.stone.value ?? 0;
    const n = parsed.net.value;
    if (g !== undefined && s > g) return setError("Stone weight cannot be more than gross weight.");
    if (g !== undefined && n !== undefined && n > g - s) return setError("Net weight cannot be more than gross weight minus stone weight.");
    if (g === undefined && (parsed.stone.value || n)) return setError("Enter the gross weight first.");
    if (openingStock.trim() && !Number.isInteger(Number(openingStock))) return setError("Opening stock must be whole pieces.");
    const openingPieces = parsed.opening.value ?? 0;
    if (!isEdit && openingPieces > 0 && !gstCompany) {
      if (defaultBoxId === NONE) return setError("Choose the box number for the opening stock pieces.");
      if (!g) return setError("Enter the gross weight per piece for the opening stock.");
    }
    if (karat === "other" && !purityOther.trim() && metalPurityId === NONE) {
      return setError("Purity is 'Other' — type the purity or pick it from the list.");
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        sku: sku.trim() || undefined,
        unit,
        itemType,
        purityKarat: karat === NONE ? undefined : (karat as PurityKarat),
        purityOther: karat === "other" ? purityOther.trim() || undefined : undefined,
        // A karat is resolved to its purity record on the server; "Other" may link an existing one (e.g. Silver 925).
        metalPurityId:
          karat === "other" && metalPurityId !== NONE ? (metalPurityId as Id<"metalPurities">) : undefined,
        stockGroupId: stockGroupId === NONE ? undefined : (stockGroupId as Id<"stockGroups">),
        stockCategoryId: stockCategoryId === NONE ? undefined : (stockCategoryId as Id<"stockCategories">),
        defaultBoxId: defaultBoxId === NONE ? undefined : (defaultBoxId as Id<"boxes">),
        hsnCode: hsnCode.trim() || undefined,
        taxConfigurationId: taxConfigurationId === NONE ? undefined : (taxConfigurationId as Id<"taxConfigurations">),
        grossWeightMg: g,
        stoneWeightMg: g === undefined ? undefined : s,
        netWeightMg: n,
        purchasePricePaise: parsed.purchase.value,
        sellingPricePaise: parsed.selling.value,
        makingChargePaise: parsed.making.value,
        wastageBasisPoints: parsed.wastage.value,
        description: description.trim() || undefined,
        customFields,
      };
      if (isEdit) {
        await update({ id: product._id, ...payload });
      } else {
        await create({ ...payload, openingStock: openingPieces || undefined });
      }
      toast.success(isEdit ? `"${payload.name}" updated` : `"${payload.name}" saved${openingPieces ? ` with ${openingPieces} piece(s) in stock` : ""}`);
      setOpen(false);
      if (!isEdit) reset();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save this item."));
    } finally {
      setSubmitting(false);
    }
  }

  const sectionTitle = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
  const isProduct = itemType === "product";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{isEdit ? "Edit Item" : "Add Item"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Product vs Service */}
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <span className="text-xs font-semibold text-muted-foreground">Item Type:</span>
            <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
              {(["product", "service"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setItemType(type)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    itemType === type ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {type === "product" ? "Product / Ornament" : "Service / Making"}
                </button>
              ))}
            </div>
          </div>

          {/* Item details */}
          <section className="space-y-3">
            <p className={sectionTitle}>Item details</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="item-name" className="text-xs font-semibold">Item Name *</Label>
                <Input id="item-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold Ring" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="item-sku" className="text-xs font-semibold">Item Code / SKU</Label>
                <Input id="item-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. GR-101" className="h-9 text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Category</Label>
                <Select value={stockCategoryId} onValueChange={setStockCategoryId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs">None</SelectItem>
                    {categories?.map((c) => <SelectItem key={c._id} value={c._id} className="text-xs">{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Stock Group</Label>
                <Select value={stockGroupId} onValueChange={setStockGroupId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select Stock Group" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs">None</SelectItem>
                    {groups?.map((g) => <SelectItem key={g._id} value={g._id} className="text-xs">{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Unit</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u.value} value={u.value} className="text-xs">{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Purity / Karat</Label>
                <Select value={karat} onValueChange={setKarat}>
                  <SelectTrigger className="h-9 text-xs" aria-label="Purity / Karat"><SelectValue placeholder="Choose purity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs">Not set</SelectItem>
                    {PURITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {karat === "other" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Specify purity</Label>
                    <Input value={purityOther} maxLength={40} onChange={(e) => setPurityOther(e.target.value)} placeholder="e.g. Silver 925, 23K" className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Rate purity (optional)</Label>
                    <Select value={metalPurityId} onValueChange={setMetalPurityId}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Link a metal rate" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE} className="text-xs">None</SelectItem>
                        {otherPurities.map((p) => <SelectItem key={p._id} value={p._id} className="text-xs">{p.label} ({p.metal})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {karat !== "other" && (
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-semibold">Box Number</Label>
                  {gstCompany ? (
                    <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">GST company — stock is kept item-wise, not in boxes</p>
                  ) : (
                    <Select value={defaultBoxId} onValueChange={setDefaultBoxId}>
                      <SelectTrigger className="h-9 text-xs" aria-label="Box Number"><SelectValue placeholder="Choose box" /></SelectTrigger>
                      <SelectContent className="max-h-64">
                        <SelectItem value={NONE} className="text-xs">No default box</SelectItem>
                        {boxes?.filter((b) => b.isActive || b._id === product?.defaultBoxId).map((b) => (
                          <SelectItem key={b._id} value={b._id} className="text-xs">
                            Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}{b.category ? ` (${b.category})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
            {karat === "other" && !gstCompany && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Box Number</Label>
                  <Select value={defaultBoxId} onValueChange={setDefaultBoxId}>
                    <SelectTrigger className="h-9 text-xs" aria-label="Box Number"><SelectValue placeholder="Choose box" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value={NONE} className="text-xs">No default box</SelectItem>
                      {boxes?.filter((b) => b.isActive || b._id === product?.defaultBoxId).map((b) => (
                        <SelectItem key={b._id} value={b._id} className="text-xs">Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </section>

          {/* Weights */}
          {isProduct && (
            <section className="space-y-3">
              <p className={sectionTitle}>Weight (per piece, grams)</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="item-gross" className="text-xs font-semibold">Gross Weight (g)</Label>
                  <Input id="item-gross" inputMode="decimal" value={gross} onChange={(e) => updateWeights(e.target.value, stone)} placeholder="0.000" className="h-9 text-sm font-mono" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="item-stone" className="text-xs font-semibold">Stone Weight (g)</Label>
                  <Input id="item-stone" inputMode="decimal" value={stone} onChange={(e) => updateWeights(gross, e.target.value)} placeholder="0.000" className="h-9 text-sm font-mono" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="item-net" className="text-xs font-semibold">Net Weight (g)</Label>
                  <Input
                    id="item-net"
                    inputMode="decimal"
                    value={net}
                    onChange={(e) => {
                      setNet(e.target.value);
                      setNetTouched(e.target.value.trim().length > 0);
                    }}
                    placeholder="Gross − stone"
                    className="h-9 text-sm font-mono"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Net weight fills in as gross − stone; change it if there are other deductions (beads, wax).</p>
            </section>
          )}

          {/* Pricing & tax */}
          <section className="space-y-3">
            <p className={sectionTitle}>Pricing &amp; GST</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(showCost || !isEdit) && (
                <div className="space-y-1">
                  <Label htmlFor="item-purchase-price" className="text-xs font-semibold">Purchase Price (₹)</Label>
                  <Input id="item-purchase-price" inputMode="decimal" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="0.00" className="h-9 text-sm font-mono" />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="item-selling-price" className="text-xs font-semibold">Selling Price (₹)</Label>
                <Input id="item-selling-price" inputMode="decimal" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="0.00" className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="item-making" className="text-xs font-semibold">Making Charges (₹)</Label>
                <Input id="item-making" inputMode="decimal" value={making} onChange={(e) => setMaking(e.target.value)} placeholder="0.00" className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="item-wastage" className="text-xs font-semibold">Wastage (%)</Label>
                <Input id="item-wastage" inputMode="decimal" value={wastage} onChange={(e) => setWastage(e.target.value)} placeholder="0.00" className="h-9 text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="item-hsn" className="text-xs font-semibold">HSN Code</Label>
                <Input id="item-hsn" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="e.g. 7113" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">GST Percentage</Label>
                <Select value={taxConfigurationId} onValueChange={setTaxConfigurationId}>
                  <SelectTrigger className="h-9 text-xs" aria-label="GST Percentage"><SelectValue placeholder="Choose GST rate" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs">Not set (choose on bill)</SelectItem>
                    {taxConfigs?.filter((t) => t.isActive || t._id === product?.taxConfigurationId).map((t) => (
                      <SelectItem key={t._id} value={t._id} className="text-xs">
                        {t.name} · {((t.cgstBasisPoints + t.sgstBasisPoints + t.igstBasisPoints) / 100).toFixed(2)}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!isEdit && isProduct && (
                <div className="space-y-1">
                  <Label htmlFor="item-opening" className="text-xs font-semibold">Opening Stock (pieces)</Label>
                  <Input id="item-opening" inputMode="numeric" value={openingStock} onChange={(e) => setOpeningStock(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="h-9 text-sm" />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved prices fill in automatically on Sales (selling price) and Purchase (purchase price). Leave the selling price blank to bill by today&apos;s rate per gram instead.
              {!isEdit && isProduct && (gstCompany ? " Opening stock is added to GST item stock." : " Opening stock pieces are placed in the chosen box.")}
            </p>
          </section>

          <div className="space-y-1">
            <Label htmlFor="item-desc" className="text-xs font-semibold">Item Description</Label>
            <Textarea id="item-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Design details, gemstone specs…" rows={2} className="text-sm resize-none" />
          </div>

          <CustomFieldInputs entity="product" values={customFields} onChange={setCustomFields} />

          {error && <p role="alert" className="text-xs text-destructive font-medium">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9">Cancel</Button>
          <Button onClick={handleSave} disabled={submitting} className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white">
            {submitting ? "Saving…" : isEdit ? "Update Item" : "Save Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Stock Adjustment dialog — now posts a real, audited adjustment.
function AdjustItemDialog({ product }: { product: Doc<"products"> }) {
  const adjustStock = useMutation(api.products.adjustStock);
  const boxes = useQuery(api.boxes.list);
  const access = useQuery(api.organizations.getMyAccess);
  const gstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";
  const [open, setOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<"add" | "reduce">("add");
  const [quantity, setQuantity] = useState("1");
  const [boxId, setBoxId] = useState<string>(product.defaultBoxId ?? NONE);
  const [gross, setGross] = useState(mgToInput(product.grossWeightMg));
  const [stone, setStone] = useState(mgToInput(product.stoneWeightMg));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const pieces = Number(quantity);
    if (!Number.isInteger(pieces) || pieces < 1) return setError("Enter whole pieces (1 or more).");
    if (!details.trim()) return setError("Enter the reason for this adjustment.");
    const grossMg = gross.trim() ? Math.round(Number(gross) * 1000) : undefined;
    const stoneMg = stone.trim() ? Math.round(Number(stone) * 1000) : undefined;
    if ((grossMg !== undefined && !Number.isFinite(grossMg)) || (stoneMg !== undefined && !Number.isFinite(stoneMg))) return setError("Enter valid weights.");
    setSaving(true);
    try {
      await adjustStock({
        productId: product._id,
        direction: adjustType,
        pieces,
        boxId: boxId === NONE ? undefined : (boxId as Id<"boxes">),
        grossWeightMg: grossMg,
        stoneWeightMg: stoneMg ?? (grossMg !== undefined ? 0 : undefined),
        reason: details.trim(),
        adjustedAt: new Date(`${date}T00:00:00.000Z`).getTime(),
      });
      toast.success(`Stock ${adjustType === "add" ? "added" : "reduced"}: ${pieces} piece(s) of ${product.name}`);
      setOpen(false);
      setDetails("");
      setQuantity("1");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save this adjustment."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}>
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
          <div className="flex items-center gap-3 border-b pb-3">
            {(["add", "reduce"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAdjustType(type)}
                className={`flex-1 py-2 text-center rounded-lg text-xs font-semibold transition ${
                  adjustType === type
                    ? type === "add" ? "bg-emerald-600 text-white shadow-xs" : "bg-rose-600 text-white shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {type === "add" ? "+ Add Stock" : "- Reduce Stock"}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Item Name</Label>
            <p className="font-semibold text-sm">{product.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="adj-qty" className="text-xs font-semibold">Pieces</Label>
              <Input id="adj-qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adj-date" className="text-xs font-semibold">Adjustment Date</Label>
              <Input id="adj-date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>

          {(adjustType === "add" || gstCompany) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="adj-gross" className="text-xs font-semibold">Gross wt / piece (g)</Label>
                <Input id="adj-gross" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.000" className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adj-stone" className="text-xs font-semibold">Stone wt / piece (g)</Label>
                <Input id="adj-stone" inputMode="decimal" value={stone} onChange={(e) => setStone(e.target.value)} placeholder="0.000" className="h-9 text-sm font-mono" />
              </div>
            </div>
          )}

          {!gstCompany && (
            <div className="space-y-1">
              <Label className="text-xs font-semibold">{adjustType === "add" ? "Put into box" : "Take from box (optional)"}</Label>
              <Select value={boxId} onValueChange={setBoxId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Choose box" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value={NONE} className="text-xs">{adjustType === "add" ? "Item's default box" : "Any box"}</SelectItem>
                  {boxes?.filter((b) => b.isActive).map((b) => <SelectItem key={b._id} value={b._id} className="text-xs">Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="adj-details" className="text-xs font-semibold">Adjustment Reason / Details *</Label>
            <Input id="adj-details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Counter count mismatch, reweighed" className="h-9 text-sm" />
          </div>

          {error && <p role="alert" className="text-xs text-destructive font-medium">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9">Cancel</Button>
          <Button type="button" disabled={saving} onClick={save} className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white">
            {saving ? "Saving…" : "Save Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <Card className="border-border/80 shadow-xs">
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-lg font-bold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-foreground"}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// Right Detail View for Selected Item
function ProductDetailView({
  product,
  purityLabel,
}: {
  product: Doc<"products">;
  purityLabel?: string;
}) {
  const stock = useQuery(api.products.getStockSummary, { productId: product._id });
  const boxes = useQuery(api.boxes.list);
  const taxConfigs = useQuery(api.taxConfigurations.list);
  const pricing = useQuery(api.products.myPricingAccess);
  const defaultBox = boxes?.find((b) => b._id === product.defaultBoxId);
  const tax = taxConfigs?.find((t) => t._id === product.taxConfigurationId);
  const fmtG = (mg?: number) => (mg === undefined ? "—" : `${(mg / 1000).toFixed(3)} g`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">{product.name}</h2>
            {purityLabel && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-xs">{purityLabel}</Badge>}
            <Badge variant="outline" className="text-xs capitalize">{product.unit}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {product.sku && <span className="font-mono">Code: {product.sku}</span>}
            <span className="capitalize">Type: {product.itemType ?? "product"}</span>
            {defaultBox && <span>Box: {defaultBox.boxNumber}{defaultBox.label ? ` (${defaultBox.label})` : ""}</span>}
            {product.hsnCode && <span>HSN: {product.hsnCode}</span>}
            {tax && <span>GST: {((tax.cgstBasisPoints + tax.sgstBasisPoints + tax.igstBasisPoints) / 100).toFixed(2)}%</span>}
          </div>
          {product.description && <p className="mt-1 text-xs text-muted-foreground">{product.description}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
          <Button asChild size="sm" className="h-9 bg-[#d93025] hover:bg-[#b3261e] text-white font-medium">
            <Link href="/sales/new">
              <Receipt className="h-3.5 w-3.5" />
              Sell Item
            </Link>
          </Button>
          <DeleteRecordButton table="products" id={product._id} name={product.name} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DetailStat
          label="Selling Price"
          value={product.sellingPricePaise !== undefined ? formatPaise(product.sellingPricePaise) : "Daily Rate"}
          sub={product.sellingPricePaise !== undefined ? "per piece (excl. GST)" : "billed at rate per gram"}
        />
        {pricing?.canViewCost && (
          <DetailStat
            label="Purchase Price"
            value={product.purchasePricePaise !== undefined ? formatPaise(product.purchasePricePaise) : "Not set"}
            sub={
              product.purchasePricePaise !== undefined && product.sellingPricePaise !== undefined
                ? `Margin ${formatPaise(product.sellingPricePaise - product.purchasePricePaise)}`
                : "internal cost"
            }
          />
        )}
        <DetailStat
          label="Stock Quantity"
          value={stock === undefined ? "…" : `${stock.pieces} pcs`}
          sub={stock ? `Gross ${fmtG(stock.grossWeightMg)} · Net ${fmtG(stock.netWeightMg)}` : undefined}
          tone={stock && stock.pieces > 0 ? "good" : "bad"}
        />
        <DetailStat
          label="Stock Value"
          value={
            stock && product.sellingPricePaise !== undefined
              ? formatPaise(stock.pieces * product.sellingPricePaise)
              : stock ? `${fmtG(stock.netWeightMg)} net` : "…"
          }
          sub={product.sellingPricePaise !== undefined ? "at selling price" : "valued at daily rate"}
        />
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardContent className="grid grid-cols-2 gap-3 p-4 text-xs sm:grid-cols-4">
          <div><p className="text-muted-foreground">Gross wt / pc</p><p className="font-mono font-semibold">{fmtG(product.grossWeightMg)}</p></div>
          <div><p className="text-muted-foreground">Stone wt / pc</p><p className="font-mono font-semibold">{fmtG(product.stoneWeightMg)}</p></div>
          <div><p className="text-muted-foreground">Net wt / pc</p><p className="font-mono font-semibold">{fmtG(product.netWeightMg)}</p></div>
          <div><p className="text-muted-foreground">Making / Wastage</p><p className="font-semibold">{product.makingChargePaise !== undefined ? formatPaise(product.makingChargePaise) : "—"} · {product.wastageBasisPoints !== undefined ? `${(product.wastageBasisPoints / 100).toFixed(2)}%` : "—"}</p></div>
        </CardContent>
      </Card>

      {stock?.mode === "box" && stock.boxes.length > 0 && (
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Pieces by box</h3>
          <div className="flex flex-wrap gap-2">
            {stock.boxes.map((b) => (
              <Badge key={b.boxId} variant="outline" className="text-xs">Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}: {b.pieces} pcs</Badge>
            ))}
          </div>
        </div>
      )}

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
  const { isLocked } = usePrivacyLock();
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalPurities.list);
  const boxes = useQuery(api.boxes.list);
  const boxOverview = useQuery(api.boxes.getInventoryOverview);
  const recentSales = useQuery(api.sales.list);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("products");
  const tabToUse = isLocked && activeTab === "boxes" ? "products" : activeTab;
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
        (p.hsnCode && p.hsnCode.toLowerCase().includes(q)) ||
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
          {!isLocked && (
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
          )}
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
                placeholder={tabToUse === "boxes" ? "Search Box No / Label" : "Search Item / SKU"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8.5 h-9 text-xs rounded-lg"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item / Box</span>
              <span>{tabToUse === "boxes" ? "Stock Quantity" : "Selling Price"}</span>
            </div>
          </div>

          <div className="max-h-[650px] overflow-y-auto divide-y divide-border/60">
            {tabToUse === "boxes" ? (
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
                          {b.quantity} pieces · Gross {((b.grossWeightMg ?? b.weightMg) / 1000).toFixed(3)}g · Net {(b.netWeightMg / 1000).toFixed(3)}g
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
                const purity = p.purityKarat ? (p.purityKarat === "other" ? p.purityOther || "Other" : p.purityKarat) : p.metalPurityId ? purityMap.get(p.metalPurityId) : null;
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
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 tabular-nums">
                        {p.sellingPricePaise !== undefined ? formatPaise(p.sellingPricePaise) : "Daily rate"}
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
          {tabToUse === "boxes" && activeBox ? (
            <div className="space-y-5">
              {/* Box Header & Controls matching Page 10 */}
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                    <span>Total Stock: Gross {((activeBox.grossWeightMg ?? activeBox.weightMg) / 1000).toFixed(3)}g · Stone {((activeBox.stoneWeightMg ?? 0) / 1000).toFixed(3)}g · Net {(activeBox.netWeightMg / 1000).toFixed(3)}g</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                      {activeBox.quantity} Pcs · Gross {((activeBox.grossWeightMg ?? activeBox.weightMg) / 1000).toFixed(3)}g · Net {(activeBox.netWeightMg / 1000).toFixed(3)}g
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
                        <th className="pb-2">GROSS WT</th>
                        <th className="pb-2">STONE WT</th>
                        <th className="pb-2">NET WT</th>
                        <th className="pb-2">STATUS</th>
                        <th className="pb-2 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {activeBox.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-muted-foreground">
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
                            <td className="py-2.5 font-mono">{(it.grossWeightMg / 1000).toFixed(3)}g</td>
                            <td className="py-2.5 font-mono text-muted-foreground">{(it.stoneWeightMg / 1000).toFixed(3)}g</td>
                            <td className="py-2.5 font-mono font-medium text-emerald-600">{(it.netWeightMg / 1000).toFixed(3)}g</td>
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
                purityKaratLabel(activeProduct.purityKarat, activeProduct.purityOther) ??
                (activeProduct.metalPurityId ? purityMap.get(activeProduct.metalPurityId) : undefined)
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
