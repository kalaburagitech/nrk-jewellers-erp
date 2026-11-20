"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { BarcodeScanInput } from "@/components/barcode-scan-input";
import { BoxPicker } from "@/components/box-picker";
import type { BoxEntryRow } from "@/components/box-items";
import { gstRateBp, isInterState } from "@/lib/gst-rate";
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
import { computeOldGoldExchange, computeSaleLine, gramsToMg, makingChargeFor, metalValuePaise, mgToGramsDisplay, type MakingChargeMode } from "@/lib/jewelry-calc";
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

type Metal = "gold" | "silver";
type MakingMode = MakingChargeMode;
type BoxRow = Doc<"boxes"> & { weightMg: number; pieces: number; entries?: BoxEntryRow[] };

/** One editable bill row. Weights/amounts are kept as typed text until save. */
type BillLine = {
  key: string;
  /** Daily Sales: the box the gross weight is deducted from. */
  boxId: string;
  /** Category: Gold or Silver. */
  metal: Metal | "";
  /** Picked from the Item List; empty = a typed description (Daily Sales creates the item on save). */
  productId: string;
  label: string;
  metalPurityId: string;
  piecesText: string;
  grossGrams: string;
  netGrams: string;
  ratePerGramRupees: string;
  makingMode: MakingMode;
  /** ₹, ₹ per gram, or % depending on makingMode. */
  makingValue: string;
  /** Line discount, as a % ("5%") or rupees ("200"). Taken off before GST. */
  discount: string;
  /** Selling price per piece (₹). Blank → priced by net weight × rate per gram. */
  unitPriceRupees: string;
  /** The item's saved selling price per piece, in paise (for the override check). */
  savedPricePaise?: number;
  /** Purchase price per piece, in paise — only present for roles allowed to see cost. */
  costPaise?: number;
  /** Weight of one piece of the picked box item (its stock ÷ pieces): gross/net fill as Pcs × this until typed over. */
  perPiece?: { grossMg: number; netMg: number };
  // Kept from older bills so an edit doesn't drop them (not shown on the grid).
  wastagePercent: string;
  stoneChargeRupees: string;
  taxConfigurationId: string;
  manualGstPercent?: string;
  isManualTax?: boolean;
};

const MAKING_MODES: { value: MakingMode; label: string }[] = [
  { value: "fixed", label: "₹" },
  { value: "per_gram", label: "₹/g" },
  { value: "percent", label: "%" },
];

/** Making charge value as the server stores it: paise, paise per gram, or basis points. */
function makingValueUnits(mode: MakingMode, raw: string): number {
  return mode === "percent" ? percentToBasisPoints(raw || "0") ?? 0 : rupeesToPaise(raw || "0") ?? 0;
}

function blankLine(taxConfigurationId: string): BillLine {
  return {
    key: crypto.randomUUID(),
    boxId: "",
    metal: "",
    productId: "",
    label: "",
    metalPurityId: "",
    piecesText: "",
    grossGrams: "",
    netGrams: "",
    ratePerGramRupees: "",
    makingMode: "fixed",
    makingValue: "",
    discount: "",
    unitPriceRupees: "",
    wastagePercent: "",
    stoneChargeRupees: "",
    taxConfigurationId,
  };
}

const cellInput = "h-8 text-xs";

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
  const pricingAccess = useQuery(api.products.myPricingAccess);
  const showCost = pricingAccess?.canViewCost ?? false;
  const canOverride = pricingAccess?.canOverridePrice ?? false;
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
  // Starts with one empty row; a blank tax id means the company's default GST rate.
  const [lines, setLines] = useState<BillLine[]>(() => [blankLine("")]);
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
    if (sale.stateOfSupply) setStateOfSupply(sale.stateOfSupply);
    setOldItemDeductionRupees(((sale.oldItemDeductionPaise ?? 0) / 100).toFixed(2));
    setOldItemEnabled((sale.oldItemDeductionPaise ?? 0) > 0);
    setOldItemDeductionNote(sale.oldItemDeductionNote ?? "");
    setLines(
      items.map((item) => {
        const makingMode: MakingMode = item.makingChargeMode ?? "fixed";
        const makingUnits = item.makingChargeMode ? item.makingChargeValue ?? 0 : item.makingChargePaise;
        return {
          key: item._id,
          // Lines from before box balances (one piece) come back as a box line on that piece's box.
          boxId: item.boxId ?? "",
          metal: item.metal ?? "",
          productId: item.productId,
          label: item.label,
          metalPurityId: item.metalPurityId ?? "",
          piecesText: String(item.pieces ?? (item.boxItemId ? 1 : 0)),
          grossGrams: (item.grossWeightMg / 1000).toFixed(3),
          netGrams: (item.netWeightMg / 1000).toFixed(3),
          ratePerGramRupees: (item.ratePerGramPaise / 100).toFixed(2),
          makingMode,
          makingValue: makingUnits ? (makingUnits / 100).toFixed(2) : "",
          discount: item.lineDiscountPaise ? (item.lineDiscountPaise / 100).toFixed(2) : "",
          unitPriceRupees: item.unitPricePaise ? (item.unitPricePaise / 100).toFixed(2) : "",
          wastagePercent: item.wastageBasisPoints ? (item.wastageBasisPoints / 100).toFixed(2) : "",
          stoneChargeRupees: item.stoneChargePaise ? (item.stoneChargePaise / 100).toFixed(2) : "",
          taxConfigurationId: item.taxConfigurationId ?? "none",
        };
      }),
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

  /** Mirrors how a sale line's rate defaults from today's metal rate — without this, the rate field was the one thing operators had to look up and type themselves, and leaving it blank blocks the whole bill rather than failing quietly. */
  function handleOldGoldPurityChange(purityId: string) {
    setOldGoldPurityId(purityId);
    if (!oldGoldRateRupees) {
      const defaultRatePaise = rateByPurity.get(purityId);
      if (defaultRatePaise) setOldGoldRateRupees((defaultRatePaise / 100).toFixed(2));
    }
  }

  const boxById = useMemo(() => new Map((boxes ?? []).map((b) => [b._id as string, b as BoxRow])), [boxes]);
  const gstStock = useQuery(api.itemStock.list, gstCompany ? {} : "skip");
  /** Pcs left blank: 1 on a GST bill (item stock is counted in pieces), else 0. */
  /** GST company line with no box: billed from loose GST item stock. */
  const isLoose = useCallback((line: BillLine) => gstCompany && !line.boxId, [gstCompany]);
  const piecesOf = useCallback((line: BillLine) => (line.piecesText.trim() === "" ? (isLoose(line) ? 1 : 0) : Number(line.piecesText)), [isLoose]);
  const productByName = useMemo(() => new Map((products ?? []).filter((p) => p.isActive).map((p) => [p.name.trim().toLowerCase(), p])), [products]);
  // Item code (SKU) typed in Description finds the item too.
  const productBySku = useMemo(() => new Map((products ?? []).filter((p) => p.isActive && p.sku).map((p) => [p.sku!.trim().toLowerCase(), p])), [products]);
  const activePurities = useMemo(() => (purities ?? []).filter((p) => p.isActive), [purities]);
  const defaultTaxId = taxConfigs?.[0]?._id ?? "";

  /** Purity a category starts with: 22K for gold when it exists, else the first purity of that metal. */
  function defaultPurityFor(metal: Metal | "") {
    if (!metal) return "";
    const ofMetal = activePurities.filter((p) => p.metal === metal);
    return (ofMetal.find((p) => metal === "gold" && p.label.includes("22")) ?? ofMetal[0])?._id ?? "";
  }

  /** Today's rate for the purity; else what the item was last billed at. (A saved selling price fills Price / pc instead.) */
  function autoRate(product: Doc<"products"> | undefined, purityId: string) {
    const ratePaise = (purityId ? rateByPurity.get(purityId) : undefined) ?? (product ? lastPrices?.[product._id]?.ratePerGramPaise : undefined);
    return ratePaise ? (ratePaise / 100).toFixed(2) : "";
  }

  function updateLine(index: number, patch: Partial<BillLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /** Box picked: category follows the box's metal, purity/rate default from it, pieces default to 1 when the box tracks pieces. */
  function withBox(line: BillLine, boxId: string): Partial<BillLine> {
    const box = boxById.get(boxId);
    const metal = box?.metal ?? line.metal;
    const purityOk = activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal;
    const metalPurityId = purityOk ? line.metalPurityId : defaultPurityFor(metal) || line.metalPurityId;
    return {
      boxId,
      metal,
      metalPurityId,
      piecesText: line.piecesText || (box && box.pieces > 0 ? "1" : "0"),
      ratePerGramRupees: line.ratePerGramRupees || autoRate(productById.get(line.productId), metalPurityId),
    };
  }

  function pickMetal(index: number, metal: Metal | "") {
    const line = lines[index];
    if (activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal) return updateLine(index, { metal });
    const metalPurityId = defaultPurityFor(metal);
    updateLine(index, { metal, metalPurityId, ratePerGramRupees: autoRate(productById.get(line.productId), metalPurityId) || line.ratePerGramRupees });
  }

  function pickPurity(index: number, metalPurityId: string) {
    const line = lines[index];
    const purity = activePurities.find((p) => p._id === metalPurityId);
    updateLine(index, { metalPurityId, metal: purity?.metal ?? line.metal, ratePerGramRupees: autoRate(productById.get(line.productId), metalPurityId) || line.ratePerGramRupees });
  }

  /** Description typed: an exact Item List name fills purity, category, fixed price and making charge from the item. */
  function typeDescription(index: number, label: string) {
    updateLine(index, descriptionPatch(lines[index], label));
  }

  /** Box picked from the dropdown: the box, and the item when the row was one of its items. */
  function pickBoxItem(index: number, boxId: string, entry?: BoxEntryRow) {
    let next: BillLine = { ...lines[index], ...withBox(lines[index], boxId) };
    if (entry) next = { ...next, ...entryPatch(next, entry) };
    updateLine(index, next);
  }

  /** Gross and net weight from the box item's per-piece weight × Pcs (1 when blank). Weight-only items (no pieces) leave the weights to type. */
  function weightsForPieces(line: BillLine, entry: BoxEntryRow): Partial<BillLine> {
    if (!(entry.pieces > 0) || !(entry.weightMg > 0)) return { perPiece: undefined };
    const perPiece = { grossMg: Math.round(entry.weightMg / entry.pieces), netMg: Math.round(entry.netWeightMg / entry.pieces) };
    const pieces = Number(line.piecesText) > 0 ? Number(line.piecesText) : 1;
    return {
      perPiece,
      piecesText: String(pieces),
      grossGrams: ((perPiece.grossMg * pieces) / 1000).toFixed(3),
      netGrams: ((perPiece.netMg * pieces) / 1000).toFixed(3),
    };
  }

  /** Pcs typed: weights filled from the box item follow the new count, unless the operator typed their own. */
  function typePieces(index: number, piecesText: string) {
    const line = lines[index];
    const per = line.perPiece;
    const oldPieces = Number(line.piecesText) || 0;
    const auto = per && line.grossGrams === ((per.grossMg * oldPieces) / 1000).toFixed(3) && line.netGrams === ((per.netMg * oldPieces) / 1000).toFixed(3);
    const pieces = Number(piecesText);
    if (!per || !auto || !Number.isInteger(pieces) || pieces < 1) return updateLine(index, { piecesText });
    updateLine(index, { piecesText, grossGrams: ((per.grossMg * pieces) / 1000).toFixed(3), netGrams: ((per.netMg * pieces) / 1000).toFixed(3) });
  }

  /** The item as kept in its box: everything the line needs comes from the box. */
  function entryPatch(line: BillLine, entry: BoxEntryRow): Partial<BillLine> {
    const purity = activePurities.find((p) => p._id === entry.metalPurityId);
    const box = boxById.get(line.boxId);
    const metal = purity?.metal ?? box?.metal ?? line.metal;
    const metalPurityId = purity?._id ?? (activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal ? line.metalPurityId : defaultPurityFor(metal));
    const discountValue = entry.saleDiscountValue ?? 0;
    return {
      label: entry.productName,
      productId: entry.productId,
      metal,
      metalPurityId,
      ratePerGramRupees: autoRate(productById.get(entry.productId), metalPurityId) || line.ratePerGramRupees,
      makingMode: entry.makingChargeMode ?? "fixed",
      makingValue: entry.makingChargeValue ? (entry.makingChargeValue / 100).toFixed(2) : "",
      wastagePercent: entry.wastageBasisPoints ? String(entry.wastageBasisPoints / 100) : "",
      taxConfigurationId: entry.taxConfigurationId ?? line.taxConfigurationId,
      discount: discountValue ? (entry.saleDiscountMode === "amount" ? (discountValue / 100).toFixed(2) : `${discountValue / 100}%`) : "",
      unitPriceRupees: entry.salePricePaise ? (entry.salePricePaise / 100).toFixed(2) : "",
      savedPricePaise: entry.salePricePaise || undefined,
      costPaise: entry.purchasePricePaise,
      ...weightsForPieces(line, entry),
    };
  }

  function descriptionPatch(line: BillLine, label: string): Partial<BillLine> {
    const product = productByName.get(label.trim().toLowerCase()) ?? productBySku.get(label.trim().toLowerCase());
    if (!product) return { label, productId: "", savedPricePaise: undefined, costPaise: undefined, ...(line.savedPricePaise !== undefined ? { unitPriceRupees: "" } : {}) };
    if (product._id === line.productId) return { label };
    // The box holds this item: its details come from the box.
    const entry = boxById.get(line.boxId)?.entries?.find((e) => e.productId === product._id);
    if (entry) return entryPatch(line, entry);
    // No box chosen yet: pick the box that holds this item (the one with the most of it) and fill everything from there.
    if (!line.boxId) {
      const holder = (boxes ?? [])
        .filter((b) => b.isActive)
        .flatMap((b) => ((b as BoxRow).entries ?? []).filter((e) => e.productId === product._id && e.weightMg > 0).map((e) => ({ box: b, entry: e })))
        .sort((a, b) => b.entry.weightMg - a.entry.weightMg)[0];
      if (holder) {
        const withHolder = { ...line, ...withBox(line, holder.box._id) };
        return { ...withBox(line, holder.box._id), ...entryPatch(withHolder, holder.entry) };
      }
    }
    const purity = activePurities.find((p) => p._id === product.metalPurityId);
    const box = boxById.get(line.boxId);
    const metal = purity?.metal ?? box?.metal ?? line.metal;
    const metalPurityId = purity?._id ?? (activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal ? line.metalPurityId : defaultPurityFor(metal));
    const last = lastPrices?.[product._id];
    const makingPaise = product.makingChargePaise ?? last?.makingChargePaise;
    return {
      label: product.name,
      productId: product._id,
      metal,
      metalPurityId,
      ratePerGramRupees: autoRate(product, metalPurityId) || line.ratePerGramRupees,
      ...(makingPaise ? { makingMode: "fixed" as const, makingValue: (makingPaise / 100).toFixed(2) } : {}),
      wastagePercent: (product.wastageBasisPoints ?? last?.wastageBasisPoints) ? String((product.wastageBasisPoints ?? last!.wastageBasisPoints) / 100) : line.wastagePercent,
      taxConfigurationId: product.taxConfigurationId ?? line.taxConfigurationId,
      // Saved selling price per piece fills the line; the bill is then priced per piece.
      unitPriceRupees: product.salePricePaise ? (product.salePricePaise / 100).toFixed(2) : "",
      savedPricePaise: product.salePricePaise || undefined,
      costPaise: product.purchasePricePaise,
    };
  }

  /** Gross typed: net follows it until the operator types a different net weight. */
  function typeGross(index: number, grossGrams: string) {
    const line = lines[index];
    updateLine(index, { grossGrams, ...(line.netGrams === "" || line.netGrams === line.grossGrams ? { netGrams: grossGrams } : {}) });
  }

  /** Adds a row (for a scanned box, already set to that box) and puts the cursor in it. */
  function addRow(boxId?: string) {
    const blank = blankLine(defaultTaxId);
    const line = boxId ? { ...blank, ...withBox(blank, boxId) } : blank;
    setLines((prev) => [...prev, line]);
    // Focus after React has rendered the new row; with a box already chosen, start at the description.
    setTimeout(() => document.querySelector<HTMLElement>(`[data-line="${line.key}"] ${boxId ? "input" : "select"}`)?.focus());
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // Same rule as the server: customer in another state → IGST, else CGST + SGST.
  const interState = isInterState(stateOfSupply || customers?.find((c) => c._id === customerId)?.state, access?.organization?.state);
  const computedLines = useMemo(
    () =>
      lines.map((line) => {
        const taxConfig = taxConfigs?.find((t) => t._id === (line.taxConfigurationId || defaultTaxId));
        let gstBasisPoints = 0;
        if (isGst) {
          if (line.isManualTax && line.manualGstPercent) {
            gstBasisPoints = percentToBasisPoints(line.manualGstPercent) ?? 0;
          } else if (taxConfig) {
            gstBasisPoints = gstRateBp(taxConfig, interState);
          }
        }
        const grossWeightMg = gramsToMg(line.grossGrams || "0");
        const netWeightMg = gramsToMg(line.netGrams || "0");
        const ratePerGramPaise = rupeesToPaise(line.ratePerGramRupees || "0") ?? 0;
        const unitPricePaise = rupeesToPaise(line.unitPriceRupees || "0") ?? 0;
        const pieces = piecesOf(line) || 0;
        const input = {
          unitPricePaise,
          pieces,
          grossWeightMg,
          stoneWeightMg: Math.max(0, grossWeightMg - netWeightMg),
          stockNetWeightMg: netWeightMg,
          otherDeductionMg: 0,
          ratePerGramPaise,
          wastageBasisPoints: percentToBasisPoints(line.wastagePercent || "0") ?? 0,
          makingChargePaise: makingChargeFor(line.makingMode, makingValueUnits(line.makingMode, line.makingValue), netWeightMg, unitPricePaise > 0 ? unitPricePaise * pieces : metalValuePaise(netWeightMg, ratePerGramPaise)),
          stoneChargePaise: rupeesToPaise(line.stoneChargeRupees || "0") ?? 0,
          gstBasisPoints,
        };
        const discount = lineDiscountPaise(line.discount, computeSaleLine(input).taxableValuePaise);
        return computeSaleLine({ ...input, lineDiscountPaise: discount });
      }),
    [lines, taxConfigs, isGst, interState, defaultTaxId, piecesOf],
  );

  /** Weight and pieces this bill takes from each box (several rows can share a box). */
  const takenByBox = useMemo(() => {
    const taken = new Map<string, { weightMg: number; pieces: number }>();
    for (const line of lines) {
      if (!line.boxId) continue;
      const row = taken.get(line.boxId) ?? { weightMg: 0, pieces: 0 };
      row.weightMg += gramsToMg(line.grossGrams || "0");
      row.pieces += Number(line.piecesText || 0) || 0;
      taken.set(line.boxId, row);
    }
    return taken;
  }, [lines]);

  /** On an edited bill, its own original lines are already out of the boxes — count them as available again. */
  const ownByBox = useMemo(() => {
    const own = new Map<string, { weightMg: number; pieces: number }>();
    for (const item of existingSale?.items ?? []) {
      if (!item.boxId) continue;
      const row = own.get(item.boxId) ?? { weightMg: 0, pieces: 0 };
      row.weightMg += item.stockWeightMg ?? item.grossWeightMg;
      row.pieces += item.pieces ?? (item.boxItemId ? 1 : 0);
      own.set(item.boxId, row);
    }
    return own;
  }, [existingSale]);

  function boxAvailable(boxId: string) {
    const box = boxById.get(boxId);
    if (!box) return null;
    const own = ownByBox.get(boxId) ?? { weightMg: 0, pieces: 0 };
    return { weightMg: box.weightMg + own.weightMg, pieces: box.pieces + own.pieces };
  }

  const lineErrors = useMemo(
    () =>
      lines.map((line, index) => {
        const box = boxById.get(line.boxId);
        if (!gstCompany && !line.boxId) return "Choose the box.";
        if (!line.label.trim()) return "Enter the description.";
        if (isLoose(line) && !line.productId) return "Pick the item from the Item List (or choose a box).";
        if (box?.metal && line.metal && box.metal !== line.metal) return `Box ${box.boxNumber} holds ${box.metal === "gold" ? "Gold" : "Silver"}.`;
        const pieces = piecesOf(line);
        if (!Number.isInteger(pieces) || pieces < 0) return "Pcs must be a whole number.";
        if (isLoose(line) && pieces < 1) return "Pcs must be 1 or more.";
        const checks: [string, string | null][] = [
          ["Gross wt", numberFieldError(line.grossGrams)],
          ["Net wt", numberFieldError(line.netGrams)],
          ["Rate/g", numberFieldError(line.ratePerGramRupees)],
          ["Making", numberFieldError(line.makingValue, line.makingMode === "percent" ? { max: 100 } : undefined)],
          ["Price / pc", numberFieldError(line.unitPriceRupees)],
        ];
        const failed = checks.find(([, error]) => error);
        if (failed) return `${failed[0]}: ${failed[1]}`;
        // Same rule as the server: only Owner/Admin may bill at anything but the saved price.
        const unitPaise = rupeesToPaise(line.unitPriceRupees || "0") ?? 0;
        const overridden = line.savedPricePaise ? unitPaise !== line.savedPricePaise : unitPaise > 0;
        if (overridden && pricingAccess && !canOverride) {
          return line.savedPricePaise
            ? `Only the Owner or an Admin can change the saved price (${formatPaise(line.savedPricePaise)}).`
            : "Only the Owner or an Admin can set a price per piece for an item with no saved price.";
        }
        const computed = computedLines[index];
        if (!(computed.grossWeightMg > 0)) return "Enter the gross weight.";
        if (!(computed.netWeightMg > 0)) return "Enter the net weight.";
        if (computed.netWeightMg > computed.grossWeightMg) return "Net weight cannot be more than gross weight.";
        if (!(computed.ratePerGramPaise > 0) && !(unitPaise > 0)) return "Enter the rate per gram (or a price per piece).";
        const available = line.boxId ? boxAvailable(line.boxId) : null;
        const taken = takenByBox.get(line.boxId);
        if (available && taken && prefs?.stopSaleOnNegativeStock !== false) {
          if (taken.weightMg > available.weightMg) return `Box ${box?.boxNumber} has only ${mgToGramsDisplay(available.weightMg)} g.`;
          if (taken.pieces > available.pieces) return `Box ${box?.boxNumber} has only ${available.pieces} pcs.`;
        }
        return null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boxAvailable reads boxById/ownByBox, listed here.
    [lines, computedLines, boxById, ownByBox, takenByBox, gstCompany, prefs, pricingAccess, canOverride],
  );

  /** Gold and silver subtotals for the summary (spec: combined bill shows both). */
  const metalTotals = useMemo(() => {
    const totals = { gold: { netMg: 0, paise: 0 }, silver: { netMg: 0, paise: 0 } };
    lines.forEach((line, index) => {
      const metal = line.metal || activePurities.find((p) => p._id === line.metalPurityId)?.metal;
      if (!metal) return;
      totals[metal].netMg += computedLines[index].netWeightMg;
      totals[metal].paise += computedLines[index].lineTotalPaise;
    });
    return totals;
  }, [lines, computedLines, activePurities]);

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
    setLines([blankLine(defaultTaxId)]);
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
                (t) => gstRateBp(t, interState) === manualBp,
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
            } else if ((line.taxConfigurationId || defaultTaxId) && line.taxConfigurationId !== "none") {
              taxConfigId = (line.taxConfigurationId || defaultTaxId) as Id<"taxConfigurations">;
            }
          }
          const grossWeightMg = gramsToMg(line.grossGrams || "0");
          const netWeightMg = gramsToMg(line.netGrams || "0");
          return {
            ...(isLoose(line)
              ? { stoneWeightMg: grossWeightMg - netWeightMg }
              : { boxId: line.boxId as Id<"boxes">, netWeightMg }),
            unitPricePaise: rupeesToPaise(line.unitPriceRupees || "0") || undefined,
            productId: line.productId ? (line.productId as Id<"products">) : undefined,
            label: line.label.trim(),
            metal: line.metal || undefined,
            grossWeightMg,
            pieces: piecesOf(line),
            metalPurityId: line.metalPurityId
              ? (line.metalPurityId as Id<"metalPurities">)
              : undefined,
            otherDeductionMg: 0,
            ratePerGramPaise: rupeesToPaise(line.ratePerGramRupees || "0") ?? 0,
            wastageBasisPoints: percentToBasisPoints(line.wastagePercent || "0") ?? 0,
            makingChargePaise: computedLines[index]?.makingChargePaise ?? 0,
            makingChargeMode: line.makingMode,
            makingChargeValue: makingValueUnits(line.makingMode, line.makingValue),
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
          stateOfSupply,
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
        stateOfSupply,
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
            Choose the box, enter gross and net weight, see every charge live, and save the bill.
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
        </div>
        <p className="text-sm text-muted-foreground">
          {editSaleId
            ? "Editing reverses the original stock and ledger effects, then reapplies the corrected ones."
            : "Choose the box, enter gross and net weight, see every charge live, and save the bill."}
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

        {prefs?.items.barcodeScan !== false && <BarcodeScanInput onBox={(box) => addRow(box._id)} />}

        {/* Item grid: one editable row per item. Daily Sales rows take their gross weight out of the chosen box. */}
        <Card className="border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="p-4 border-b bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-bold uppercase tracking-wide">
              Items in this bill ({lines.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {gstCompany
                ? "Bill is priced on net weight (or price per piece); the gross weight and pieces leave the selected box — or loose GST item stock when no box is chosen."
                : "Bill is priced on net weight (or price per piece); the gross weight and pieces are deducted from the selected box."}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <datalist id="bill-items">
              {products?.filter((p) => p.isActive && p.itemType !== "service").map((p) => <option key={p._id} value={p.name} />)}
            </datalist>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-left font-semibold text-muted-foreground">
                    <th className="py-2.5 px-2 w-8">SL</th>
                    <th className="py-2.5 px-2">BOX NO</th>
                    <th className="py-2.5 px-2">CATEGORY</th>
                    <th className="py-2.5 px-2">DESCRIPTION</th>
                    <th className="py-2.5 px-2">PURITY</th>
                    <th className="py-2.5 px-2">PCS</th>
                    <th className="py-2.5 px-2">GROSS WT (g)</th>
                    <th className="py-2.5 px-2">NET WT (g)</th>
                    <th className="py-2.5 px-2">RATE / G (₹)</th>
                    <th className="py-2.5 px-2">PRICE / PC (₹)</th>
                    {showCost && <th className="py-2.5 px-2">COST / MARGIN</th>}
                    <th className="py-2.5 px-2">MAKING</th>
                    <th className="py-2.5 px-2">DISC. (₹ / %)</th>
                    {isGst && <th className="py-2.5 px-2">TAX (GST)</th>}
                    <th className="py-2.5 px-2 text-right">AMOUNT (₹)</th>
                    <th className="py-2.5 px-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {lines.map((line, index) => {
                    const computed = computedLines[index];
                    const error = lineErrors[index];
                    const box = boxById.get(line.boxId);
                    const available = line.boxId ? boxAvailable(line.boxId) : null;
                    const taken = takenByBox.get(line.boxId);
                    return (
                      <tr
                        key={line.key}
                        data-line={line.key}
                        className="align-top hover:bg-muted/20"
                        onKeyDown={(e) => {
                          // Enter on the last row adds the next one (keyboard billing).
                          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && index === lines.length - 1) {
                            e.preventDefault();
                            addRow();
                          }
                        }}
                      >
                        <td className="py-2 px-2 pt-3.5 font-mono text-muted-foreground">{String(index + 1).padStart(2, "0")}</td>
                        {(
                          <td className="py-2 px-2">
                            <BoxPicker
                              ariaLabel={`Row ${index + 1} box`}
                              boxes={boxes as BoxRow[]}
                              purities={activePurities}
                              rateByPurity={rateByPurity}
                              value={line.boxId}
                              metal={line.metal}
                              priceKind="sale"
                              emptyLabel={gstCompany ? "Loose GST stock" : undefined}
                              onPick={(boxId, entry) => pickBoxItem(index, boxId, entry)}
                            />
                            {box && available && (
                              <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                                Has {mgToGramsDisplay(available.weightMg)} g · {available.pieces} pcs
                                {taken ? ` → ${mgToGramsDisplay(available.weightMg - taken.weightMg)} g` : ""}
                              </p>
                            )}
                          </td>
                        )}
                        <td className="py-2 px-2">
                          <select
                            aria-label={`Row ${index + 1} category`}
                            className="h-8 w-20 rounded-md border bg-background px-2 text-xs"
                            value={line.metal}
                            onChange={(e) => pickMetal(index, e.target.value as Metal | "")}
                          >
                            <option value="">—</option>
                            <option value="gold">Gold</option>
                            <option value="silver">Silver</option>
                          </select>
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            aria-label={`Row ${index + 1} description`}
                            list="bill-items"
                            placeholder="Item name"
                            value={line.label}
                            maxLength={80}
                            onChange={(e) => typeDescription(index, e.target.value)}
                            className={`${cellInput} w-40`}
                          />
                          {line.label.trim() && !line.productId && !isLoose(line) && (
                            <p className="mt-1 text-[10px] text-muted-foreground">New item — added to Item List on save</p>
                          )}
                          {isLoose(line) && line.productId && (() => {
                            const stock = gstStock?.find((row) => row.productId === line.productId);
                            return <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">Loose GST stock: {mgToGramsDisplay(stock?.looseWeightMg ?? 0)} g · {stock?.loosePieces ?? 0} pcs</p>;
                          })()}
                          {line.productId && productById.get(line.productId as Id<"products">)?.sku && (
                            <p className="mt-1 text-[10px] text-muted-foreground">Code {productById.get(line.productId as Id<"products">)?.sku}</p>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <select
                            aria-label={`Row ${index + 1} purity`}
                            className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
                            value={line.metalPurityId}
                            onChange={(e) => pickPurity(index, e.target.value)}
                          >
                            <option value="">—</option>
                            {activePurities.filter((p) => !line.metal || p.metal === line.metal).map((p) => (
                              <option key={p._id} value={p._id}>{p.label}</option>
                            ))}
                          </select>
                          {!line.metalPurityId && line.productId && productById.get(line.productId as Id<"products">)?.purityOther && (
                            <p className="mt-1 text-[10px] text-muted-foreground">{productById.get(line.productId as Id<"products">)?.purityOther}</p>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Input aria-label={`Row ${index + 1} pieces`} inputMode="numeric" placeholder={isLoose(line) ? "1" : "0"} value={line.piecesText} onChange={(e) => typePieces(index, e.target.value)} className={`${cellInput} w-14 text-right`} />
                        </td>
                        <td className="py-2 px-2">
                          <Input aria-label={`Row ${index + 1} gross weight`} inputMode="decimal" placeholder="0.000" value={line.grossGrams} onChange={(e) => typeGross(index, e.target.value)} className={`${cellInput} w-20 text-right font-mono`} />
                        </td>
                        <td className="py-2 px-2">
                          <Input aria-label={`Row ${index + 1} net weight`} inputMode="decimal" placeholder="0.000" value={line.netGrams} onChange={(e) => updateLine(index, { netGrams: e.target.value })} className={`${cellInput} w-20 text-right font-mono text-emerald-600`} />
                        </td>
                        <td className="py-2 px-2">
                          <Input aria-label={`Row ${index + 1} rate per gram`} inputMode="decimal" placeholder="0.00" value={line.ratePerGramRupees} onChange={(e) => updateLine(index, { ratePerGramRupees: e.target.value })} className={`${cellInput} w-24 text-right font-mono`} />
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            aria-label={`Row ${index + 1} price per piece`}
                            inputMode="decimal"
                            placeholder="by rate/g"
                            value={line.unitPriceRupees}
                            disabled={!canOverride && line.savedPricePaise !== undefined}
                            title={!canOverride && line.savedPricePaise !== undefined ? "Saved selling price — only the Owner or an Admin can change it" : "Leave blank to price by net weight × rate per gram"}
                            onChange={(e) => updateLine(index, { unitPriceRupees: e.target.value })}
                            className={`${cellInput} w-24 text-right font-mono`}
                          />
                          {line.savedPricePaise !== undefined && (rupeesToPaise(line.unitPriceRupees || "0") ?? 0) !== line.savedPricePaise && (
                            <p className="mt-1 text-[10px] text-amber-600">Saved {formatPaise(line.savedPricePaise)} · override</p>
                          )}
                        </td>
                        {showCost && (
                          <td className="py-2 px-2 pt-3.5 font-mono text-muted-foreground">
                            {line.costPaise !== undefined ? formatPaise(line.costPaise * (piecesOf(line) || 1)) : "—"}
                            {line.costPaise !== undefined && (
                              <p className={`text-[10px] ${computed.taxableValuePaise - line.costPaise * (piecesOf(line) || 1) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                                Margin {formatPaise(computed.taxableValuePaise - line.costPaise * (piecesOf(line) || 1))}
                              </p>
                            )}
                          </td>
                        )}
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <select
                              aria-label={`Row ${index + 1} making charge type`}
                              className="h-8 rounded-md border bg-background px-1 text-xs"
                              value={line.makingMode}
                              onChange={(e) => updateLine(index, { makingMode: e.target.value as MakingMode })}
                            >
                              {MAKING_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                            <Input aria-label={`Row ${index + 1} making charge`} inputMode="decimal" placeholder="0" value={line.makingValue} onChange={(e) => updateLine(index, { makingValue: e.target.value })} className={`${cellInput} w-16 text-right`} />
                          </div>
                          {line.makingMode !== "fixed" && computed.makingChargePaise > 0 && (
                            <p className="mt-1 text-[10px] text-muted-foreground">= {formatPaise(computed.makingChargePaise)}</p>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Input aria-label={`Row ${index + 1} discount`} placeholder="0 or 5%" value={line.discount} onChange={(e) => updateLine(index, { discount: e.target.value })} className={`${cellInput} w-20 text-right`} />
                        </td>
                        {isGst && (
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1.5">
                              <Select
                                value={line.isManualTax ? "manual" : line.taxConfigurationId || defaultTaxId || "none"}
                                onValueChange={(val) => {
                                  if (val === "manual") updateLine(index, { isManualTax: true, manualGstPercent: "3.0" });
                                  else updateLine(index, { isManualTax: false, taxConfigurationId: val });
                                }}
                              >
                                <SelectTrigger className="h-8 w-28 text-[11px]">
                                  <SelectValue placeholder="Tax" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">0% (Nil)</SelectItem>
                                  {taxConfigs?.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                                  <SelectItem value="manual">Manual GST...</SelectItem>
                                </SelectContent>
                              </Select>
                              {line.isManualTax && (
                                <Input inputMode="decimal" placeholder="3.0" value={line.manualGstPercent || ""} onChange={(e) => updateLine(index, { manualGstPercent: e.target.value })} className="h-8 w-16 text-xs text-right" title="Custom GST %" />
                              )}
                            </div>
                          </td>
                        )}
                        <td className="py-2 px-2 pt-3.5 text-right font-bold text-foreground tabular-nums">
                          {formatPaise(computed.lineTotalPaise)}
                          {error && <p className="mt-1 max-w-40 text-left text-[10px] font-medium text-destructive">{error}</p>}
                        </td>
                        <td className="py-2 px-2">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" aria-label={`Remove row ${index + 1}`} onClick={() => removeLine(index)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-muted/20 font-semibold">
                      <td colSpan={5} className="py-2 px-2 text-right text-muted-foreground">Total</td>
                      <td className="py-2 px-2 text-right tabular-nums">{lines.reduce((sum, l) => sum + (piecesOf(l) || 0), 0)}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums">{mgToGramsDisplay(computedLines.reduce((sum, l) => sum + l.grossWeightMg, 0))}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-600">{mgToGramsDisplay(computedLines.reduce((sum, l) => sum + l.netWeightMg, 0))}</td>
                      <td colSpan={4 + (showCost ? 1 : 0) + (isGst ? 1 : 0)} />
                      <td className="py-2 px-2 text-right tabular-nums">{formatPaise(computedLines.reduce((sum, l) => sum + l.lineTotalPaise, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
              <Button type="button" variant="outline" size="sm" onClick={() => addRow()}>
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>
              <p className="text-[11px] text-muted-foreground">Tip: press Enter in the last row to add a new row. Typing an item name or code fills its purity, price and making charge.</p>
            </div>
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
              {(["gold", "silver"] as const).filter((metal) => metalTotals[metal].paise > 0).map((metal) => (
                <div key={metal} className="flex justify-between text-xs text-muted-foreground">
                  <span>{metal === "gold" ? "Gold" : "Silver"} items ({mgToGramsDisplay(metalTotals[metal].netMg)} g net)</span>
                  <span className="font-mono">{formatPaise(metalTotals[metal].paise)}</span>
                </div>
              ))}
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

              <div className={`flex items-center justify-between text-xs font-semibold ${totals.balancePaise > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                <span className="flex items-center gap-2">
                  Balance Amount
                  <Badge variant="outline" className="text-[10px] font-semibold">
                    {totals.totalPaise > 0 && totals.balancePaise <= 0 ? "Paid" : totals.amountPaidPaise > 0 ? "Partial" : "Unpaid"}
                  </Badge>
                </span>
                <span className="font-mono">{formatPaise(Math.max(0, totals.balancePaise))}</span>
              </div>

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
