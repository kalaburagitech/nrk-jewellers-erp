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

type BillLine = {
  boxItemId: Id<"boxItems">;
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
  const createSale = useMutation(api.sales.create);
  const updateSale = useMutation(api.sales.update);
  const createCustomer = useMutation(api.customers.create);

  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [billDate, setBillDate] = useState(() => todayDateInput());
  const [customerId, setCustomerId] = useState("");
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [customerPhoneInput, setCustomerPhoneInput] = useState("");
  const [isGst, setIsGst] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [oldItemDeductionRupees, setOldItemDeductionRupees] = useState("0");
  const [discountMode, setDiscountMode] = useState<"none" | "percent" | "fixed">("none");
  const [discountValue, setDiscountValue] = useState("");
  const [payments, setPayments] = useState<{ mode: PaymentMode; amountRupees: string }[]>([
    { mode: "cash", amountRupees: "" },
  ]);
  const [oldGoldEnabled, setOldGoldEnabled] = useState(false);
  const [oldGoldPurityId, setOldGoldPurityId] = useState("");
  const [oldGoldGrossGrams, setOldGoldGrossGrams] = useState("");
  const [oldGoldMeltingPercent, setOldGoldMeltingPercent] = useState("");
  const [oldGoldRateRupees, setOldGoldRateRupees] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const gstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";

  useEffect(() => {
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
    setLines(
      items.map((item) => ({
        boxItemId: item.boxItemId as Id<"boxItems">,
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

  function addLine(boxItem: Doc<"boxItems">, productNameOverride?: string) {
    const product = productById.get(boxItem.productId);
    const purityId = product?.metalPurityId ?? "";
    const defaultRatePaise = purityId ? rateByPurity.get(purityId) : undefined;
    setLines((prev) => [
      ...prev,
      {
        boxItemId: boxItem._id,
        label: boxItem.label,
        productName: productNameOverride ?? product?.name ?? "Product",
        grossWeightMg: boxItem.grossWeightMg,
        stoneWeightMg: boxItem.stoneWeightMg,
        stockNetWeightMg: boxItem.netWeightMg,
        metalPurityId: purityId,
        otherDeductionGrams: "",
        ratePerGramRupees: defaultRatePaise ? (defaultRatePaise / 100).toFixed(2) : "",
        wastagePercent: "",
        makingChargeRupees: "",
        stoneChargeRupees: "",
        taxConfigurationId: taxConfigs?.[0]?._id ?? "",
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
      lines.map((line, index) => {
        const taxConfig = taxConfigs?.find((t) => t._id === line.taxConfigurationId);
        const gstBasisPoints =
          isGst && taxConfig ? taxConfig.cgstBasisPoints + taxConfig.sgstBasisPoints + taxConfig.igstBasisPoints : 0;
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
        });
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
    const paymentsPaise = payments.reduce((sum, p) => sum + (rupeesToPaise(p.amountRupees || "0") ?? 0), 0);
    const oldGoldValuePaise = oldGoldComputed?.exchangeValuePaise ?? 0;
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
      balancePaise: roundedTotal - amountPaidPaise,
    };
  }, [computedLines, discountMode, discountValue, oldItemDeductionRupees, payments, oldGoldComputed]);

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
    setDiscountMode("none");
    setDiscountValue("");
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
    setSubmitting(true);
    try {
      const resolvedCustomerId = customerId
        ? (customerId as Id<"customers">)
        : await createCustomer({
            name: customerNameInput.trim(),
            phone: customerPhoneInput.trim() || undefined,
            customerType: "cash",
          });

      const items = lines.map((line) => ({
        boxItemId: line.boxItemId,
        metalPurityId: line.metalPurityId ? (line.metalPurityId as Id<"metalPurities">) : undefined,
        otherDeductionMg: Math.round(Number(line.otherDeductionGrams || "0") * 1000) || 0,
        ratePerGramPaise: rupeesToPaise(line.ratePerGramRupees || "0") ?? 0,
        wastageBasisPoints: percentToBasisPoints(line.wastagePercent || "0") ?? 0,
        makingChargePaise: rupeesToPaise(line.makingChargeRupees || "0") ?? 0,
        stoneChargePaise: rupeesToPaise(line.stoneChargeRupees || "0") ?? 0,
        taxConfigurationId:
          isGst && line.taxConfigurationId ? (line.taxConfigurationId as Id<"taxConfigurations">) : undefined,
      }));
      const discountValuePaiseOrBp =
        discountMode === "percent"
          ? percentToBasisPoints(discountValue || "0") ?? 0
          : discountMode === "fixed"
            ? rupeesToPaise(discountValue || "0") ?? 0
            : 0;
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
          oldItemDeductionPaise,
          payments: paymentSplits,
          oldGoldExchange: oldGoldExchangeArg,
          billDate: dateInputToTimestamp(billDate),
        });
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
        payments: paymentSplits,
        oldGoldExchange: oldGoldExchangeArg,
        billDate: dateInputToTimestamp(billDate),
        idempotencyKey,
      });
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Customer & Invoice Type</CardTitle>
              <span className="rounded-full border px-3 py-1 text-sm font-medium text-muted-foreground">{isGst ? "GST Invoice" : "Daily Sales · No GST"}</span>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="max-w-sm flex-1">
                  <Label className="mb-2 block">Customer</Label>
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
                <div>
                  <Label className="mb-2 block">Invoice serial number</Label>
                  <Input aria-label="Invoice serial number" inputMode="numeric" pattern="[0-9]*" maxLength={18} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value.replace(/\D/g, ""))} placeholder="Numbers only / blank for auto" className="mb-3 w-64" />
                  <Label className="mb-2 block">Bill date</Label>
                  <Input
                    type="date"
                    className="w-44"
                    value={billDate}
                    max={todayDateInput()}
                    onChange={(e) => setBillDate(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <BoxItemPicker
            boxes={boxes}
            products={products}
            onAdd={addLine}
            alreadyAddedIds={new Set(lines.map((l) => l.boxItemId))}
          />

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div>
                <h2 className="font-semibold">Items in this bill <span className="text-muted-foreground">({lines.length})</span></h2>
                <p className="mt-1 text-sm text-muted-foreground">No item-count limit is set. Each sale item must be a unique in-stock piece from a box.</p>
              </div>
            </div>
            {lines.map((line, index) => {
              const computed = computedLines[index];
              return (
                <Card key={line.boxItemId}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      {line.label} <span className="font-normal text-muted-foreground">· {line.productName}</span>
                    </CardTitle>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground">
                      Gross {mgToGramsDisplay(line.grossWeightMg)}g · Stone {mgToGramsDisplay(line.stoneWeightMg)}g · Available net {mgToGramsDisplay(line.stockNetWeightMg)}g
                    </p>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="grid gap-2">
                        <Label>Other deduction (g)</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="0.000"
                          value={line.otherDeductionGrams}
                          onChange={(e) => updateLine(index, { otherDeductionGrams: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Rate / g (₹)</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={line.ratePerGramRupees}
                          onChange={(e) => updateLine(index, { ratePerGramRupees: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Wastage (%)</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="0"
                          value={line.wastagePercent}
                          onChange={(e) => updateLine(index, { wastagePercent: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Making (₹)</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={line.makingChargeRupees}
                          onChange={(e) => updateLine(index, { makingChargeRupees: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <div className="grid gap-2">
                        <Label>Stone charge (₹)</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={line.stoneChargeRupees}
                          onChange={(e) => updateLine(index, { stoneChargeRupees: e.target.value })}
                        />
                      </div>
                      {isGst && (
                        <div className="grid gap-2">
                          <Label>Tax rate</Label>
                          <Select
                            value={line.taxConfigurationId}
                            onValueChange={(v) => updateLine(index, { taxConfigurationId: v })}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              {taxConfigs?.map((t) => (
                                <SelectItem key={t._id} value={t._id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    {lineErrors[index] && <p className="text-sm text-destructive">{lineErrors[index]}</p>}
                    {computed && (
                      <p className="text-sm text-muted-foreground">
                        Net {mgToGramsDisplay(computed.netWeightMg)}g · Metal {formatPaise(computed.metalValuePaise)}{" "}
                        · Wastage {formatPaise(computed.wastageValuePaise)}
                        {isGst && <> · Tax {formatPaise(computed.lineTaxPaise)}</>} · Line total{" "}
                        <span className="font-medium text-foreground">{formatPaise(computed.lineTotalPaise)}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Old Gold / Silver Exchange</CardTitle>
              <Switch checked={oldGoldEnabled} onCheckedChange={setOldGoldEnabled} />
            </CardHeader>
            {oldGoldEnabled && (
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Pick the purity and enter the weight — the rate fills in automatically from today&apos;s price. Melting deduction is optional.
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="grid gap-2">
                    <Label>Purity</Label>
                    <Select value={oldGoldPurityId} onValueChange={handleOldGoldPurityChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select purity" />
                      </SelectTrigger>
                      <SelectContent>
                        {purities.map((p) => (
                          <SelectItem key={p._id} value={p._id}>
                            {p.label} ({p.metal === "gold" ? "Gold" : "Silver"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Gross weight (g)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.000"
                      value={oldGoldGrossGrams}
                      onChange={(e) => setOldGoldGrossGrams(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Melting deduction (%)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      value={oldGoldMeltingPercent}
                      onChange={(e) => setOldGoldMeltingPercent(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Rate / g (₹)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={oldGoldRateRupees}
                      onChange={(e) => setOldGoldRateRupees(e.target.value)}
                    />
                  </div>
                </div>
                {oldGoldError && <p className="text-sm text-destructive">{oldGoldError}</p>}
                {oldGoldComputed && (
                  <p className="text-sm text-muted-foreground">
                    Net weight {mgToGramsDisplay(oldGoldComputed.netWeightMg)}g · Exchange value{" "}
                    <span className="font-medium text-foreground">{formatPaise(oldGoldComputed.exchangeValuePaise)}</span>{" "}
                    credited against this bill
                  </p>
                )}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discount & Payment</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="grid gap-2">
                  <Label>Old Item Deduction (₹)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-36"
                    value={oldItemDeductionRupees}
                    onChange={(e) => setOldItemDeductionRupees(e.target.value)}
                  />
                  {oldItemDeductionError && <p className="text-sm text-destructive">{oldItemDeductionError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Discount</Label>
                  <Select value={discountMode} onValueChange={(v) => setDiscountMode(v as typeof discountMode)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="percent">Percentage</SelectItem>
                      <SelectItem value="fixed">Fixed amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {discountMode !== "none" && (
                  <div className="grid gap-2">
                    <Label>{discountMode === "percent" ? "Discount %" : "Discount (₹)"}</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      className="w-32"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                    {discountError && <p className="text-sm text-destructive">{discountError}</p>}
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex flex-col gap-3">
                <Label>Payment</Label>
                {payments.map((payment, index) => (
                  <div key={index} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Select
                      value={payment.mode}
                      onValueChange={(v) =>
                        setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, mode: v as PaymentMode } : p)))
                      }
                    >
                      <SelectTrigger className="w-40">
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
                      placeholder="0.00"
                      value={payment.amountRupees}
                      onChange={(e) =>
                        setPayments((prev) =>
                          prev.map((p, i) => (i === index ? { ...p, amountRupees: e.target.value } : p)),
                        )
                      }
                    />
                    {payments.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => setPayments((prev) => prev.filter((_, i) => i !== index))}>
                        <Minus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {paymentErrors[index] && <p className="text-sm text-destructive">{paymentErrors[index]}</p>}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setPayments((prev) => [...prev, { mode: "cash", amountRupees: "" }])}
                >
                  <Plus className="h-4 w-4" />
                  Add payment split
                </Button>
              </div>

              <Separator />

              <div className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal (taxable)</span>
                  <span>{formatPaise(totals.subtotalPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span>-{formatPaise(totals.discountPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Old item deduction</span>
                  <span>-{formatPaise(totals.oldItemDeductionPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatPaise(totals.taxPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Round off</span>
                  <span>{formatPaise(totals.roundOffPaise)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span>Total</span>
                  <span>{formatPaise(totals.totalPaise)}</span>
                </div>
                {totals.oldGoldValuePaise > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Old gold exchange</span>
                    <span>-{formatPaise(totals.oldGoldValuePaise)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span>{formatPaise(totals.amountPaidPaise)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Balance</span>
                  <span>{formatPaise(totals.balancePaise)}</span>
                </div>
              </div>

              {totals.balancePaise > 0 && (
                <Badge variant="secondary" className="self-start font-normal">
                  Remaining balance goes to the customer&apos;s outstanding ledger
                </Badge>
              )}

              {serverError && <p className="text-sm text-destructive">{serverError}</p>}

              {editSaleId ? (
                <Button onClick={() => finalizeSale("view")} disabled={submitting} className="self-end">
                  {submitting ? "Saving…" : "Save Changes"}
                </Button>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => finalizeSale("print")} disabled={submitting}>
                    <Printer className="h-4 w-4" />
                    Print A5 Invoice <span className="text-muted-foreground">[F2]</span>
                  </Button>
                  <Button variant="outline" onClick={() => finalizeSale("printShare")} disabled={submitting}>
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp Share <span className="text-muted-foreground">[F4]</span>
                  </Button>
                  <Button onClick={() => finalizeSale("new")} disabled={submitting}>
                    {submitting ? "Saving…" : "Save and New"} <span className="opacity-70">[F3]</span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
      </>
    </div>
  );
}
