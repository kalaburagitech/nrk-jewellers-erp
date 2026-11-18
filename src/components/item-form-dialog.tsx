"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ImagePlus, Pencil, Plus, Sliders, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { getUserErrorMessage } from "@/lib/user-error";
import { paiseToRupeesInput, rupeesToPaise } from "@/lib/money";
import { PURITY_KARATS, type PurityKarat } from "@/lib/jewelry-calc";
import { toast } from "@/components/toaster";

const OTHER_PURITY = "OTHER";
const karatValue = (k: string) => `karat:${k}`;
/** Purity select value for an existing item: a standard karat, another purity row, "Other" text, or none. */
function purityValue(product: Doc<"products"> | undefined, purities: Doc<"metalPurities">[] | undefined) {
  if (product?.metalPurityId) {
    const purity = purities?.find((p) => p._id === product.metalPurityId);
    const label = purity?.label.replace(/\s+/g, "").toUpperCase();
    if (purity?.metal === "gold" && label && (PURITY_KARATS as string[]).includes(label)) return karatValue(label);
    return product.metalPurityId;
  }
  return product?.purityOther ? OTHER_PURITY : NONE;
}

const UNITS = [
  { value: "gram", label: "Gram (g)" },
  { value: "kilogram", label: "Kilogram (kg)" },
  { value: "piece", label: "Piece (pcs)" },
  { value: "carat", label: "Carat (ct)" },
] as const;

// Common jewellery HSN/SAC codes offered as suggestions in the HSN box.
const HSN_SUGGESTIONS = [
  ["7113", "Jewellery of precious metal"],
  ["711319", "Gold jewellery"],
  ["711311", "Silver jewellery"],
  ["7117", "Imitation jewellery"],
  ["7108", "Gold (bars, coins, unwrought)"],
  ["7106", "Silver (bars, unwrought)"],
  ["7102", "Diamonds"],
  ["7103", "Precious stones"],
  ["998892", "Jewellery job work (making) service"],
  ["9987", "Repair & maintenance service"],
] as const;

const NONE = "NONE";
type Unit = Doc<"products">["unit"];

const money = (p?: number) => (p === undefined ? "" : paiseToRupeesInput(p));
const grams = (mg?: number) => (mg === undefined ? "" : String(mg / 1000));
/** "" → undefined; invalid → NaN so validation can catch it. */
const toPaise = (s: string) => (s.trim() === "" ? undefined : (rupeesToPaise(s) ?? Number.NaN));
const toMg = (s: string) => (s.trim() === "" ? undefined : Number.isFinite(Number(s)) && Number(s) >= 0 ? Math.round(Number(s) * 1000) : Number.NaN);
const toInt = (s: string) => (s.trim() === "" ? undefined : Number.isInteger(Number(s)) && Number(s) >= 0 ? Number(s) : Number.NaN);
const today = () => new Date().toISOString().slice(0, 10);

function blank(product?: Doc<"products">, defaultUnit: Unit = "piece", purities?: Doc<"metalPurities">[]) {
  return {
    itemType: product?.itemType ?? ("product" as "product" | "service"),
    name: product?.name ?? "",
    hsnCode: product?.hsnCode ?? "",
    unit: product?.unit ?? defaultUnit,
    sku: product?.sku ?? "",
    stockCategoryId: product?.stockCategoryId ?? NONE,
    stockGroupId: product?.stockGroupId ?? NONE,
    purity: purityValue(product, purities),
    purityOther: product?.purityOther ?? "",
    defaultBoxId: product?.defaultBoxId ?? NONE,
    stoneWeight: grams(product?.stoneWeightMg),
    wastage: product?.wastageBasisPoints === undefined ? "" : String(product.wastageBasisPoints / 100),
    description: product?.description ?? "",
    grossWeight: grams(product?.grossWeightMg),
    netWeight: grams(product?.netWeightMg),
    making: money(product?.makingChargePaise),
    salePrice: money(product?.salePricePaise),
    saleIncTax: product?.salePriceIncludesTax ?? false,
    discountMode: product?.saleDiscountMode ?? ("percent" as "percent" | "amount"),
    discount:
      product?.saleDiscountValue === undefined
        ? ""
        : product.saleDiscountMode === "amount"
          ? paiseToRupeesInput(product.saleDiscountValue)
          : String(product.saleDiscountValue / 100),
    showWholesale: product?.wholesalePricePaise !== undefined,
    wholesalePrice: money(product?.wholesalePricePaise),
    wholesaleMinQty: product?.wholesaleMinQty === undefined ? "" : String(product.wholesaleMinQty),
    purchasePrice: money(product?.purchasePricePaise),
    purchaseIncTax: product?.purchasePriceIncludesTax ?? false,
    taxConfigurationId: product?.taxConfigurationId ?? NONE,
    openingWeight: "",
    openingPieces: "",
    atPrice: money(product?.openingAtPricePaise),
    asOf: product?.openingAsOfMs ? new Date(product.openingAsOfMs).toISOString().slice(0, 10) : today(),
    minStock: grams(product?.reorderLevelMg),
    location: product?.location ?? "",
    imageStorageId: product?.imageStorageId as Id<"_storage"> | undefined,
    customFields: product?.customFields ?? {},
  };
}

/** Add / Edit Item in the Vyapar layout: header fields, then Pricing and Stock tabs. */
export function ItemFormDialog({ product, trigger }: { product?: Doc<"products">; trigger?: ReactNode }) {
  const create = useMutation(api.products.create);
  const update = useMutation(api.products.update);
  const uploadUrl = useMutation(api.products.generateImageUploadUrl);
  const purities = useQuery(api.metalPurities.list);
  const groups = useQuery(api.stockGroups.list);
  const categories = useQuery(api.stockCategories.list);
  const taxes = useQuery(api.taxConfigurations.list);
  const products = useQuery(api.products.list);
  const access = useQuery(api.organizations.getMyAccess);
  const details = useQuery(api.products.details, product ? { id: product._id } : "skip");
  const boxes = useQuery(api.boxes.list);
  const pricing = useQuery(api.products.myPricingAccess);
  const showCost = pricing?.canViewCost ?? false;
  const isGstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";

  const isEdit = !!product;
  const defaultUnit = useQuery(api.appPreferences.get)?.items.defaultUnit ?? "piece";
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(() => blank(product, defaultUnit, purities));
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("pricing");
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const isService = f.itemType === "service";
  const otherPurities = (purities ?? []).filter((p) => !(p.metal === "gold" && (PURITY_KARATS as string[]).includes(p.label.replace(/\s+/g, "").toUpperCase())));
  // Net weight follows gross − stone until it's typed in.
  const autoNet = (() => {
    const g = Number(f.grossWeight);
    const st = Number(f.stoneWeight || "0");
    return f.grossWeight.trim() && Number.isFinite(g) && Number.isFinite(st) && g >= st ? String(Number((g - st).toFixed(3))) : "";
  })();

  function reset() {
    setF(blank(product, defaultUnit, purities));
    setImagePreview(null);
    setError(null);
    setTab("pricing");
  }

  /** Next free numeric item code, like Vyapar's "Assign Code". */
  function assignCode() {
    const used = new Set((products ?? []).map((p) => p.sku).filter(Boolean));
    let next = 1001 + (products ?? []).reduce((max, p) => Math.max(max, /^\d+$/.test(p.sku ?? "") ? Number(p.sku) - 1000 : 0), 0);
    while (used.has(String(next))) next++;
    set("sku", String(next));
  }

  async function onImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setError("Image must be 5 MB or smaller.");
    setUploading(true);
    setError(null);
    try {
      const url = await uploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      set("imageStorageId", storageId);
      setImagePreview(URL.createObjectURL(file));
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not upload the image."));
    } finally {
      setUploading(false);
    }
  }

  async function save(andNew: boolean) {
    if (!f.name.trim()) return setError("Item name is required.");
    const discount =
      f.discount.trim() === "" ? undefined : f.discountMode === "amount" ? toPaise(f.discount) : Math.round(Number(f.discount) * 100);
    const wastage = f.wastage.trim() === "" ? undefined : Number(f.wastage);
    if (wastage !== undefined && (!Number.isFinite(wastage) || wastage < 0 || wastage > 100)) return setError("Wastage must be between 0 and 100%.");
    if (f.purity === OTHER_PURITY && !f.purityOther.trim()) return setError("Type the purity, or choose one from the list.");
    const numbers = {
      grossWeightMg: toMg(f.grossWeight),
      stoneWeightMg: toMg(f.stoneWeight),
      netWeightMg: toMg(f.netWeight.trim() ? f.netWeight : autoNet),
      makingChargePaise: toPaise(f.making),
      salePricePaise: toPaise(f.salePrice),
      saleDiscountValue: discount,
      wholesalePricePaise: f.showWholesale ? toPaise(f.wholesalePrice) : undefined,
      wholesaleMinQty: f.showWholesale ? toInt(f.wholesaleMinQty) : undefined,
      purchasePricePaise: showCost ? toPaise(f.purchasePrice) : undefined,
      openingAtPricePaise: toPaise(f.atPrice),
      reorderLevelMg: toMg(f.minStock),
      wastageBasisPoints: wastage === undefined ? undefined : Math.round(wastage * 100),
    };
    const { grossWeightMg: g, stoneWeightMg: st = 0, netWeightMg: n } = numbers;
    if (g !== undefined && Number.isFinite(g) && Number.isFinite(st) && st > g) return setError("Stone weight cannot be more than gross weight.");
    if (g !== undefined && n !== undefined && Number.isFinite(n) && n > g - st) return setError("Net weight cannot be more than gross weight minus stone weight.");
    const opening = { openingWeightMg: toMg(f.openingWeight), openingPieces: toInt(f.openingPieces) };
    if ([...Object.values(numbers), ...Object.values(opening)].some((n) => n !== undefined && !Number.isFinite(n))) {
      return setError("Check the prices, weights and quantities — one of them is not a valid number.");
    }
    const payload = {
      name: f.name.trim(),
      itemType: f.itemType,
      sku: f.sku.trim() || undefined,
      unit: f.unit,
      hsnCode: f.hsnCode.trim() || undefined,
      description: f.description.trim() || undefined,
      purityKarat: f.purity.startsWith("karat:") ? (f.purity.slice(6) as PurityKarat) : undefined,
      metalPurityId: f.purity === NONE || f.purity === OTHER_PURITY || f.purity.startsWith("karat:") ? undefined : (f.purity as Id<"metalPurities">),
      purityOther: f.purity === OTHER_PURITY ? f.purityOther.trim() : undefined,
      defaultBoxId: isService || f.defaultBoxId === NONE ? undefined : (f.defaultBoxId as Id<"boxes">),
      stockGroupId: f.stockGroupId === NONE ? undefined : (f.stockGroupId as Id<"stockGroups">),
      stockCategoryId: f.stockCategoryId === NONE ? undefined : (f.stockCategoryId as Id<"stockCategories">),
      taxConfigurationId: f.taxConfigurationId === NONE ? undefined : (f.taxConfigurationId as Id<"taxConfigurations">),
      salePriceIncludesTax: f.saleIncTax,
      saleDiscountMode: f.discountMode,
      purchasePriceIncludesTax: showCost ? f.purchaseIncTax : undefined,
      openingAsOfMs: f.asOf ? new Date(`${f.asOf}T00:00:00`).getTime() : undefined,
      location: f.location,
      imageStorageId: f.imageStorageId,
      customFields: f.customFields,
      ...numbers,
    };
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) await update({ id: product._id, ...payload });
      else await create({ ...payload, ...opening });
      toast.success(isEdit ? `${payload.name} updated` : `${payload.name} added${opening.openingPieces ? ` · ${opening.openingPieces} pcs in stock` : ""}`);
      if (andNew && !isEdit) {
        setF(blank(undefined, defaultUnit, purities));
        setImagePreview(null);
        setTab("pricing");
      } else {
        setOpen(false);
        if (!isEdit) reset();
      }
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save this item."));
    } finally {
      setSubmitting(false);
    }
  }

  const image = imagePreview ?? (f.imageStorageId && f.imageStorageId === product?.imageStorageId ? details?.imageUrl : null);

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); else setF(blank(isEdit ? product : undefined, defaultUnit, purities)); }}>
      <DialogTrigger asChild>
        {trigger ?? (isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit item"><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="bg-[#d93025] font-medium text-white shadow-sm hover:bg-[#b3261e]"><Plus className="h-4 w-4" />Add Item</Button>
        ))}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-4 text-lg font-bold">
            {isEdit ? "Edit Item" : "Add Item"}
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className={!isService ? "text-primary" : "text-muted-foreground"}>Product</span>
              <Switch checked={isService} onCheckedChange={(c) => set("itemType", c ? "service" : "product")} aria-label="Service item" />
              <span className={isService ? "text-primary" : "text-muted-foreground"}>Service</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Item Name *" className="sm:col-span-2">
              <Input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Gold Chain 22K" />
            </Field>
            <Field label="Item HSN">
              <Input list="hsn-codes" value={f.hsnCode} onChange={(e) => set("hsnCode", e.target.value)} placeholder="Search or type HSN" />
              <datalist id="hsn-codes">
                {HSN_SUGGESTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </datalist>
            </Field>
            <Field label="Unit">
              <Select value={f.unit} onValueChange={(v) => set("unit", v as Unit)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Category">
              <Select value={f.stockCategoryId} onValueChange={(v) => set("stockCategoryId", v)}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Item Code">
              <div className="relative">
                <Input value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Item Code" className="pr-28 font-mono" />
                <Button type="button" variant="secondary" size="sm" className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2 text-xs" onClick={assignCode}>Assign Code</Button>
              </div>
            </Field>
            {!isService && (
              <>
                <Field label="Purity / Karat">
                  <Select value={f.purity} onValueChange={(v) => set("purity", v)}>
                    <SelectTrigger aria-label="Purity / Karat"><SelectValue placeholder="Purity" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={NONE}>None</SelectItem>
                      {PURITY_KARATS.map((k) => <SelectItem key={k} value={karatValue(k)}>{k.replace("K", "")} Karat ({k})</SelectItem>)}
                      {otherPurities.map((p) => <SelectItem key={p._id} value={p._id}>{p.label} ({p.metal})</SelectItem>)}
                      <SelectItem value={OTHER_PURITY}>Other…</SelectItem>
                    </SelectContent>
                  </Select>
                  {f.purity === OTHER_PURITY && (
                    <Input className="mt-1" aria-label="Other purity" value={f.purityOther} maxLength={40} onChange={(e) => set("purityOther", e.target.value)} placeholder="e.g. 916 hallmark, 23K" />
                  )}
                </Field>
                <Field label="Box Number">
                  <Select value={f.defaultBoxId} onValueChange={(v) => set("defaultBoxId", v)}>
                    <SelectTrigger aria-label="Box Number"><SelectValue placeholder="Box" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={NONE}>No box</SelectItem>
                      {boxes?.filter((b) => b.isActive || b._id === f.defaultBoxId).map((b) => (
                        <SelectItem key={b._id} value={b._id}>Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Gross wt (g)">
                  <Input inputMode="decimal" value={f.grossWeight} onChange={(e) => set("grossWeight", e.target.value)} placeholder="0.000" />
                </Field>
                <Field label="Stone wt (g)">
                  <Input inputMode="decimal" value={f.stoneWeight} onChange={(e) => set("stoneWeight", e.target.value)} placeholder="0.000" />
                </Field>
                <Field label="Net wt (g)">
                  <Input inputMode="decimal" value={f.netWeight} onChange={(e) => set("netWeight", e.target.value)} placeholder={autoNet || "0.000"} title="Leave blank to use gross − stone" />
                </Field>
              </>
            )}
            <Field label="Making (₹)">
              <Input inputMode="decimal" value={f.making} onChange={(e) => set("making", e.target.value)} placeholder="0.00" />
            </Field>
            {!isService && (
              <Field label="Wastage (%)">
                <Input inputMode="decimal" value={f.wastage} onChange={(e) => set("wastage", e.target.value)} placeholder="0" />
              </Field>
            )}
            <Field label="Stock Group">
              <Select value={f.stockGroupId} onValueChange={(v) => set("stockGroupId", v)}>
                <SelectTrigger><SelectValue placeholder="Stock Group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {groups?.map((g) => <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description" className="sm:col-span-3">
              <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Design details, stones, notes…" className="resize-none" />
            </Field>
          </div>

          <div className="flex flex-col items-center gap-2">
            {image ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL, not a static asset */}
                <img src={image} alt="Item" className="h-32 w-32 rounded-lg border object-cover" />
                <button type="button" aria-label="Remove image" onClick={() => { set("imageStorageId", undefined); setImagePreview(null); }} className="absolute -right-2 -top-2 rounded-full border bg-background p-1 shadow">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium text-primary hover:bg-muted/40">
                <ImagePlus className="h-6 w-6" />
                {uploading ? "Uploading…" : "Add Item Image"}
                <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => onImage(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
            {!isService && <TabsTrigger value="stock">Stock</TabsTrigger>}
            <TabsTrigger value="more">Additional Fields</TabsTrigger>
          </TabsList>

          <TabsContent value="pricing" className="space-y-3 pt-2">
            <section className="rounded-xl border bg-muted/20 p-4">
              <p className="mb-1 font-semibold">Sale Price</p>
              <p className="mb-3 text-xs text-muted-foreground">Price per piece filled on new bills. Leave blank to bill by today&apos;s rate per gram. Only the Owner or an Admin can change it on a bill.</p>
              <div className="flex flex-wrap gap-3">
                <PriceWithTax label="Sale Price" value={f.salePrice} onValue={(v) => set("salePrice", v)} incTax={f.saleIncTax} onIncTax={(v) => set("saleIncTax", v)} />
                <div className="flex">
                  <Input aria-label="Discount on sale price" inputMode="decimal" className="w-36 rounded-r-none" placeholder="Disc. On Sale Price" value={f.discount} onChange={(e) => set("discount", e.target.value)} />
                  <Select value={f.discountMode} onValueChange={(v) => set("discountMode", v as "percent" | "amount")}>
                    <SelectTrigger className="w-32 rounded-l-none border-l-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percentage</SelectItem>
                      <SelectItem value="amount">Amount (₹)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {f.showWholesale ? (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <Field label="Wholesale Price (₹)"><Input inputMode="decimal" value={f.wholesalePrice} onChange={(e) => set("wholesalePrice", e.target.value)} className="w-44" /></Field>
                  <Field label="Minimum Wholesale Qty"><Input inputMode="numeric" value={f.wholesaleMinQty} onChange={(e) => set("wholesaleMinQty", e.target.value)} className="w-44" /></Field>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setF((p) => ({ ...p, showWholesale: false, wholesalePrice: "", wholesaleMinQty: "" }))}>Remove</Button>
                </div>
              ) : (
                <button type="button" className="mt-3 text-sm font-semibold text-primary" onClick={() => set("showWholesale", true)}>+ Add Wholesale Price</button>
              )}
            </section>
            <div className="grid gap-3 sm:grid-cols-2">
              {showCost && (
                <section className="rounded-xl border bg-muted/20 p-4">
                  <p className="mb-1 font-semibold">Purchase Price</p>
                  <p className="mb-3 text-xs text-muted-foreground">Internal — fills purchase bills; never printed on invoices or shown at the billing counter.</p>
                  <PriceWithTax label="Purchase Price" value={f.purchasePrice} onValue={(v) => set("purchasePrice", v)} incTax={f.purchaseIncTax} onIncTax={(v) => set("purchaseIncTax", v)} />
                </section>
              )}
              <section className="rounded-xl border bg-muted/20 p-4">
                <p className="mb-3 font-semibold">Taxes</p>
                <Field label="Tax Rate">
                  <Select value={f.taxConfigurationId} onValueChange={(v) => set("taxConfigurationId", v)}>
                    <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {taxes?.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                {taxes?.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Add tax rates in <Link className="underline" href="/settings/gst">Settings → GST</Link>.</p>}
              </section>
            </div>
          </TabsContent>

          {!isService && (
            <TabsContent value="stock" className="pt-2">
              <div className="grid gap-3 sm:grid-cols-3">
                {!isEdit && (
                  <>
                    <Field label="Opening Quantity (pcs)"><Input inputMode="numeric" value={f.openingPieces} onChange={(e) => set("openingPieces", e.target.value)} /></Field>
                    {(isGstCompany || f.defaultBoxId !== NONE) && (
                      <Field label={f.defaultBoxId !== NONE ? "Opening Weight (g, if no gross wt)" : "Opening Weight (g)"}><Input inputMode="decimal" value={f.openingWeight} onChange={(e) => set("openingWeight", e.target.value)} /></Field>
                    )}
                  </>
                )}
                <Field label="At Price (₹)"><Input inputMode="decimal" value={f.atPrice} onChange={(e) => set("atPrice", e.target.value)} /></Field>
                <Field label="As Of Date"><Input type="date" value={f.asOf} onChange={(e) => set("asOf", e.target.value)} /></Field>
                <Field label="Min Stock To Maintain (g)"><Input inputMode="decimal" value={f.minStock} onChange={(e) => set("minStock", e.target.value)} /></Field>
                <Field label="Location"><Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Counter 2, Locker A" /></Field>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {isEdit
                  ? "Editing an item never adds stock or creates boxes. To change stock, use Adjust Item, a purchase, or Box Overview."
                  : f.defaultBoxId !== NONE
                    ? "Each opening piece is put into the chosen box at the item's gross/stone weight when you save."
                    : isGstCompany
                      ? "No box chosen: opening quantity and weight go into loose GST item stock. Choose a Box Number to put them in a box."
                      : "Choose a Box Number above to add opening pieces — Daily Sales stock is kept in boxes."}
              </p>
            </TabsContent>
          )}

          <TabsContent value="more" className="pt-2">
            <CustomFieldInputs entity="product" values={f.customFields} onChange={(v) => set("customFields", v)} />
            <p className="mt-2 text-xs text-muted-foreground">
              Add fields like MRP, Size, Model No. or Serial No. in <Link className="underline" href="/settings/custom-fields">Settings → Custom Fields</Link>.
            </p>
          </TabsContent>
        </Tabs>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}

        <DialogFooter className="gap-2">
          {!isEdit && (
            <Button type="button" variant="outline" disabled={submitting || uploading} onClick={() => save(true)}>Save &amp; New</Button>
          )}
          <Button type="button" disabled={submitting || uploading} onClick={() => save(false)} className="min-w-24 bg-[#1a73e8] text-white hover:bg-[#1557b0]">
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function PriceWithTax({ label, value, onValue, incTax, onIncTax }: { label: string; value: string; onValue: (v: string) => void; incTax: boolean; onIncTax: (v: boolean) => void }) {
  return (
    <div className="flex">
      <Input aria-label={label} inputMode="decimal" className="w-36 rounded-r-none" placeholder={label} value={value} onChange={(e) => onValue(e.target.value)} />
      <Select value={incTax ? "with" : "without"} onValueChange={(v) => onIncTax(v === "with")}>
        <SelectTrigger className="w-32 rounded-l-none border-l-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="without">Without Tax</SelectItem>
          <SelectItem value="with">With Tax</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Stock adjustment that really changes stock: GST item stock directly; Daily Sales points to boxes. */
export function AdjustStockDialog({ product }: { product: Doc<"products"> }) {
  const adjust = useMutation(api.itemStock.adjust);
  const access = useQuery(api.organizations.getMyAccess);
  const isGstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [weight, setWeight] = useState("");
  const [pieces, setPieces] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const weightMg = toMg(weight) ?? 0;
    const pcs = toInt(pieces) ?? 0;
    if (!Number.isFinite(weightMg) || !Number.isFinite(pcs)) return setError("Enter a valid weight and pieces.");
    setBusy(true);
    setError(null);
    try {
      await adjust({ productId: product._id, direction, weightMg, pieces: pcs, reason });
      setOpen(false);
      setWeight("");
      setPieces("");
      setReason("");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not adjust stock."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 font-medium"><Sliders className="h-3.5 w-3.5" />Adjust Item</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Stock Adjustment — {product.name}</DialogTitle></DialogHeader>
        {!isGstCompany ? (
          <div className="space-y-3 text-sm">
            <p>In the Daily Sales company, stock is kept as pieces inside boxes. Add, correct or write off pieces from the box they are in.</p>
            <div className="flex gap-2">
              <Button asChild size="sm"><Link href="/boxes">Open Box Overview</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/inventory/adjustments">Stock Adjustments</Link></Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Pieces in boxes are adjusted from their box (<Link className="underline" href="/inventory/adjustments">Stock Adjustments</Link>). This changes loose GST stock that isn&apos;t in a box.
            </p>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" variant={direction === "in" ? "default" : "outline"} onClick={() => setDirection("in")}>+ Add Stock</Button>
              <Button type="button" className="flex-1" variant={direction === "out" ? "destructive" : "outline"} onClick={() => setDirection("out")}>− Reduce Stock</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight (g)"><Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.000" /></Field>
              <Field label="Pieces"><Input inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="0" /></Field>
            </div>
            <Field label="Reason / Details"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Counter count mismatch, reweighed" /></Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save Adjustment"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
