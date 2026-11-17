"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { MessageCircle, Minus, Plus, Printer, Search, Trash2 } from "lucide-react";
import { MetalRateTicker } from "@/components/metal-rate-ticker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { computeOldGoldExchange, computeSaleLine, gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { formatPaise, percentToBasisPoints, rupeesToPaise } from "@/lib/money";
import { toast } from "@/components/toaster";

const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

/** Item-master defaults a new bill line starts from, so the operator doesn't retype saved prices. */
function lineDefaultsFromProduct(product: Doc<"products"> | undefined, fallbackTaxId: string) {
  const hasPrice = product?.sellingPricePaise !== undefined;
  return {
    sku: product?.sku,
    unitPriceRupees: hasPrice ? (product!.sellingPricePaise! / 100).toFixed(2) : "",
    savedUnitPricePaise: product?.sellingPricePaise,
    purchasePricePaise: product?.purchasePricePaise,
    // Fixed-price items already include making; rate/gram items start from the item's saved charges.
    makingChargeRupees: !hasPrice && product?.makingChargePaise ? (product.makingChargePaise / 100).toFixed(2) : "",
    wastagePercent: !hasPrice && product?.wastageBasisPoints ? (product.wastageBasisPoints / 100).toFixed(2) : "",
    taxConfigurationId: product?.taxConfigurationId ?? fallbackTaxId,
  };
}
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

type PaymentMode = (typeof PAYMENT_MODES)[number]["value"];

/** Bill dates are a plain calendar day, stored/compared as UTC midnight — matches the dashboard's "UTC calendar day" convention for daily totals. */
function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}
function timestampToDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function dateInputToTimestamp(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

/**
 * rupeesToPaise/percentToBasisPoints silently fall back to 0 on invalid input
 * (negative, non-numeric, or >100%) so the live total preview never crashes —
 * but that means a typo (e.g. wastage "150" instead of "1.50") would otherwise
 * zero itself out with no feedback and ship as a wrong bill. This surfaces
 * that as a blocking, visible error instead.
 */
function numberFieldError(raw: string, opts?: { max?: number }): string | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a valid number";
  if (n < 0) return "Cannot be negative";
  if (opts?.max !== undefined && n > opts.max) return `Cannot exceed ${opts.max}`;
  return null;
}

type BillLine = {
  /** Stable row key: the box piece id, or a generated id for a manual GST line. */
  key: string;
  /** Daily Sales: the box piece sold. Unset for a GST line typed in manually (taken from item stock). */
  boxItemId?: Id<"boxItems">;
  productId?: string;
  pieces?: number;
  boxNumber?: number;
  label: string;
  productName: string;
  grossWeightMg: number;
  stoneWeightMg: number;
  stockNetWeightMg: number;
  metalPurityId: string;
  otherDeductionGrams: string;
  ratePerGramRupees: string;
  wastagePercent: string;
  makingChargeRupees: string;
  stoneChargeRupees: string;
  taxConfigurationId: string;
  manualGstPercent?: string;
  isManualTax?: boolean;
  sku?: string;
  /** Fixed selling price per piece. "" → priced by net weight × rate per gram. */
  unitPriceRupees: string;
  /** The item master's saved selling price, to detect (and gate) an override. */
  savedUnitPricePaise?: number;
  /** Internal per-piece cost — only present for roles allowed to see it. */
  purchasePricePaise?: number;
};

/**
 * Shown once a box is matched, so an operator who finds the box empty (or
 * missing the specific piece they need) can add it right there instead of
 * leaving the bill to go fix inventory first. The new piece is added
 * straight onto the bill once saved.
 */
function QuickAddItemForm({
  boxId,
  boxNumber,
  products,
  onAdded,
}: {
  boxId: Id<"boxes">;
  boxNumber: number;
  products: Doc<"products">[];
  onAdded: (boxItem: Doc<"boxItems">, productName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [productNameInput, setProductNameInput] = useState("");
  const [label, setLabel] = useState("");
  const [grossGrams, setGrossGrams] = useState("");
  const [stoneGrams, setStoneGrams] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const quickAddItem = useMutation(api.boxes.quickAddItem);

  const term = productNameInput.trim().toLowerCase();
  const matches = term.length === 0 ? [] : products.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 6);
  const isNewProduct = !productId && productNameInput.trim().length > 0;

  function reset() {
    setProductId("");
    setProductNameInput("");
    setLabel("");
    setGrossGrams("");
    setStoneGrams("");
    setError(null);
  }

  async function handleSave() {
    setError(null);
    if (!label.trim()) {
      setError("Enter a label for this item.");
      return;
    }
    if (!productId && !productNameInput.trim()) {
      setError("Select or enter a product.");
      return;
    }
    const grossWeightMg = gramsToMg(grossGrams || "0");
    if (grossWeightMg <= 0) {
      setError("Enter a gross weight greater than zero.");
      return;
    }
    setSaving(true);
    try {
      const created = await quickAddItem({
        boxId,
        productId: productId ? (productId as Id<"products">) : undefined,
        newProductName: productId ? undefined : productNameInput.trim(),
        label: label.trim(),
        grossWeightMg,
        stoneWeightMg: gramsToMg(stoneGrams || "0"),
      });
      if (created) onAdded(created, productNameInput.trim());
      reset();
      setOpen(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not add this item."));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Item not here? Add a new piece to box {boxNumber}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New item for box {boxNumber}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="relative col-span-2">
          <Input
            placeholder="Product (type to search or add new)"
            value={productNameInput}
            onChange={(e) => {
              setProductNameInput(e.target.value);
              setProductId("");
            }}
          />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover py-1 shadow-md">
              {matches.map((p) => (
                <button
                  type="button"
                  key={p._id}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setProductId(p._id);
                    setProductNameInput(p.name);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {isNewProduct && (
            <p className="mt-1 text-xs text-muted-foreground">New product — created when you save this item.</p>
          )}
        </div>
        <Input placeholder="Label (e.g. Ring 3)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input inputMode="decimal" placeholder="Gross weight (g)" value={grossGrams} onChange={(e) => setGrossGrams(e.target.value)} />
        <Input inputMode="decimal" placeholder="Stone weight (g)" value={stoneGrams} onChange={(e) => setStoneGrams(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" size="sm" className="self-start" disabled={saving} onClick={handleSave}>
        {saving ? "Adding…" : "Add item to box and bill"}
      </Button>
    </div>
  );
}

/**
 * GST companies don't use boxes: the operator picks an item, types its
 * weight and pieces, and the sold weight is deducted from GST item stock.
 */
function ManualItemForm({ onAdd }: { onAdd: (item: { productId: string; name: string; metalPurityId?: string; grossWeightMg: number; stoneWeightMg: number; pieces: number }) => void }) {
  const stock = useQuery(api.itemStock.list);
  const products = useQuery(api.products.list);
  const [productId, setProductId] = useState("");
  const [gross, setGross] = useState("");
  const [stone, setStone] = useState("");
  const [pieces, setPieces] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const selected = stock?.find((s) => s.productId === productId);

  function add() {
    const grossWeightMg = gramsToMg(gross || "0");
    const stoneWeightMg = gramsToMg(stone || "0");
    const netWeightMg = grossWeightMg - stoneWeightMg;
    const pcs = Number(pieces || "1");
    if (!selected) return setError("Choose an item.");
    if (grossWeightMg <= 0) return setError("Enter the gross weight.");
    if (stoneWeightMg < 0) return setError("Stone weight cannot be negative.");
    if (stoneWeightMg > grossWeightMg) return setError("Stone weight cannot be more than gross weight.");
    if (!Number.isInteger(pcs) || pcs < 1) return setError("Pieces must be 1 or more.");

    const availableGross = selected.grossWeightMg ?? selected.weightMg;
    const availableNet = selected.netWeightMg ?? selected.weightMg;
    if (grossWeightMg > availableGross) {
      return setError(`Only ${mgToGramsDisplay(availableGross)} g gross weight of ${selected.name} is in GST stock.`);
    }
    if (netWeightMg > availableNet) {
      return setError(`Only ${mgToGramsDisplay(availableNet)} g net weight of ${selected.name} is in GST stock.`);
    }
    setError(null);
    const product = products?.find((p) => p._id === productId);
    onAdd({ productId, name: selected.name, metalPurityId: product?.metalPurityId, grossWeightMg, stoneWeightMg, pieces: pcs });
    setGross("");
    setStone("");
    setPieces("1");
  }

  return (
    <Card className="border-border/80 shadow-xs">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wide">Add item (GST stock)</CardTitle>
        <p className="text-xs text-muted-foreground">Pick the item and type its weight. Available stock: Gross, Stone, and Net are deducted separately from GST item stock balances.</p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 p-4 pt-0 sm:grid-cols-[2fr_1fr_1fr_0.7fr_auto] sm:items-end">
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-[10px] text-muted-foreground">Item</Label>
          <Select
            value={productId || undefined}
            onValueChange={(id) => {
              setProductId(id);
              // Start from the item's saved per-piece weights.
              const product = products?.find((p) => p._id === id);
              if (product?.grossWeightMg !== undefined) setGross((product.grossWeightMg / 1000).toFixed(3));
              if (product?.stoneWeightMg !== undefined) setStone((product.stoneWeightMg / 1000).toFixed(3));
            }}
          >
            <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder={stock === undefined ? "Loading…" : "Choose item"} /></SelectTrigger>
            <SelectContent>
              {stock?.map((s) => (
                <SelectItem key={s.productId} value={s.productId}>
                  {s.name} · Gross: {mgToGramsDisplay(s.grossWeightMg ?? s.weightMg)}g · Net: {mgToGramsDisplay(s.netWeightMg ?? s.weightMg)}g · {s.pieces} pcs
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="gst-gross" className="text-[10px] text-muted-foreground">Gross wt (g)</Label>
          <Input id="gst-gross" inputMode="decimal" placeholder="0.000" value={gross} onChange={(e) => setGross(e.target.value)} className="h-9 text-xs" />
        </div>
        <div>
          <Label htmlFor="gst-stone" className="text-[10px] text-muted-foreground">Stone wt (g)</Label>
          <Input id="gst-stone" inputMode="decimal" placeholder="0.000" value={stone} onChange={(e) => setStone(e.target.value)} className="h-9 text-xs" />
        </div>
        <div>
          <Label htmlFor="gst-pcs" className="text-[10px] text-muted-foreground">Pieces</Label>
          <Input id="gst-pcs" inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value)} className="h-9 text-xs" />
        </div>
        <Button type="button" className="h-9" onClick={add}><Plus className="h-4 w-4" />Add</Button>
        {error && <p className="col-span-2 text-xs font-medium text-destructive sm:col-span-5">{error}</p>}
        {stock?.length === 0 && <p className="col-span-2 text-xs text-muted-foreground sm:col-span-5">No items yet. Add items under Items → Item List, then add stock under Stock → GST Purpose.</p>}
      </CardContent>
    </Card>
  );
}

function BoxItemPicker({
  boxes,
  products,
  onAdd,
  alreadyAddedIds,
}: {
  boxes: Doc<"boxes">[];
  products: Doc<"products">[];
  onAdd: (boxItem: Doc<"boxItems">) => void;
  alreadyAddedIds: Set<string>;
}) {
  const [boxNumberInput, setBoxNumberInput] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const itemMatches = useQuery(api.boxes.searchItems, itemSearch.trim().length >= 2 ? { term: itemSearch } : "skip");
  const [boxListOpen, setBoxListOpen] = useState(false);
  const boxListRef = useRef<HTMLDivElement>(null);
  const matchedBox = useMemo(
    () => boxes.find((b) => String(b.boxNumber) === boxNumberInput.trim()),
    [boxes, boxNumberInput],
  );
  const items = useQuery(api.boxes.getItems, matchedBox ? { boxId: matchedBox._id } : "skip");

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => map.set(p._id, p.name));
    return map;
  }, [products]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (boxListRef.current && !boxListRef.current.contains(e.target as Node)) setBoxListOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const term = boxNumberInput.trim().toLowerCase();
  const boxMatches = (
    term.length === 0
      ? boxes
      : boxes.filter((b) => String(b.boxNumber).includes(term) || b.label?.toLowerCase().includes(term))
  )
    .slice()
    .sort((a, b) => a.boxNumber - b.boxNumber)
    .slice(0, 50);

  return (
    <Card className="!overflow-visible">
      <CardHeader>
        <CardTitle className="text-base">Add items to this bill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-item-search" className="text-xs font-semibold text-muted-foreground">Search item by name or code (all boxes)</Label>
          <div className="relative max-w-md">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="bill-item-search" className="pl-9" placeholder="e.g. Gold Ring, GR-101" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
          </div>
          {itemSearch.trim().length >= 2 && itemMatches?.length === 0 && <p className="text-xs text-muted-foreground">No in-stock item matches “{itemSearch}”.</p>}
          {itemMatches && itemMatches.length > 0 && (
            <div className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md border p-1">
              {itemMatches.map((match) => {
                const added = alreadyAddedIds.has(match.boxItemId);
                return (
                  <div key={match.boxItemId} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{match.label} <span className="text-xs font-normal text-muted-foreground">· {match.productName}</span></p>
                      <p className="text-xs text-muted-foreground">Box {match.boxNumber ?? "—"}{match.boxLabel ? ` (${match.boxLabel})` : ""} · {mgToGramsDisplay(match.netWeightMg)}g net</p>
                    </div>
                    <Button type="button" size="sm" variant={added ? "secondary" : "outline"} disabled={added} onClick={() => onAdd(match.boxItem)}>
                      {added ? "Added" : "Add"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <Label className="text-xs font-semibold text-muted-foreground">…or open a box</Label>
        <div ref={boxListRef} className="relative max-w-xs">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Enter box number, or browse all boxes"
            value={boxNumberInput}
            onChange={(e) => setBoxNumberInput(e.target.value)}
            onFocus={() => setBoxListOpen(true)}
          />
          {boxListOpen && boxMatches.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
              {boxMatches.map((b) => (
                <button
                  type="button"
                  key={b._id}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setBoxNumberInput(String(b.boxNumber));
                    setBoxListOpen(false);
                  }}
                >
                  <span>
                    Box {b.boxNumber}
                    {b.label ? ` · ${b.label}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{b.itemCount ?? 0} item{b.itemCount === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {boxNumberInput && !matchedBox && (
          <p className="text-sm text-muted-foreground">No box with that number.</p>
        )}
        {matchedBox && items === undefined && <p className="text-sm text-muted-foreground">Loading…</p>}
        {matchedBox && items && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Box {matchedBox.boxNumber} is empty.</p>
        )}
        {matchedBox && items && items.length > 0 && (
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const alreadyAdded = alreadyAddedIds.has(item._id);
              return (
                <div
                  key={item._id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {productName.get(item.productId) ?? "Product"} · {mgToGramsDisplay(item.netWeightMg)}g net
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={alreadyAdded ? "secondary" : "outline"}
                    disabled={alreadyAdded}
                    onClick={() => onAdd(item)}
                  >
                    {alreadyAdded ? "Added" : "Add"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {matchedBox && items && (
          <QuickAddItemForm boxId={matchedBox._id} boxNumber={matchedBox.boxNumber} products={products} onAdded={onAdd} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Customer name is a type-to-search-or-create field, not a plain dropdown —
 * an operator can pick an existing customer or just type a new one, with the
 * new customer only actually created in the database when the bill is
 * finalized (never on every keystroke).
 */
function CustomerPicker({
  customers,
  customerId,
  nameInput,
  phoneInput,
  onSelectExisting,
  onNameChange,
  onPhoneChange,
}: {
  customers: Doc<"customers">[];
  customerId: string;
  nameInput: string;
  phoneInput: string;
  onSelectExisting: (customer: Doc<"customers">) => void;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const term = nameInput.trim().toLowerCase();
  const matches =
    term.length === 0
      ? []
      : customers.filter((c) => c.name.toLowerCase().includes(term) || c.phone?.toLowerCase().includes(term)).slice(0, 8);
  const isNew = !customerId && nameInput.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Type a name to search, or add a new customer"
          value={nameInput}
          onChange={(e) => onNameChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover py-1 shadow-md">
          {matches.map((c) => (
            <button
              type="button"
              key={c._id}
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onSelectExisting(c);
                setOpen(false);
              }}
            >
              <span>{c.name}</span>
              {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-2">
        <Input
          placeholder="Phone number"
          inputMode="tel"
          value={phoneInput}
          disabled={!!customerId}
          onChange={(e) => onPhoneChange(e.target.value)}
        />
        {isNew && (
          <Badge variant="secondary" className="w-fit font-normal">
            New customer — saved when you finalize this bill
          </Badge>
        )}
      </div>
    </div>
  );
}

export default function NewBillPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editSaleId = searchParams.get("edit") as Id<"sales"> | null;
  const existingSale = useQuery(api.sales.getInvoiceData, editSaleId ? { saleId: editSaleId } : "skip");

  const customers = useQuery(api.customers.list);
  const access = useQuery(api.organizations.getMyAccess);
  const products = useQuery(api.products.list);
  const boxes = useQuery(api.boxes.list);
  const purities = useQuery(api.metalPurities.list);
  const taxConfigs = useQuery(api.taxConfigurations.list);
  const currentRates = useQuery(api.metalRates.getCurrent);
  const createSale = useMutation(api.sales.create);
  const updateSale = useMutation(api.sales.update);
  const createCustomer = useMutation(api.customers.create);
  const createTaxConfig = useMutation(api.taxConfigurations.create);
  const pricing = useQuery(api.products.myPricingAccess);
  const showCost = pricing?.canViewCost ?? false;
  const canOverride = pricing?.canOverridePrice ?? false;

  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [billDate, setBillDate] = useState(() => todayDateInput());
  const [customerId, setCustomerId] = useState("");
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [customerPhoneInput, setCustomerPhoneInput] = useState("");
  const [isGst, setIsGst] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [oldItemDeductionRupees, setOldItemDeductionRupees] = useState("0");
  const [oldItemEnabled, setOldItemEnabled] = useState(false);
  const [oldItemDeductionNote, setOldItemDeductionNote] = useState("");
  // No discount on new bills. A discount already saved on an older bill is kept
  // (read-only) when that bill is edited, so its total doesn't silently change.
  const [legacyDiscountPaise, setLegacyDiscountPaise] = useState(0);
  const [payments, setPayments] = useState<{ mode: PaymentMode; amountRupees: string }[]>([
    { mode: "cash", amountRupees: "" },
  ]);
  const [oldGoldEnabled, setOldGoldEnabled] = useState(false);
  const [oldGoldPurityId, setOldGoldPurityId] = useState("");
  const [oldGoldGrossGrams, setOldGoldGrossGrams] = useState("");
  const [oldGoldMeltingPercent, setOldGoldMeltingPercent] = useState("");
  const [oldGoldRateRupees, setOldGoldRateRupees] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isCredit, setIsCredit] = useState(false);
  const [partiesDialogOpen, setPartiesDialogOpen] = useState(false);
  const [partySearch, setPartySearch] = useState("");
  const [stateOfSupply, setStateOfSupply] = useState("Karnataka");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const gstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the company type once it loads; the operator can still toggle.
    if (!editSaleId) setIsGst(gstCompany);
  }, [editSaleId, gstCompany]);
  const companyState = access?.organization?.state;
  useEffect(() => {
    // Default place of supply = the company's own state (intra-state → CGST + SGST).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default once the company loads.
    if (!editSaleId && companyState) setStateOfSupply(companyState);
  }, [editSaleId, companyState]);

  // One-time prefill once the existing invoice loads, in edit mode — guarded
  // by `prefilled` so it never re-runs after the user starts editing.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!editSaleId || !existingSale || !products || prefilled) return;
    const { sale, items, customer, oldGoldExchange, payments: existingPayments } = existingSale;
    setInvoiceNumber(sale.invoiceNumber);
    setBillDate(timestampToDateInput(sale.createdAt));
    setCustomerId(sale.customerId);
    setCustomerNameInput(customer?.name ?? "");
    setCustomerPhoneInput(customer?.phone ?? "");
    setIsGst(sale.isGst);
    setOldItemDeductionRupees(((sale.oldItemDeductionPaise ?? 0) / 100).toFixed(2));
    setOldItemEnabled((sale.oldItemDeductionPaise ?? 0) > 0);
    setOldItemDeductionNote(sale.oldItemDeductionNote ?? "");
    setLines(
      items.map((item) => ({
        key: item.boxItemId ?? item._id,
        boxItemId: item.boxItemId,
        productId: item.fromItemStock ? item.productId : undefined,
        pieces: item.pieces,
        label: item.label,
        productName: item.productName,
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
        stockNetWeightMg: item.stockNetWeightMg ?? Math.max(0, item.grossWeightMg - item.stoneWeightMg),
        metalPurityId: item.metalPurityId ?? "",
        otherDeductionGrams: item.otherDeductionMg ? (item.otherDeductionMg / 1000).toFixed(3) : "",
        ratePerGramRupees: (item.ratePerGramPaise / 100).toFixed(2),
        wastagePercent: item.wastageBasisPoints ? (item.wastageBasisPoints / 100).toFixed(2) : "",
        makingChargeRupees: item.makingChargePaise ? (item.makingChargePaise / 100).toFixed(2) : "",
        stoneChargeRupees: item.stoneChargePaise ? (item.stoneChargePaise / 100).toFixed(2) : "",
        taxConfigurationId: item.taxConfigurationId ?? "",
        boxNumber: item.boxNumber,
        sku: item.sku,
        unitPriceRupees: item.unitPricePaise ? (item.unitPricePaise / 100).toFixed(2) : "",
        savedUnitPricePaise: products?.find((p) => p._id === item.productId)?.sellingPricePaise,
        purchasePricePaise: products?.find((p) => p._id === item.productId)?.purchasePricePaise,
      })),
    );
    setLegacyDiscountPaise(sale.discountPaise);
    if (sale.stateOfSupply) setStateOfSupply(sale.stateOfSupply);
    const nonExchangePayments = existingPayments.filter((p) => p.mode !== "old_gold_exchange");
    if (nonExchangePayments.length > 0) {
      setPayments(
        nonExchangePayments.map((p) => ({
          mode: p.mode as PaymentMode,
          amountRupees: (p.amountPaise / 100).toFixed(2),
        })),
      );
    }
    if (oldGoldExchange) {
      setOldGoldEnabled(true);
      setOldGoldPurityId(oldGoldExchange.metalPurityId);
      setOldGoldGrossGrams((oldGoldExchange.grossWeightMg / 1000).toFixed(3));
      setOldGoldMeltingPercent((oldGoldExchange.meltingDeductionBasisPoints / 100).toFixed(2));
      setOldGoldRateRupees((oldGoldExchange.ratePerGramPaise / 100).toFixed(2));
    }
    setPrefilled(true);
  }, [editSaleId, existingSale, prefilled, products]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const productById = useMemo(() => {
    const map = new Map<string, Doc<"products">>();
    products?.forEach((p) => map.set(p._id, p));
    return map;
  }, [products]);

  const rateByPurity = useMemo(() => {
    const map = new Map<string, number>();
    currentRates?.forEach(({ purity, latest }) => {
      if (latest) map.set(purity._id, latest.ratePerGramPaise);
    });
    return map;
  }, [currentRates]);

  function selectExistingCustomer(customer: Doc<"customers">) {
    setCustomerId(customer._id);
    setCustomerNameInput(customer.name);
    setCustomerPhoneInput(customer.phone ?? "");
  }

  function handleCustomerNameChange(value: string) {
    setCustomerNameInput(value);
    setCustomerId("");
  }

  /** Auto-fills the existing customer the moment the typed phone number matches one on file, so the operator doesn't end up creating a duplicate. */
  function handleCustomerPhoneChange(value: string) {
    setCustomerPhoneInput(value);
    const match = customers?.find((c) => c.phone && c.phone === value.trim());
    if (match) selectExistingCustomer(match);
  }

  /**
   * `productNameOverride` covers the quick-add path: the product we just
   * created via `boxes.quickAddItem` may not have reached this component's
   * reactive `products` query yet by the time its callback runs, so
   * `productById` can still be a stale snapshot — pass the name we already
   * know instead of trusting that lookup.
   */
  /** Mirrors how a sale line's rate defaults from today's metal rate — without this, the rate field was the one thing operators had to look up and type themselves, and leaving it blank blocks the whole bill rather than failing quietly. */
  function handleOldGoldPurityChange(purityId: string) {
    setOldGoldPurityId(purityId);
    if (!oldGoldRateRupees) {
      const defaultRatePaise = rateByPurity.get(purityId);
      if (defaultRatePaise) setOldGoldRateRupees((defaultRatePaise / 100).toFixed(2));
    }
  }

  function addLine(boxItem: Doc<"boxItems">, productNameOverride?: string) {
    const product = productById.get(boxItem.productId);
    const purityId = product?.metalPurityId ?? "";
    const defaultRatePaise = purityId ? rateByPurity.get(purityId) : undefined;
    const box = boxes?.find((b) => b._id === boxItem.boxId);
    setLines((prev) => [
      ...prev,
      {
        key: boxItem._id,
        boxItemId: boxItem._id,
        boxNumber: box?.boxNumber,
        label: boxItem.label,
        productName: productNameOverride ?? product?.name ?? "Product",
        grossWeightMg: boxItem.grossWeightMg,
        stoneWeightMg: boxItem.stoneWeightMg,
        stockNetWeightMg: boxItem.netWeightMg,
        metalPurityId: purityId,
        otherDeductionGrams: "",
        ratePerGramRupees: defaultRatePaise ? (defaultRatePaise / 100).toFixed(2) : "",
        stoneChargeRupees: "",
        ...lineDefaultsFromProduct(product, taxConfigs?.[0]?._id ?? ""),
      },
    ]);
  }

  function addManualLine(item: { productId: string; name: string; metalPurityId?: string; grossWeightMg: number; stoneWeightMg: number; pieces: number }) {
    const purityId = item.metalPurityId ?? "";
    const defaultRatePaise = purityId ? rateByPurity.get(purityId) : undefined;
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: item.productId,
        pieces: item.pieces,
        label: item.name,
        productName: "GST stock",
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
        stockNetWeightMg: item.grossWeightMg - item.stoneWeightMg,
        metalPurityId: purityId,
        otherDeductionGrams: "",
        ratePerGramRupees: defaultRatePaise ? (defaultRatePaise / 100).toFixed(2) : "",
        stoneChargeRupees: "",
        ...lineDefaultsFromProduct(productById.get(item.productId), taxConfigs?.[0]?._id ?? ""),
      },
    ]);
  }

  function updateLine(index: number, patch: Partial<BillLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const computedLines = useMemo(
    () =>
      lines.map((line) => {
        const taxConfig = taxConfigs?.find((t) => t._id === line.taxConfigurationId);
        let gstBasisPoints = 0;
        if (isGst) {
          if (line.isManualTax && line.manualGstPercent) {
            gstBasisPoints = percentToBasisPoints(line.manualGstPercent) ?? 0;
          } else if (taxConfig) {
            gstBasisPoints =
              taxConfig.cgstBasisPoints + taxConfig.sgstBasisPoints + taxConfig.igstBasisPoints;
          }
        }
        return computeSaleLine({
          grossWeightMg: line.grossWeightMg,
          stoneWeightMg: line.stoneWeightMg,
          stockNetWeightMg: line.stockNetWeightMg,
          otherDeductionMg: Math.round(Number(line.otherDeductionGrams || "0") * 1000) || 0,
          ratePerGramPaise: rupeesToPaise(line.ratePerGramRupees || "0") ?? 0,
          wastageBasisPoints: percentToBasisPoints(line.wastagePercent || "0") ?? 0,
          makingChargePaise: rupeesToPaise(line.makingChargeRupees || "0") ?? 0,
          stoneChargePaise: rupeesToPaise(line.stoneChargeRupees || "0") ?? 0,
          gstBasisPoints,
          unitPricePaise: line.unitPriceRupees.trim() ? rupeesToPaise(line.unitPriceRupees) ?? 0 : 0,
          pieces: line.pieces ?? 1,
        });
      }),
    [lines, taxConfigs, isGst],
  );

  const lineErrors = useMemo(
    () =>
      lines.map((line, index) => {
        const fixed = line.unitPriceRupees.trim().length > 0;
        const checks: [string, string | null][] = [
          ["Other deduction", numberFieldError(line.otherDeductionGrams, { max: line.stockNetWeightMg / 1000 })],
          ["Selling price", fixed ? numberFieldError(line.unitPriceRupees) : null],
          ["Rate/g", fixed ? null : numberFieldError(line.ratePerGramRupees)],
          ["Wastage %", numberFieldError(line.wastagePercent, { max: 100 })],
          ["Making charge", numberFieldError(line.makingChargeRupees)],
          ["Stone charge", numberFieldError(line.stoneChargeRupees)],
        ];
        const failed = checks.find(([, error]) => error);
        if (failed) return `${line.label} — ${failed[0]}: ${failed[1]}`;
        const billedPaise = fixed ? rupeesToPaise(line.unitPriceRupees) ?? 0 : 0;
        if (!fixed && !(Number(line.ratePerGramRupees) > 0)) return `${line.label} — enter the rate per gram.`;
        if (fixed && billedPaise <= 0) return `${line.label} — enter the selling price.`;
        const overridden = line.savedUnitPricePaise !== undefined ? billedPaise !== line.savedUnitPricePaise : fixed;
        if (overridden && !canOverride) {
          return line.savedUnitPricePaise !== undefined
            ? `${line.label} — only the Owner or an Admin can change the saved selling price (${formatPaise(line.savedUnitPricePaise)}).`
            : `${line.label} — has no saved selling price; bill it by rate per gram.`;
        }
        const computed = computedLines[index];
        if (computed?.netWeightMg === 0 && computed.lineTotalPaise === 0) {
          return "This item has zero net weight and zero value. Check its box stock weight and deductions before billing.";
        }
        return null;
      }),
    [lines, computedLines, canOverride],
  );

  const paymentErrors = useMemo(() => payments.map((p) => numberFieldError(p.amountRupees)), [payments]);

  const oldGoldComputed = useMemo(() => {
    if (!oldGoldEnabled) return null;
    return computeOldGoldExchange({
      grossWeightMg: gramsToMg(oldGoldGrossGrams || "0"),
      meltingDeductionBasisPoints: percentToBasisPoints(oldGoldMeltingPercent || "0") ?? 0,
      ratePerGramPaise: rupeesToPaise(oldGoldRateRupees || "0") ?? 0,
    });
  }, [oldGoldEnabled, oldGoldGrossGrams, oldGoldMeltingPercent, oldGoldRateRupees]);

  const oldGoldError = useMemo(() => {
    if (!oldGoldEnabled) return null;
    return (
      numberFieldError(oldGoldGrossGrams) ||
      numberFieldError(oldGoldMeltingPercent, { max: 100 }) ||
      numberFieldError(oldGoldRateRupees)
    );
  }, [oldGoldEnabled, oldGoldGrossGrams, oldGoldMeltingPercent, oldGoldRateRupees]);

  const totals = useMemo(() => {
    const subtotalPaise = computedLines.reduce((sum, l) => sum + l.taxableValuePaise, 0);
    const taxPaise = computedLines.reduce((sum, l) => sum + l.lineTaxPaise, 0);
    const discountPaise = Math.min(legacyDiscountPaise, subtotalPaise);
    const costPaise = lines.reduce((sum, l) => (l.purchasePricePaise === undefined ? sum : sum + l.purchasePricePaise * (l.pieces ?? 1)), 0);
    const costKnown = lines.length > 0 && lines.every((l) => l.purchasePricePaise !== undefined);
    const beforeOldItemDeductionPaise = subtotalPaise - discountPaise + taxPaise;
    const oldItemDeductionPaise = rupeesToPaise(oldItemDeductionRupees || "0") ?? 0;
    const preRound = beforeOldItemDeductionPaise - oldItemDeductionPaise;
    const roundedTotal = preRound;
    const roundOffPaise = 0;
    const paymentsPaise = payments.reduce((sum, p) => sum + (rupeesToPaise(p.amountRupees || "0") ?? 0), 0);
    const oldGoldValuePaise = oldGoldComputed?.exchangeValuePaise ?? 0;
    const amountPaidPaise = paymentsPaise + oldGoldValuePaise;
    return {
      subtotalPaise,
      taxPaise,
      discountPaise,
      marginPaise: costKnown ? subtotalPaise - discountPaise - costPaise : null,
      oldItemDeductionPaise,
      beforeOldItemDeductionPaise,
      roundOffPaise,
      totalPaise: roundedTotal,
      oldGoldValuePaise,
      amountPaidPaise,
      balancePaise: roundedTotal - amountPaidPaise,
    };
  }, [computedLines, lines, legacyDiscountPaise, oldItemDeductionRupees, payments, oldGoldComputed]);

  const oldItemDeductionError =
    numberFieldError(oldItemDeductionRupees) ??
    (totals.oldItemDeductionPaise > totals.beforeOldItemDeductionPaise
      ? "Cannot exceed the bill amount."
      : null);

  /** Clears the form back to a blank bill so the operator can keep billing the next customer without leaving the page. */
  function resetForm() {
    setIdempotencyKey(crypto.randomUUID());
    setBillDate(todayDateInput());
    setCustomerId("");
    setCustomerNameInput("");
    setCustomerPhoneInput("");
    setLines([]);
    setOldItemDeductionRupees("0");
    setOldItemEnabled(false);
    setOldItemDeductionNote("");
    setLegacyDiscountPaise(0);
    setPayments([{ mode: "cash", amountRupees: "" }]);
    setOldGoldEnabled(false);
    setOldGoldPurityId("");
    setOldGoldGrossGrams("");
    setOldGoldMeltingPercent("");
    setOldGoldRateRupees("");
  }

  async function finalizeSale(after: "view" | "print" | "printShare" | "new") {
    setServerError(null);
    if (!customerId && !customerNameInput.trim()) {
      setServerError("Select or enter a customer.");
      return;
    }
    if (lines.length === 0) {
      setServerError("Add at least one item.");
      return;
    }
    const firstLineError = lineErrors.find(Boolean);
    if (firstLineError) {
      setServerError(firstLineError);
      return;
    }
    if (oldItemDeductionError) {
      setServerError(`Old item deduction: ${oldItemDeductionError}`);
      return;
    }
    const firstPaymentError = paymentErrors.find(Boolean);
    if (firstPaymentError) {
      setServerError(`Payment amount: ${firstPaymentError}`);
      return;
    }
    if (oldGoldEnabled && oldGoldError) {
      setServerError(`Old gold exchange: ${oldGoldError}`);
      return;
    }
    if (oldGoldEnabled && (!oldGoldPurityId || !oldGoldComputed || oldGoldComputed.grossWeightMg <= 0 || oldGoldComputed.ratePerGramPaise <= 0)) {
      setServerError("Fill in the old gold purity, weight and rate, or turn off old gold exchange.");
      return;
    }
    setSubmitting(true);
    try {
      const resolvedCustomerId = customerId
        ? (customerId as Id<"customers">)
        : await createCustomer({
            name: customerNameInput.trim(),
            phone: customerPhoneInput.trim() || undefined,
            customerType: "cash",
          });

      const items = await Promise.all(
        lines.map(async (line) => {
          let taxConfigId: Id<"taxConfigurations"> | undefined = undefined;
          if (isGst) {
            if (line.isManualTax && line.manualGstPercent) {
              const manualBp = percentToBasisPoints(line.manualGstPercent) ?? 0;
              const match = taxConfigs?.find(
                (t) => t.cgstBasisPoints + t.sgstBasisPoints + t.igstBasisPoints === manualBp,
              );
              if (match) {
                taxConfigId = match._id;
              } else {
                const half = Math.floor(manualBp / 2);
                taxConfigId = await createTaxConfig({
                  name: `GST ${line.manualGstPercent}%`,
                  cgstBasisPoints: half,
                  sgstBasisPoints: manualBp - half,
                  igstBasisPoints: 0,
                });
              }
            } else if (line.taxConfigurationId) {
              taxConfigId = line.taxConfigurationId as Id<"taxConfigurations">;
            }
          }
          return {
            boxItemId: line.boxItemId,
            ...(line.boxItemId
              ? {}
              : { productId: line.productId as Id<"products">, grossWeightMg: line.grossWeightMg, stoneWeightMg: line.stoneWeightMg, pieces: line.pieces ?? 1 }),
            metalPurityId: line.metalPurityId
              ? (line.metalPurityId as Id<"metalPurities">)
              : undefined,
            otherDeductionMg: Math.round(Number(line.otherDeductionGrams || "0") * 1000) || 0,
            ratePerGramPaise: rupeesToPaise(line.ratePerGramRupees || "0") ?? 0,
            wastageBasisPoints: percentToBasisPoints(line.wastagePercent || "0") ?? 0,
            makingChargePaise: rupeesToPaise(line.makingChargeRupees || "0") ?? 0,
            stoneChargePaise: rupeesToPaise(line.stoneChargeRupees || "0") ?? 0,
            taxConfigurationId: taxConfigId,
            unitPricePaise: line.unitPriceRupees.trim() ? rupeesToPaise(line.unitPriceRupees) ?? 0 : undefined,
          };
        }),
      );
      // New bills never carry a discount; an edited older bill keeps the one it was saved with.
      const discountMode: "fixed" | "none" = legacyDiscountPaise > 0 ? "fixed" : "none";
      const discountValuePaiseOrBp = legacyDiscountPaise;
      const oldItemDeductionPaise = rupeesToPaise(oldItemDeductionRupees || "0") ?? 0;
      const paymentSplits = payments
        .filter((p) => Number(p.amountRupees) > 0)
        .map((p) => ({ mode: p.mode, amountPaise: rupeesToPaise(p.amountRupees) ?? 0 }));
      const oldGoldExchangeArg =
        oldGoldEnabled && oldGoldPurityId
          ? {
              metalPurityId: oldGoldPurityId as Id<"metalPurities">,
              grossWeightMg: gramsToMg(oldGoldGrossGrams || "0"),
              meltingDeductionBasisPoints: percentToBasisPoints(oldGoldMeltingPercent || "0") ?? 0,
              ratePerGramPaise: rupeesToPaise(oldGoldRateRupees || "0") ?? 0,
            }
          : undefined;

      if (editSaleId) {
        await updateSale({
          invoiceNumber,
          saleId: editSaleId,
          customerId: resolvedCustomerId,
          isGst,
          items,
          discountMode,
          discountValue: discountValuePaiseOrBp,
          stateOfSupply: isGst ? stateOfSupply : undefined,
          oldItemDeductionPaise,
          oldItemDeductionNote: oldItemDeductionNote.trim() || undefined,
          payments: paymentSplits,
          oldGoldExchange: oldGoldExchangeArg,
          billDate: dateInputToTimestamp(billDate),
        });
        toast.success("Bill updated");
        router.push(`/sales/invoices?updated=${editSaleId}`);
        return;
      }

      const result = await createSale({
        invoiceNumber: invoiceNumber.trim() || undefined,
        customerId: resolvedCustomerId,
        isGst,
        items,
        discountMode,
        discountValue: discountValuePaiseOrBp,
        stateOfSupply: isGst ? stateOfSupply : undefined,
        oldItemDeductionPaise,
        oldItemDeductionNote: oldItemDeductionNote.trim() || undefined,
        payments: paymentSplits,
        oldGoldExchange: oldGoldExchangeArg,
        billDate: dateInputToTimestamp(billDate),
        idempotencyKey,
      });
      toast.success(`Bill saved · ${lines.length} item${lines.length === 1 ? "" : "s"} · ${formatPaise(totals.totalPaise)}`);
      if (after === "print") {
        router.push(`/sales/invoices/${result.saleId}/print`);
      } else if (after === "printShare") {
        router.push(`/sales/invoices/${result.saleId}/print?autoShare=1`);
      } else if (after === "new") {
        resetForm();
      } else {
        router.push(`/sales/invoices?created=${result.saleId}`);
      }
    } catch (e) {
      setServerError(
        getUserErrorMessage(e, "Could not save the bill. You may need Billing Operator access, or an item may already be sold."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // F2/F3/F4 mirror the counter-staff shortcuts shops expect from billing software: print, save-and-move-to-next-customer, share.
  useEffect(() => {
    if (editSaleId) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "F2" && e.key !== "F3" && e.key !== "F4") return;
      e.preventDefault();
      if (submitting) return;
      if (e.key === "F2") void finalizeSale("print");
      else if (e.key === "F3") void finalizeSale("new");
      else void finalizeSale("printShare");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!customers || !products || !boxes || !purities || !taxConfigs || (editSaleId && !prefilled)) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{editSaleId ? "Edit Bill" : "New Bill"}</h1>
          <p className="text-sm text-muted-foreground">
            Pick items straight out of a box, see every charge live, and finalize the sale.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{editSaleId ? "Edit Bill" : "New Bill"}</h1>
        <p className="text-sm text-muted-foreground">
          {editSaleId
            ? "Editing reverses the original stock and ledger effects, then reapplies the corrected ones."
            : "Pick items straight out of a box, see every charge live, and finalize the sale."}
        </p>
      </div>

      <MetalRateTicker currentRates={currentRates} />

      <>
        {/* Vyapar Sale Header Tabs matching Page 17 */}
        <div className="flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-2 rounded-t-lg border-t border-l border-r bg-card px-3 py-1.5 text-xs font-semibold shadow-xs">
              <span>Sale #1</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={resetForm}
                title="Reset bill"
              >
                ×
              </button>
            </div>
            <button
              type="button"
              className="h-6 w-6 rounded border border-dashed flex items-center justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={resetForm}
              title="New sale tab"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Credit / Cash Toggle matching Page 17 */}
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1 text-xs">
              <span className={`font-semibold ${isCredit ? "text-primary" : "text-muted-foreground"}`}>
                Credit
              </span>
              <Switch
                checked={!isCredit}
                onCheckedChange={(checked) => setIsCredit(!checked)}
              />
              <span className={`font-semibold ${!isCredit ? "text-primary" : "text-muted-foreground"}`}>
                Cash
              </span>
            </div>

            {/* Daily Sales vs GST Toggle */}
            <div className="flex items-center gap-1.5">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isGst
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                }`}
              >
                {isGst ? "GST Tax Invoice" : "Daily Sales · Counter"}
              </span>
              {!gstCompany && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-muted-foreground underline"
                  onClick={() => setIsGst(!isGst)}
                >
                  Switch to {isGst ? "Daily Sales" : "GST Invoice"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Vyapar Customer & Invoice Metadata Card (Page 17) */}
        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-4 sm:p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Left Column: Party Details */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Billing Name (Optional)
                  </Label>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs font-bold text-primary"
                    onClick={() => setPartiesDialogOpen(true)}
                  >
                    SHOW PARTIES
                  </Button>
                </div>
                <CustomerPicker
                  customers={customers ?? []}
                  customerId={customerId}
                  nameInput={customerNameInput}
                  phoneInput={customerPhoneInput}
                  onSelectExisting={selectExistingCustomer}
                  onNameChange={handleCustomerNameChange}
                  onPhoneChange={handleCustomerPhoneChange}
                />
              </div>

              {/* Right Column: Invoice Number, Date, State */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Invoice Number
                  </Label>
                  <Input
                    aria-label="Invoice serial number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={18}
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value.replace(/\D/g, ""))}
                    placeholder="Auto or #5"
                    className="h-9 text-xs font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Invoice Date
                  </Label>
                  <Input
                    type="date"
                    className="h-9 text-xs"
                    value={billDate}
                    max={todayDateInput()}
                    onChange={(e) => setBillDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    State of Supply
                  </Label>
                  <Select value={stateOfSupply} onValueChange={setStateOfSupply}>
                    <SelectTrigger className="h-9 text-xs font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {[...new Set([...INDIAN_STATES, stateOfSupply])].map((state) => (
                        <SelectItem key={state} value={state}>{state}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isGst && (
                    <p className="text-[10px] text-muted-foreground">
                      {companyState && stateOfSupply.trim().toLowerCase() !== companyState.trim().toLowerCase() ? "Inter-state: IGST" : "Intra-state: CGST + SGST"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dialog for SHOW PARTIES */}
        <Dialog open={partiesDialogOpen} onOpenChange={setPartiesDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-bold">Select Party</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Search party by name or phone..."
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                className="h-9 text-xs"
              />
              <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
                {customers
                  ?.filter(
                    (c) =>
                      c.name.toLowerCase().includes(partySearch.toLowerCase()) ||
                      c.phone?.includes(partySearch),
                  )
                  .map((c) => (
                    <button
                      key={c._id}
                      type="button"
                      onClick={() => {
                        selectExistingCustomer(c);
                        setPartiesDialogOpen(false);
                      }}
                      className="w-full p-2.5 text-left hover:bg-muted/40 transition flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{c.name}</p>
                        <p className="text-muted-foreground">{c.phone || "No phone"}</p>
                      </div>
                      <span className="font-semibold text-primary tabular-nums">
                        {formatPaise(c.currentBalancePaise ?? c.openingBalancePaise ?? 0)}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Daily Sales: pick pieces from boxes. GST company: type items in manually from GST item stock. */}
        {gstCompany ? (
          <ManualItemForm onAdd={addManualLine} />
        ) : (
          <BoxItemPicker
            boxes={boxes}
            products={products}
            onAdd={addLine}
            alreadyAddedIds={new Set(lines.flatMap((l) => (l.boxItemId ? [l.boxItemId] : [])))}
          />
        )}

        {/* Vyapar Items Table matching Page 17 */}
        <Card className="border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="p-4 border-b bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-wide">
                Items in this bill ({lines.length})
              </CardTitle>
              {lines.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lines.reduce((s, l) => s + (l.pieces ?? 1), 0)} pcs · Gross {mgToGramsDisplay(lines.reduce((s, l) => s + l.grossWeightMg, 0))}g · Stone {mgToGramsDisplay(lines.reduce((s, l) => s + l.stoneWeightMg, 0))}g · Net {mgToGramsDisplay(computedLines.reduce((s, c) => s + (c?.netWeightMg ?? 0), 0))}g
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {gstCompany
                ? "Selling deducts gross, stone, and net stock independently from GST item balances."
                : "Selling deducts pieces, gross, and net weight straight from the assigned physical box."}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {lines.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <p>{gstCompany ? "No items added yet. Choose an item above and enter its weight." : "No items added yet. Pick an item from a box above or add a new piece to a box."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="py-2.5 px-2 w-6">#</th>
                      <th className="py-2.5 px-2">Item Name</th>
                      <th className="py-2.5 px-2">Box No</th>
                      <th className="py-2.5 px-2">Purity</th>
                      <th className="py-2.5 px-2 text-right">Gross Wt</th>
                      <th className="py-2.5 px-2 text-right">Net Wt</th>
                      <th className="py-2.5 px-2 text-right">Stone Wt</th>
                      {showCost && <th className="py-2.5 px-2 text-right" title="Internal cost — never printed on the invoice">Purchase Price</th>}
                      <th className="py-2.5 px-2">Selling Price</th>
                      <th className="py-2.5 px-2 text-center">Qty</th>
                      {isGst && <th className="py-2.5 px-2">GST</th>}
                      <th className="py-2.5 px-2 text-right">Total</th>
                      <th className="py-2.5 px-2 text-center w-10"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lines.map((line, index) => {
                      const computed = computedLines[index];
                      const error = lineErrors[index];
                      const fixed = line.unitPriceRupees.trim().length > 0;
                      const billedPaise = fixed ? rupeesToPaise(line.unitPriceRupees) ?? 0 : 0;
                      const overridden = line.savedUnitPricePaise !== undefined ? billedPaise !== line.savedUnitPricePaise : fixed;
                      const purityLabel = purities?.find((p) => p._id === line.metalPurityId)?.label;
                      const pieces = line.pieces ?? 1;
                      return (
                        <tr key={line.key} className={`align-top hover:bg-muted/20 ${error ? "bg-destructive/5" : ""}`}>
                          <td className="py-2.5 px-2 font-mono text-muted-foreground">{index + 1}</td>
                          <td className="py-2.5 px-2 min-w-40">
                            <p className="font-semibold text-foreground">{line.label}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {line.productName}
                              {line.sku ? ` · ${line.sku}` : ""}
                            </p>
                            {error && <p className="mt-1 max-w-56 text-[11px] font-medium text-destructive">{error}</p>}
                          </td>
                          <td className="py-2.5 px-2 font-semibold">{line.boxNumber ?? <span className="font-normal text-muted-foreground">{line.boxItemId ? "—" : "Item stock"}</span>}</td>
                          <td className="py-2.5 px-2">
                            {purityLabel ? (
                              <Badge className="border-amber-500/30 bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300">{purityLabel}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono">{mgToGramsDisplay(line.grossWeightMg)}g</td>
                          <td className="py-2.5 px-2 text-right font-mono font-medium text-emerald-600">
                            {computed ? `${mgToGramsDisplay(computed.netWeightMg)}g` : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-muted-foreground">{mgToGramsDisplay(line.stoneWeightMg)}g</td>
                          {showCost && (
                            <td className="py-2.5 px-2 text-right font-mono text-muted-foreground">
                              {line.purchasePricePaise !== undefined ? formatPaise(line.purchasePricePaise) : "—"}
                            </td>
                          )}
                          <td className="py-2.5 px-2">
                            {fixed || line.savedUnitPricePaise !== undefined ? (
                              <div className="flex flex-col gap-1">
                                <Input
                                  aria-label={`Selling price for ${line.label}`}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  value={line.unitPriceRupees}
                                  disabled={!canOverride}
                                  title={canOverride ? "Change the price for this bill (recorded in the audit log)" : "Only the Owner or an Admin can change a saved price"}
                                  onChange={(e) => updateLine(index, { unitPriceRupees: e.target.value })}
                                  className="h-8 w-28 text-xs font-mono text-right"
                                />
                                <span className="text-[10px] text-muted-foreground">per piece</span>
                                {overridden && line.savedUnitPricePaise !== undefined && (
                                  <span className="text-[10px] font-semibold text-amber-600">Changed from {formatPaise(line.savedUnitPricePaise)}</span>
                                )}
                              </div>
                            ) : (
                              <div className="grid grid-cols-[auto_auto] items-center gap-x-1.5 gap-y-1">
                                <span className="text-[10px] text-muted-foreground">Rate/g</span>
                                <Input
                                  aria-label={`Rate per gram for ${line.label}`}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  value={line.ratePerGramRupees}
                                  onChange={(e) => updateLine(index, { ratePerGramRupees: e.target.value })}
                                  className="h-7 w-24 text-xs font-mono text-right"
                                />
                                <span className="text-[10px] text-muted-foreground">Making ₹</span>
                                <Input
                                  aria-label={`Making charge for ${line.label}`}
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={line.makingChargeRupees}
                                  onChange={(e) => updateLine(index, { makingChargeRupees: e.target.value })}
                                  className="h-7 w-24 text-xs text-right"
                                />
                                <span className="text-[10px] text-muted-foreground">Wastage %</span>
                                <Input
                                  aria-label={`Wastage for ${line.label}`}
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={line.wastagePercent}
                                  onChange={(e) => updateLine(index, { wastagePercent: e.target.value })}
                                  className="h-7 w-24 text-xs text-right"
                                />
                              </div>
                            )}
                            {canOverride && line.savedUnitPricePaise === undefined && (
                              <button
                                type="button"
                                className="mt-1 text-[10px] text-primary underline-offset-2 hover:underline"
                                onClick={() => updateLine(index, { unitPriceRupees: fixed ? "" : computed ? (computed.taxableValuePaise / pieces / 100).toFixed(2) : "" })}
                              >
                                {fixed ? "Bill by rate/g" : "Set fixed price"}
                              </button>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center font-medium">{pieces}</td>
                          {isGst && (
                            <td className="py-2.5 px-2">
                              <div className="flex items-center gap-1.5">
                                <Select
                                  value={line.isManualTax ? "manual" : line.taxConfigurationId || "none"}
                                  onValueChange={(val) => {
                                    if (val === "manual") {
                                      updateLine(index, { isManualTax: true, manualGstPercent: "3.0" });
                                    } else if (val === "none") {
                                      updateLine(index, { isManualTax: false, taxConfigurationId: "" });
                                    } else {
                                      updateLine(index, { isManualTax: false, taxConfigurationId: val });
                                    }
                                  }}
                                >
                                  <SelectTrigger className="h-8 w-28 text-[11px]" aria-label={`GST for ${line.label}`}>
                                    <SelectValue placeholder="Tax" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">0% (Nil)</SelectItem>
                                    {taxConfigs?.map((t) => (
                                      <SelectItem key={t._id} value={t._id}>
                                        {t.name}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="manual">Manual GST...</SelectItem>
                                  </SelectContent>
                                </Select>
                                {line.isManualTax && (
                                  <Input
                                    inputMode="decimal"
                                    placeholder="3.0"
                                    value={line.manualGstPercent || ""}
                                    onChange={(e) => updateLine(index, { manualGstPercent: e.target.value })}
                                    className="h-8 w-16 text-xs text-right"
                                    title="Custom GST %"
                                  />
                                )}
                              </div>
                              {computed && computed.lineTaxPaise > 0 && (
                                <p className="mt-1 text-[10px] text-muted-foreground">{formatPaise(computed.lineTaxPaise)}</p>
                              )}
                            </td>
                          )}
                          <td className="py-2.5 px-2 text-right font-bold text-foreground tabular-nums">
                            {computed ? formatPaise(computed.lineTotalPaise) : "₹ 0.00"}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${line.label}`}
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              onClick={() => removeLine(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bottom Actions & Summary matching Page 17 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* Left Column: Extra Options (Notes, Terms, Old Gold) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setShowNotes(!showNotes)}
              >
                + Add Description
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setShowTerms(!showTerms)}
              >
                + Add Terms & Conditions
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium text-amber-600 dark:text-amber-400"
                onClick={() => setOldGoldEnabled(!oldGoldEnabled)}
              >
                {oldGoldEnabled ? "✓ Old Gold Added" : "+ Old Gold Exchange"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium text-amber-600 dark:text-amber-400"
                onClick={() => setOldItemEnabled(!oldItemEnabled)}
              >
                {oldItemEnabled ? "✓ Old Item Deduction Added" : "+ Old Item Deduction"}
              </Button>
            </div>

            {showNotes && (
              <Input
                placeholder="Enter notes / description for invoice..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-9 text-xs"
              />
            )}
            {showTerms && (
              <Input
                placeholder="Terms and conditions..."
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className="h-9 text-xs"
              />
            )}

            {/* Old Gold Exchange Drawer */}
            {oldGoldEnabled && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    Old Gold / Silver Exchange
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    onClick={() => setOldGoldEnabled(false)}
                  >
                    ×
                  </Button>
                </CardHeader>
                <CardContent className="p-3 pt-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Purity</Label>
                    <Select value={oldGoldPurityId} onValueChange={handleOldGoldPurityChange}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Purity" />
                      </SelectTrigger>
                      <SelectContent>
                        {purities.map((p) => (
                          <SelectItem key={p._id} value={p._id}>
                            {p.label} ({p.metal})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Gross wt (g)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.000"
                      value={oldGoldGrossGrams}
                      onChange={(e) => setOldGoldGrossGrams(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Melting %</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      value={oldGoldMeltingPercent}
                      onChange={(e) => setOldGoldMeltingPercent(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Rate / g (₹)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={oldGoldRateRupees}
                      onChange={(e) => setOldGoldRateRupees(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  {oldGoldComputed && (
                    <p className="col-span-2 sm:col-span-4 text-[11px] text-amber-700 dark:text-amber-300 font-medium mt-1">
                      Value: {formatPaise(oldGoldComputed.exchangeValuePaise)} credited against bill
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Old Item Deduction Drawer: amount only (no weight/purity/rate), with what it was for. */}
            {oldItemEnabled && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    Old Item Deduction
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    aria-label="Remove old item deduction"
                    onClick={() => {
                      setOldItemEnabled(false);
                      setOldItemDeductionRupees("0");
                      setOldItemDeductionNote("");
                    }}
                  >
                    ×
                  </Button>
                </CardHeader>
                <CardContent className="p-3 pt-0 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                  <div>
                    <Label htmlFor="old-item-deduction" className="text-[10px] text-muted-foreground">Amount (₹)</Label>
                    <Input
                      id="old-item-deduction"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={oldItemDeductionRupees === "0" ? "" : oldItemDeductionRupees}
                      onChange={(e) => setOldItemDeductionRupees(e.target.value)}
                      aria-invalid={Boolean(oldItemDeductionError)}
                      className="h-8 text-right font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="old-item-note" className="text-[10px] text-muted-foreground">Description (printed on bill)</Label>
                    <Input
                      id="old-item-note"
                      placeholder="e.g. Old ring"
                      maxLength={80}
                      value={oldItemDeductionNote}
                      onChange={(e) => setOldItemDeductionNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  {oldItemDeductionError && (
                    <p className="sm:col-span-2 text-[11px] font-medium text-destructive">{oldItemDeductionError}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Payment Splits */}
            <Card className="border-border/80 shadow-xs">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Payment Mode
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-2">
                {payments.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      value={p.mode}
                      onValueChange={(val) =>
                        setPayments((prev) =>
                          prev.map((pm, i) => (i === idx ? { ...pm, mode: val as PaymentMode } : pm)),
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      inputMode="decimal"
                      placeholder="Amount ₹"
                      value={p.amountRupees}
                      onChange={(e) =>
                        setPayments((prev) =>
                          prev.map((pm, i) => (i === idx ? { ...pm, amountRupees: e.target.value } : pm)),
                        )
                      }
                      className="h-8 text-xs font-mono"
                    />
                    {payments.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => setPayments((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-medium"
                  onClick={() => setPayments((prev) => [...prev, { mode: "cash", amountRupees: "" }])}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Payment Split
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Totals & Finalize Buttons (Page 17) */}
          <Card className="border-border/80 shadow-xs bg-muted/10">
            <CardContent className="p-4 sm:p-5 space-y-3">
              {lines.length > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground pb-1 border-b">
                  <span>Total Items & Weights</span>
                  <span className="font-mono text-foreground font-medium text-right">
                    {lines.reduce((s, l) => s + (l.pieces ?? 1), 0)} pcs · Gr {mgToGramsDisplay(lines.reduce((s, l) => s + l.grossWeightMg, 0))}g · St {mgToGramsDisplay(lines.reduce((s, l) => s + l.stoneWeightMg, 0))}g · Net {mgToGramsDisplay(computedLines.reduce((s, c) => s + (c?.netWeightMg ?? 0), 0))}g
                  </span>
                </div>
              )}

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal (taxable value)</span>
                <span className="font-mono">{formatPaise(totals.subtotalPaise)}</span>
              </div>

              {totals.discountPaise > 0 && (
                <div className="flex justify-between text-xs text-emerald-600">
                  <span>Discount (saved on original bill)</span>
                  <span className="font-mono">-{formatPaise(totals.discountPaise)}</span>
                </div>
              )}

              {isGst && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Tax (GST)</span>
                  <span className="font-mono">{formatPaise(totals.taxPaise)}</span>
                </div>
              )}

              {totals.oldItemDeductionPaise > 0 && (
                <div className="flex justify-between text-xs text-amber-600">
                  <span>Old item deduction{oldItemDeductionNote.trim() ? ` (${oldItemDeductionNote.trim()})` : ""}</span>
                  <span className="font-mono">-{formatPaise(totals.oldItemDeductionPaise)}</span>
                </div>
              )}

              {totals.oldGoldValuePaise > 0 && (
                <div className="flex justify-between text-xs text-amber-600">
                  <span>Old gold / silver deduction</span>
                  <span className="font-mono">-{formatPaise(totals.oldGoldValuePaise)}</span>
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <span className="text-base font-bold">Total Amount</span>
                <span className="text-xl font-bold text-primary font-mono tabular-nums">
                  {formatPaise(totals.totalPaise)}
                </span>
              </div>

              {showCost && totals.marginPaise !== null && (
                <div className="flex justify-between text-[11px] text-muted-foreground" title="Internal — selling value minus item purchase prices; not printed">
                  <span>Estimated margin (internal)</span>
                  <span className={`font-mono ${totals.marginPaise < 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatPaise(totals.marginPaise)}</span>
                </div>
              )}

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Paid</span>
                <span className="font-mono">{formatPaise(totals.amountPaidPaise)}</span>
              </div>

              {totals.balancePaise > 0 && (
                <div className="flex justify-between text-xs font-semibold text-rose-600">
                  <span>Balance Due</span>
                  <span className="font-mono">{formatPaise(totals.balancePaise)}</span>
                </div>
              )}

              {serverError && <p className="text-xs text-destructive font-medium">{serverError}</p>}

              {/* Action Buttons matching Page 17 */}
              <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={submitting}
                  onClick={() => finalizeSale("printShare")}
                >
                  <MessageCircle className="h-3.5 w-3.5 mr-1" />
                  Share [F4]
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={submitting}
                  onClick={() => finalizeSale("print")}
                >
                  <Printer className="h-3.5 w-3.5 mr-1" />
                  Print A5 [F2]
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-semibold shadow-xs"
                  disabled={submitting}
                  onClick={() => finalizeSale("new")}
                >
                  {submitting ? "Saving…" : "Save Bill [F3]"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    </div>
  );
}
