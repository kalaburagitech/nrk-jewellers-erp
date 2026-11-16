"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { BarcodeScanInput } from "@/components/barcode-scan-input";
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

/** "5%" → 5% of the line's value; "200" → ₹200. Blank or invalid → no discount. */
function lineDiscountPaise(raw: string | undefined, taxablePaise: number): number {
  const text = (raw ?? "").trim();
  if (!text) return 0;
  if (text.endsWith("%")) {
    const bp = percentToBasisPoints(text.slice(0, -1).trim());
    return bp === null ? 0 : Math.round((taxablePaise * bp) / 10000);
  }
  return Math.min(rupeesToPaise(text) ?? 0, taxablePaise);
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
  /** Line discount, as a % ("5%") or rupees ("200"). Taken off before GST. */
  discount?: string;
  taxConfigurationId: string;
  manualGstPercent?: string;
  isManualTax?: boolean;
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
    const pcs = Number(pieces || "1");
    if (!selected) return setError("Choose an item.");
    if (grossWeightMg <= 0) return setError("Enter the gross weight.");
    if (stoneWeightMg > grossWeightMg) return setError("Stone weight cannot be more than gross weight.");
    if (!Number.isInteger(pcs) || pcs < 1) return setError("Pieces must be 1 or more.");
    // The whole piece (gross weight) leaves stock; the bill is priced on net weight.
    if (grossWeightMg > selected.weightMg) return setError(`Only ${mgToGramsDisplay(selected.weightMg)} g of ${selected.name} is in GST stock.`);
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
        <p className="text-xs text-muted-foreground">Pick the item and type its weight. The bill shows net weight; the gross weight is deducted from GST item stock.</p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 p-4 pt-0 sm:grid-cols-[2fr_1fr_1fr_0.7fr_auto] sm:items-end">
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-[10px] text-muted-foreground">Item</Label>
          <Select value={productId || undefined} onValueChange={setProductId}>
            <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder={stock === undefined ? "Loading…" : "Choose item"} /></SelectTrigger>
            <SelectContent>
              {stock?.map((s) => (
                <SelectItem key={s.productId} value={s.productId}>{s.name} · {mgToGramsDisplay(s.weightMg)} g · {s.pieces} pcs</SelectItem>
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
  const lastPrices = useQuery(api.sales.lastPricesByProduct);
  const createSale = useMutation(api.sales.create);
  const setCustomerDueDate = useMutation(api.customers.setDueDate);
  const updateSale = useMutation(api.sales.update);
  const createCustomer = useMutation(api.customers.create);
  const prefs = useQuery(api.appPreferences.get);
  const createTaxConfig = useMutation(api.taxConfigurations.create);

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
  const [discountMode, setDiscountMode] = useState<"none" | "percent" | "fixed">("none");
  const [discountValue, setDiscountValue] = useState("");
  const [payments, setPayments] = useState<{ mode: PaymentMode; amountRupees: string }[]>([
    { mode: "cash", amountRupees: "" },
  ]);
  // Ticked: the first payment row always equals whatever is left to pay
  // (bill total − old gold − other payment rows). Unticked: typed by hand.
  const [payFull, setPayFull] = useState(false);
  // When a balance is left unpaid: the date the customer promised to clear it.
  const [dueDate, setDueDate] = useState("");
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

  // One-time prefill once the existing invoice loads, in edit mode — guarded
  // by `prefilled` so it never re-runs after the user starts editing.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!editSaleId || !existingSale || prefilled) return;
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
        discount: item.lineDiscountPaise ? (item.lineDiscountPaise / 100).toFixed(2) : "",
        taxConfigurationId: item.taxConfigurationId ?? "",
      })),
    );
    if (sale.discountPaise > 0) {
      setDiscountMode("fixed");
      setDiscountValue((sale.discountPaise / 100).toFixed(2));
    }
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
  }, [editSaleId, existingSale, prefilled]);
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

  /**
   * Prices a newly picked item automatically: today's metal rate for its
   * purity, and the making charge / wastage it was last billed at. A purity
   * with no rate set today falls back to the item's last billed rate.
   */
  function defaultPricing(productId: string | undefined, productPurityId: string | undefined) {
    const last = productId ? lastPrices?.[productId] : undefined;
    const purityId = productPurityId || last?.metalPurityId || "";
    const ratePaise = (purityId ? rateByPurity.get(purityId) : undefined) ?? last?.ratePerGramPaise;
    // Making charge saved on the item (Add Item form) wins; otherwise the last price billed for it.
    const itemMakingPaise = productId ? productById.get(productId as Id<"products">)?.makingChargePaise : undefined;
    const makingPaise = itemMakingPaise ?? last?.makingChargePaise;
    return {
      metalPurityId: purityId,
      ratePerGramRupees: ratePaise ? (ratePaise / 100).toFixed(2) : "",
      makingChargeRupees: makingPaise ? (makingPaise / 100).toFixed(2) : "",
      wastagePercent: last?.wastageBasisPoints ? String(last.wastageBasisPoints / 100) : "",
    };
  }

  function addLine(boxItem: Doc<"boxItems">, productNameOverride?: string) {
    const product = productById.get(boxItem.productId);
    const pricing = defaultPricing(boxItem.productId, product?.metalPurityId);
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
        metalPurityId: pricing.metalPurityId,
        otherDeductionGrams: "",
        ratePerGramRupees: pricing.ratePerGramRupees,
        wastagePercent: pricing.wastagePercent,
        makingChargeRupees: pricing.makingChargeRupees,
        stoneChargeRupees: "",
        taxConfigurationId: product?.taxConfigurationId ?? taxConfigs?.[0]?._id ?? "",
      },
    ]);
  }

  function addManualLine(item: { productId: string; name: string; metalPurityId?: string; grossWeightMg: number; stoneWeightMg: number; pieces: number }) {
    const product = productById.get(item.productId as Id<"products">);
    const pricing = defaultPricing(item.productId, item.metalPurityId);
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
        metalPurityId: pricing.metalPurityId,
        otherDeductionGrams: "",
        ratePerGramRupees: pricing.ratePerGramRupees,
        wastagePercent: pricing.wastagePercent,
        makingChargeRupees: pricing.makingChargeRupees,
        stoneChargeRupees: "",
        taxConfigurationId: product?.taxConfigurationId ?? taxConfigs?.[0]?._id ?? "",
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
        const input = {
          grossWeightMg: line.grossWeightMg,
          stoneWeightMg: line.stoneWeightMg,
          stockNetWeightMg: line.stockNetWeightMg,
          otherDeductionMg: Math.round(Number(line.otherDeductionGrams || "0") * 1000) || 0,
          ratePerGramPaise: rupeesToPaise(line.ratePerGramRupees || "0") ?? 0,
          wastageBasisPoints: percentToBasisPoints(line.wastagePercent || "0") ?? 0,
          makingChargePaise: rupeesToPaise(line.makingChargeRupees || "0") ?? 0,
          stoneChargePaise: rupeesToPaise(line.stoneChargeRupees || "0") ?? 0,
          gstBasisPoints,
        };
        const discount = lineDiscountPaise(line.discount, computeSaleLine(input).taxableValuePaise);
        return computeSaleLine({ ...input, lineDiscountPaise: discount });
      }),
    [lines, taxConfigs, isGst],
  );

  const lineErrors = useMemo(
    () =>
      lines.map((line, index) => {
        const checks: [string, string | null][] = [
          ["Other deduction", numberFieldError(line.otherDeductionGrams, { max: line.stockNetWeightMg / 1000 })],
          ["Rate/g", numberFieldError(line.ratePerGramRupees)],
          ["Wastage %", numberFieldError(line.wastagePercent, { max: 100 })],
          ["Making charge", numberFieldError(line.makingChargeRupees)],
          ["Stone charge", numberFieldError(line.stoneChargeRupees)],
        ];
        const failed = checks.find(([, error]) => error);
        if (failed) return `${failed[0]}: ${failed[1]}`;
        const computed = computedLines[index];
        if (computed?.netWeightMg === 0 && computed.lineTotalPaise === 0) {
          return "This item has zero net weight and zero value. Check its box stock weight and deductions before billing.";
        }
        return null;
      }),
    [lines, computedLines],
  );

  const discountError = useMemo(() => {
    if (discountMode === "none") return null;
    return discountMode === "percent"
      ? numberFieldError(discountValue, { max: 100 })
      : numberFieldError(discountValue);
  }, [discountMode, discountValue]);

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
    let discountPaise = 0;
    if (discountMode === "percent") {
      discountPaise = Math.round((subtotalPaise * (percentToBasisPoints(discountValue || "0") ?? 0)) / 10000);
    } else if (discountMode === "fixed") {
      discountPaise = rupeesToPaise(discountValue || "0") ?? 0;
    }
    discountPaise = Math.min(discountPaise, subtotalPaise);
    const beforeOldItemDeductionPaise = subtotalPaise - discountPaise + taxPaise;
    const oldItemDeductionPaise = rupeesToPaise(oldItemDeductionRupees || "0") ?? 0;
    const preRound = beforeOldItemDeductionPaise - oldItemDeductionPaise;
    const roundedTotal = preRound;
    const roundOffPaise = 0;
    const oldGoldValuePaise = oldGoldComputed?.exchangeValuePaise ?? 0;
    const otherPaymentsPaise = payments
      .slice(payFull ? 1 : 0)
      .reduce((sum, p) => sum + (rupeesToPaise(p.amountRupees || "0") ?? 0), 0);
    // "Full amount" ticked: the first row takes whatever is still left to pay.
    const fullFirstPaymentPaise = Math.max(0, roundedTotal - oldGoldValuePaise - otherPaymentsPaise);
    const paymentsPaise = otherPaymentsPaise + (payFull ? fullFirstPaymentPaise : 0);
    const amountPaidPaise = paymentsPaise + oldGoldValuePaise;
    return {
      subtotalPaise,
      taxPaise,
      discountPaise,
      oldItemDeductionPaise,
      beforeOldItemDeductionPaise,
      roundOffPaise,
      totalPaise: roundedTotal,
      oldGoldValuePaise,
      amountPaidPaise,
      fullFirstPaymentPaise,
      balancePaise: roundedTotal - amountPaidPaise,
    };
  }, [computedLines, discountMode, discountValue, oldItemDeductionRupees, payments, payFull, oldGoldComputed]);

  const oldItemDeductionError =
    numberFieldError(oldItemDeductionRupees) ??
    (totals.oldItemDeductionPaise > totals.beforeOldItemDeductionPaise
      ? "Cannot exceed the bill amount after discount."
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
    setDiscountMode("none");
    setDiscountValue("");
    setPayments([{ mode: "cash", amountRupees: "" }]);
    setPayFull(false);
    setDueDate("");
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
    if (discountError) {
      setServerError(`Discount: ${discountError}`);
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
    if (!customerId && prefs?.blockNewPartiesFromTxn) {
      setServerError("Select an existing customer. Adding new parties from the bill is turned off in Settings → General.");
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
        lines.map(async (line, index) => {
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
            lineDiscountPaise: computedLines[index]?.lineDiscountPaise || undefined,
          };
        }),
      );
      const discountValuePaiseOrBp =
        discountMode === "percent"
          ? percentToBasisPoints(discountValue || "0") ?? 0
          : discountMode === "fixed"
            ? rupeesToPaise(discountValue || "0") ?? 0
            : 0;
      const oldItemDeductionPaise = rupeesToPaise(oldItemDeductionRupees || "0") ?? 0;
      const paymentSplits = payments
        .map((p, index) => ({
          mode: p.mode,
          amountPaise: payFull && index === 0 ? totals.fullFirstPaymentPaise : rupeesToPaise(p.amountRupees || "0") ?? 0,
        }))
        .filter((p) => p.amountPaise > 0);
      // A balance left on the bill gets the promised due date, so it shows up in payment reminders.
      const dueDateMs = totals.balancePaise > 0 && dueDate ? dateInputToTimestamp(dueDate) : undefined;
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
          oldItemDeductionPaise,
          oldItemDeductionNote: oldItemDeductionNote.trim() || undefined,
          payments: paymentSplits,
          oldGoldExchange: oldGoldExchangeArg,
          billDate: dateInputToTimestamp(billDate),
        });
        if (dueDateMs) await setCustomerDueDate({ id: resolvedCustomerId, dueDateMs });
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
        oldItemDeductionPaise,
        oldItemDeductionNote: oldItemDeductionNote.trim() || undefined,
        payments: paymentSplits,
        oldGoldExchange: oldGoldExchangeArg,
        billDate: dateInputToTimestamp(billDate),
        idempotencyKey,
      });
      if (dueDateMs) await setCustomerDueDate({ id: resolvedCustomerId, dueDateMs });
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{editSaleId ? "Edit Bill" : "New Bill"}</h1>
          <Button type="button" variant="outline" size="sm" onClick={() => window.open("/sales/new", "_blank", "noopener")} title="Open another blank bill in a new tab; this one stays open">
            <Plus className="h-4 w-4" />
            New Bill Tab
          </Button>
        </div>
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
                    <SelectContent>
                      <SelectItem value="Karnataka">Karnataka (29)</SelectItem>
                      <SelectItem value="Maharashtra">Maharashtra (27)</SelectItem>
                      <SelectItem value="Telangana">Telangana (36)</SelectItem>
                      <SelectItem value="Andhra Pradesh">Andhra Pradesh (37)</SelectItem>
                      <SelectItem value="Goa">Goa (30)</SelectItem>
                    </SelectContent>
                  </Select>
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
          <>
            {prefs?.items.barcodeScan !== false && <BarcodeScanInput onItem={(item) => addLine(item)} alreadyAddedIds={new Set(lines.flatMap((l) => (l.boxItemId ? [String(l.boxItemId)] : [])))} />}
            <BoxItemPicker
              boxes={boxes}
              products={products}
              onAdd={addLine}
              alreadyAddedIds={new Set(lines.flatMap((l) => (l.boxItemId ? [l.boxItemId] : [])))}
            />
          </>
        )}

        {/* Vyapar Items Table matching Page 17 */}
        <Card className="border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="p-4 border-b bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-bold uppercase tracking-wide">
              Items in this bill ({lines.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {gstCompany
                ? "Bill is priced on net weight; the gross weight and pieces are deducted from GST item stock."
                : "Selling deducts pieces and weight straight from the assigned physical box."}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {lines.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <p>{gstCompany ? "No items added yet. Choose an item above and enter its weight." : "No items added yet. Pick an item from a box above or add a new piece to a box."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left font-semibold text-muted-foreground">
                      <th className="py-2.5 px-3 w-8">#</th>
                      <th className="py-2.5 px-3">ITEM / BOX</th>
                      <th className="py-2.5 px-3">PURITY</th>
                      <th className="py-2.5 px-3">GROSS WT <span className="font-normal">(stock)</span></th>
                      <th className="py-2.5 px-3">NET WT <span className="font-normal">(bill)</span></th>
                      <th className="py-2.5 px-3">MAKING (₹)</th>
                      <th className="py-2.5 px-3">QTY</th>
                      <th className="py-2.5 px-3">RATE / G (₹)</th>
                      <th className="py-2.5 px-3">DISC. (₹ / %)</th>
                      {isGst && <th className="py-2.5 px-3">TAX (GST)</th>}
                      <th className="py-2.5 px-3 text-right">AMOUNT (₹)</th>
                      <th className="py-2.5 px-3 text-center w-10">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lines.map((line, index) => {
                      const computed = computedLines[index];
                      const error = lineErrors[index];
                      return (
                        <tr key={line.key} className="hover:bg-muted/20">
                          <td className="py-2.5 px-3 font-mono text-muted-foreground">{index + 1}</td>
                          <td className="py-2.5 px-3">
                            <p className="font-semibold text-foreground">{line.label}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {line.productName}
                              {line.boxNumber ? ` · Box ${line.boxNumber}` : ""}
                            </p>
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {purities?.find((p) => p._id === line.metalPurityId)?.label || "Standard"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            {mgToGramsDisplay(line.grossWeightMg)}g
                          </td>
                          <td className="py-2.5 px-3 font-mono font-medium text-emerald-600">
                            {computed ? `${mgToGramsDisplay(computed.netWeightMg)}g` : "—"}
                          </td>
                          <td className="py-2.5 px-3">
                            <Input
                              inputMode="decimal"
                              placeholder="0"
                              value={line.makingChargeRupees}
                              onChange={(e) => updateLine(index, { makingChargeRupees: e.target.value })}
                              className="h-8 w-20 text-xs text-right"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-medium">{line.pieces ?? 1} Pc</td>
                          <td className="py-2.5 px-3">
                            <Input
                              inputMode="decimal"
                              placeholder="0.00"
                              value={line.ratePerGramRupees}
                              onChange={(e) => updateLine(index, { ratePerGramRupees: e.target.value })}
                              className="h-8 w-24 text-xs font-mono text-right"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <Input
                              aria-label="Line discount"
                              placeholder="0 or 5%"
                              value={line.discount ?? ""}
                              onChange={(e) => updateLine(index, { discount: e.target.value })}
                              className="h-8 w-20 text-xs text-right"
                            />
                          </td>
                          {isGst && (
                            <td className="py-2.5 px-3">
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
                                  <SelectTrigger className="h-8 w-28 text-[11px]">
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
                            </td>
                          )}
                          <td className="py-2.5 px-3 text-right font-bold text-foreground tabular-nums">
                            {computed ? formatPaise(computed.lineTotalPaise) : "₹ 0.00"}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
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
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={payFull}
                    onChange={(e) => setPayFull(e.target.checked)}
                  />
                  Received full amount ({formatPaise(totals.fullFirstPaymentPaise)})
                  <span className="font-normal text-muted-foreground">— untick to type the amount</span>
                </label>
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
                      aria-label={`Payment ${idx + 1} amount`}
                      readOnly={payFull && idx === 0}
                      value={payFull && idx === 0 ? (totals.fullFirstPaymentPaise / 100).toFixed(2) : p.amountRupees}
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
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal (taxable value)</span>
                <span className="font-mono">{formatPaise(totals.subtotalPaise)}</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <label htmlFor="bill-discount" className="text-muted-foreground">Discount</label>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Discount type"
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={discountMode}
                    onChange={(e) => {
                      setDiscountMode(e.target.value as typeof discountMode);
                      if (e.target.value === "none") setDiscountValue("");
                    }}
                  >
                    <option value="none">None</option>
                    <option value="percent">%</option>
                    <option value="fixed">₹</option>
                  </select>
                  <Input
                    id="bill-discount"
                    inputMode="decimal"
                    placeholder={discountMode === "percent" ? "0 %" : "0.00"}
                    disabled={discountMode === "none"}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    aria-invalid={Boolean(discountError)}
                    className="h-8 w-24 text-right font-mono text-xs"
                  />
                  <span className="w-24 text-right font-mono text-emerald-600">
                    {totals.discountPaise > 0 ? `-${formatPaise(totals.discountPaise)}` : ""}
                  </span>
                </div>
                {discountError && <p className="w-full text-right text-[11px] font-medium text-destructive">{discountError}</p>}
              </div>

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

              {totals.balancePaise > 0 && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <label htmlFor="bill-due-date" className="text-muted-foreground">Balance due by (reminder date)</label>
                  <Input
                    id="bill-due-date"
                    type="date"
                    value={dueDate}
                    min={todayDateInput()}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-8 w-40 text-xs"
                  />
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
