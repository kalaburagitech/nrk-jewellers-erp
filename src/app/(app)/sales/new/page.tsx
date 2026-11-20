"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { BarcodeScanInput } from "@/components/barcode-scan-input";
import { BoxPicker } from "@/components/box-picker";
import type { BoxEntryRow } from "@/components/box-items";
import { gstRateBp, isInterState } from "@/lib/gst-rate";
import { Calculator, Coins, FileText, Gem, MessageCircle, Minus, Pause, Plus, Printer, Receipt, Save, Scale, Search, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { HeldBillTabs, HeldDeleteConfirm } from "@/components/held-bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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

/** New Bill gold layout: panels, headings and the item table. */
const goldPanel = "overflow-hidden rounded-xl border border-amber-300/80 bg-gradient-to-b from-amber-50/90 to-card shadow-sm dark:border-amber-500/30 dark:from-amber-950/30";
const goldHead = "flex items-center gap-2 border-b border-amber-200/80 bg-gradient-to-r from-amber-100 via-amber-50/60 to-transparent px-3 py-2 font-serif text-[15px] font-bold text-amber-950 dark:border-amber-500/20 dark:from-amber-900/40 dark:via-amber-950/10 dark:text-amber-100";
const goldIcon = "h-4 w-4 text-amber-600 dark:text-amber-400";
const formRow = "grid grid-cols-[84px_1fr] items-center gap-2";
const formLabel = "text-xs font-medium text-muted-foreground";
const thCls = "border-r border-amber-600/40 px-1.5 py-2 text-center text-[11px] font-semibold leading-tight text-amber-50 last:border-r-0";
const tdCls = "border-r border-amber-200/70 px-1 py-1 align-top last:border-r-0 dark:border-amber-500/15";
const tblInput = "h-8 px-1.5 text-sm";
const pillBtn = "h-9 rounded-full border-amber-300 bg-card px-4 text-amber-900 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-100 dark:hover:bg-amber-950/40";

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

/** Everything on the New Bill form, saved when a bill is put on hold. */
type HeldDraft = {
  invoiceNumber: string;
  billDate: string;
  customerId: string;
  customerNameInput: string;
  customerPhoneInput: string;
  isGst: boolean;
  stateOfSupply: string;
  lines: BillLine[];
  oldItemDeductionRupees: string;
  oldItemEnabled: boolean;
  oldItemDeductionNote: string;
  discountMode: "none" | "percent" | "fixed";
  discountValue: string;
  payments: { mode: PaymentMode; amountRupees: string }[];
  payFull: boolean;
  dueDate: string;
  oldGoldEnabled: boolean;
  oldGoldPurityId: string;
  oldGoldGrossGrams: string;
  oldGoldMeltingPercent: string;
  oldGoldRateRupees: string;
  isCredit: boolean;
  notes: string;
  terms: string;
};

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
  // Held bills: a bill parked with "Hold" so the counter can serve another customer, then finish it later.
  const heldParam = searchParams.get("held") as Id<"heldBills"> | null;
  const heldBillToOpen = useQuery(api.heldBills.get, heldParam && !editSaleId ? { heldBillId: heldParam } : "skip");
  const holdBillMutation = useMutation(api.heldBills.hold);
  const removeHeldBill = useMutation(api.heldBills.remove);
  // The held bill whose delete button was pressed once; a second press ("Yes") deletes it.
  const [confirmDeleteHeldId, setConfirmDeleteHeldId] = useState<string | null>(null);
  const [heldBillId, setHeldBillId] = useState<Id<"heldBills"> | null>(null);
  const [restoredHeldId, setRestoredHeldId] = useState<string | null>(null);
  const [holdNotice, setHoldNotice] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);

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

  // Reopening a held bill (?held=...) puts its saved form back, once per bill.
  useEffect(() => {
    if (!heldParam || editSaleId || restoredHeldId === heldParam || heldBillToOpen === undefined) return;
    setRestoredHeldId(heldParam);
    if (heldBillToOpen === null) {
      setServerError("That held bill was already billed or removed.");
      return;
    }
    let draft: Partial<HeldDraft>;
    try {
      draft = JSON.parse(heldBillToOpen.draft) as Partial<HeldDraft>;
    } catch {
      setServerError("Could not open that held bill.");
      return;
    }
    setHeldBillId(heldBillToOpen._id);
    setIdempotencyKey(crypto.randomUUID());
    setInvoiceNumber(draft.invoiceNumber ?? "");
    setBillDate(draft.billDate || todayDateInput());
    setCustomerId(draft.customerId ?? "");
    setCustomerNameInput(draft.customerNameInput ?? "");
    setCustomerPhoneInput(draft.customerPhoneInput ?? "");
    if (typeof draft.isGst === "boolean") setIsGst(draft.isGst);
    if (draft.stateOfSupply) setStateOfSupply(draft.stateOfSupply);
    setLines(draft.lines?.length ? draft.lines : [blankLine("")]);
    setOldItemDeductionRupees(draft.oldItemDeductionRupees ?? "0");
    setOldItemEnabled(Boolean(draft.oldItemEnabled));
    setOldItemDeductionNote(draft.oldItemDeductionNote ?? "");
    setDiscountMode(draft.discountMode ?? "none");
    setDiscountValue(draft.discountValue ?? "");
    setPayments(draft.payments?.length ? draft.payments : [{ mode: "cash", amountRupees: "" }]);
    setPayFull(Boolean(draft.payFull));
    setDueDate(draft.dueDate ?? "");
    setOldGoldEnabled(Boolean(draft.oldGoldEnabled));
    setOldGoldPurityId(draft.oldGoldPurityId ?? "");
    setOldGoldGrossGrams(draft.oldGoldGrossGrams ?? "");
    setOldGoldMeltingPercent(draft.oldGoldMeltingPercent ?? "");
    setOldGoldRateRupees(draft.oldGoldRateRupees ?? "");
    setIsCredit(Boolean(draft.isCredit));
    setNotes(draft.notes ?? "");
    setShowNotes(Boolean(draft.notes));
    setTerms(draft.terms ?? "");
    setShowTerms(Boolean(draft.terms));
    setServerError(null);
    setHoldNotice(null);
  }, [heldParam, editSaleId, restoredHeldId, heldBillToOpen]);
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
    setIsCredit(false);
    setNotes("");
    setShowNotes(false);
    setTerms("");
    setShowTerms(false);
    setServerError(null);
    setHeldBillId(null);
  }

  /** True once anything has been entered, so switching bills never silently drops work. */
  function billHasContent() {
    return Boolean(
      customerId ||
        customerNameInput.trim() ||
        lines.some((l) => l.boxId || l.label.trim() || l.grossGrams || l.netGrams || l.unitPriceRupees),
    );
  }

  /** Parks the current bill as a held bill. Returns false (with a message) if it could not. */
  async function holdCurrentBill(): Promise<boolean> {
    if (!billHasContent()) {
      setServerError("Nothing to hold yet - add a customer or an item first.");
      return false;
    }
    const draft: HeldDraft = {
      invoiceNumber, billDate, customerId, customerNameInput, customerPhoneInput, isGst, stateOfSupply, lines,
      oldItemDeductionRupees, oldItemEnabled, oldItemDeductionNote, discountMode, discountValue, payments, payFull,
      dueDate, oldGoldEnabled, oldGoldPurityId, oldGoldGrossGrams, oldGoldMeltingPercent, oldGoldRateRupees,
      isCredit, notes, terms,
    };
    const name = customerNameInput.trim() || customers?.find((c) => c._id === customerId)?.name || "Walk-in customer";
    setHolding(true);
    try {
      await holdBillMutation({
        heldBillId: heldBillId ?? undefined,
        customerName: name,
        itemCount: lines.filter((l) => l.boxId || l.label.trim()).length,
        totalPaise: totals.totalPaise,
        draft: JSON.stringify(draft),
      });
      resetForm();
      setHoldNotice(`Bill for ${name} is on hold. Click its yellow tab above to finish it when the customer is ready.`);
      return true;
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not hold the bill."));
      return false;
    } finally {
      setHolding(false);
    }
  }

  /** Cancels a held bill for good (the customer left). If it is the bill on screen, the screen is cleared too. */
  async function deleteHeldBill(id: Id<"heldBills">, name: string) {
    setConfirmDeleteHeldId(null);
    setServerError(null);
    try {
      await removeHeldBill({ heldBillId: id });
      if (id === heldBillId) {
        resetForm();
        if (heldParam) router.replace("/sales/new");
      }
      setHoldNotice(`Held bill for ${name} deleted.`);
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not delete the held bill."));
    }
  }

  async function holdBill() {
    if ((await holdCurrentBill()) && heldParam) router.replace("/sales/new");
  }

  /** "+": start a blank bill; the one on screen (if any) is put on hold first. */
  async function startNewBill() {
    if (billHasContent()) {
      await holdBill();
      return;
    }
    resetForm();
    if (heldParam) router.replace("/sales/new");
  }

  /** Opens a held bill; the bill on screen (if any) is put on hold first so nothing is lost. */
  async function openHeldBill(id: Id<"heldBills">) {
    if (id === heldBillId) return;
    if (billHasContent() && !(await holdCurrentBill())) return;
    setRestoredHeldId(null);
    router.push(`/sales/new?held=${id}`);
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
        heldBillId: heldBillId ?? undefined,
      });
      if (dueDateMs) await setCustomerDueDate({ id: resolvedCustomerId, dueDateMs });
      if (after === "print") {
        router.push(`/sales/invoices/${result.saleId}/print`);
      } else if (after === "printShare") {
        router.push(`/sales/invoices/${result.saleId}/print?autoShare=1`);
      } else if (after === "new") {
        resetForm();
        setHoldNotice(null);
        if (heldParam) router.replace("/sales/new");
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

  // Account balance panel: the picked customer's running balance (positive = they owe the shop).
  const selectedCustomer = customerId ? customers.find((c) => c._id === customerId) : undefined;
  const customerDuesPaise = selectedCustomer ? (selectedCustomer.currentBalancePaise ?? selectedCustomer.openingBalancePaise ?? 0) : 0;
  const ratesWithLatest = (currentRates ?? []).filter((r) => r.latest);
  const ratesAsOf = ratesWithLatest.length > 0 ? Math.max(...ratesWithLatest.map((r) => r.latest!.effectiveAt)) : null;
  const sumPieces = lines.reduce((sum, l) => sum + (piecesOf(l) || 0), 0);
  const sumGrossMg = computedLines.reduce((sum, l) => sum + l.grossWeightMg, 0);
  const sumNetMg = computedLines.reduce((sum, l) => sum + l.netWeightMg, 0);
  const sumStoneMg = Math.max(0, sumGrossMg - sumNetMg);
  const sumMakingPaise = computedLines.reduce((sum, l) => sum + l.makingChargePaise, 0);
  const sumLineDiscountPaise = computedLines.reduce((sum, l) => sum + (l.lineDiscountPaise ?? 0), 0);
  const columnCount = 15 + (isGst ? 1 : 0) + (showCost ? 1 : 0);

  return (
    <div className="erp-fill flex w-full flex-col">
    <div className="erp-scroll flex min-h-0 flex-1 flex-col gap-3 pb-3 lg:overflow-y-auto lg:pr-1">
      {/* Title banner */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/80 bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 px-4 py-2.5 shadow-sm dark:border-amber-500/30 dark:from-amber-950/50 dark:via-amber-900/30 dark:to-amber-950/50">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-amber-400 to-amber-600 text-white shadow">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-amber-950 dark:text-amber-100">
              {editSaleId ? "Edit Bill" : "Sales Billing"}
            </h1>
            <p className="text-xs text-amber-900/70 dark:text-amber-200/70">
              {editSaleId
                ? "Editing reverses the original stock and ledger effects, then reapplies the corrected ones."
                : "Choose the box, enter gross and net weight, see every charge live, and save the bill."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Credit / Cash */}
          <div className="flex items-center gap-2 rounded-full border border-amber-300/80 bg-card/80 px-3 py-1 text-xs">
            <span className={`font-semibold ${isCredit ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>Credit</span>
            <Switch checked={!isCredit} onCheckedChange={(checked) => setIsCredit(!checked)} />
            <span className={`font-semibold ${!isCredit ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>Cash</span>
          </div>
          {/* Daily Sales vs GST */}
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isGst
                  ? "border border-primary/20 bg-primary/10 text-primary"
                  : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
              }`}
            >
              {isGst ? "GST Tax Invoice" : "Daily Sales · Counter"}
            </span>
            {!gstCompany && (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground underline" onClick={() => setIsGst(!isGst)}>
                Switch to {isGst ? "Daily Sales" : "GST Invoice"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Bill tabs: this bill, held bills, + new */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/80 bg-card px-3 py-1.5 text-xs font-semibold shadow-xs">
          <span>{heldBillId ? `Held · ${customerNameInput.trim() || "Walk-in customer"}` : "Sale #1"}</span>
          {heldBillId && confirmDeleteHeldId === heldBillId ? (
            <HeldDeleteConfirm
              onYes={() => void deleteHeldBill(heldBillId, customerNameInput.trim() || "Walk-in customer")}
              onNo={() => setConfirmDeleteHeldId(null)}
            />
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => (heldBillId ? setConfirmDeleteHeldId(heldBillId) : resetForm())}
              title={heldBillId ? "Delete this held bill (the customer left)" : "Reset bill"}
              aria-label={heldBillId ? "Delete this held bill" : "Reset bill"}
            >
              ×
            </button>
          )}
        </div>
        {!editSaleId && (
          <HeldBillTabs
            kind="sale"
            currentId={heldBillId}
            disabled={holding}
            onOpen={(id) => void openHeldBill(id)}
            onDeleted={(name) => setHoldNotice(`Held bill for ${name} deleted.`)}
            onError={setServerError}
          />
        )}
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded border border-dashed text-xs text-muted-foreground hover:text-foreground"
          onClick={() => void startNewBill()}
          title="New sale (the bill on screen is put on hold)"
          aria-label="New sale"
        >
          +
        </button>
      </div>

      {/* Top panels: Bill Details · Metal Details · Account Balance */}
      <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-3">
        <section className={`${goldPanel} overflow-visible`}>
          <h2 className={goldHead}>
            <FileText className={goldIcon} /> Bill Details
          </h2>
          <div className="space-y-2 p-3">
            <div className={formRow}>
              <Label className={formLabel}>Bill No.</Label>
              <Input
                aria-label="Invoice serial number"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={18}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="Auto or #5"
                className="h-8 font-mono text-sm font-bold"
              />
            </div>
            <div className={formRow}>
              <Label className={formLabel}>Date</Label>
              <Input type="date" className="h-8 text-sm" value={billDate} max={todayDateInput()} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div className={`${formRow} items-start`}>
              <div className="pt-2">
                <Label className={formLabel}>Customer</Label>
                <button type="button" className="mt-1 block text-[10px] font-bold text-amber-700 hover:underline dark:text-amber-300" onClick={() => setPartiesDialogOpen(true)}>
                  SHOW PARTIES
                </button>
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
            <div className={formRow}>
              <Label className={formLabel}>State</Label>
              <Select value={stateOfSupply} onValueChange={setStateOfSupply}>
                <SelectTrigger className="h-8 text-sm">
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
        </section>

        <section className={goldPanel}>
          <h2 className={goldHead}>
            <Coins className={goldIcon} /> Metal Details
            <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> LIVE
            </span>
          </h2>
          <div className="space-y-1.5 p-3 text-sm">
            {!currentRates ? (
              <p className="text-xs text-muted-foreground">Loading daily metal rates…</p>
            ) : ratesWithLatest.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Daily metal rates have not been set.{" "}
                <Link href="/metal-rates" className="font-semibold text-amber-700 underline">Set gold & silver rates →</Link>
              </p>
            ) : (
              ratesWithLatest.map(({ purity, latest }) => (
                <div key={purity._id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {purity.metal === "gold" ? "Gold" : "Silver"} <span className="font-medium text-foreground">{purity.label}</span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{formatPaise(latest!.ratePerGramPaise)}/g</span>
                </div>
              ))
            )}
            {ratesAsOf && (
              <div className="flex items-center justify-between border-t border-amber-200/70 pt-1.5 text-[11px] text-muted-foreground dark:border-amber-500/20">
                <span>Rate as of {new Date(ratesAsOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                <Link href="/metal-rates" className="font-semibold text-amber-700 hover:underline dark:text-amber-300">Update rates</Link>
              </div>
            )}
            {(metalTotals.gold.netMg > 0 || metalTotals.silver.netMg > 0) && (
              <div className="space-y-0.5 border-t border-amber-200/70 pt-1.5 text-xs dark:border-amber-500/20">
                {(["gold", "silver"] as const).filter((metal) => metalTotals[metal].netMg > 0).map((metal) => (
                  <div key={metal} className="flex justify-between">
                    <span className="text-muted-foreground">{metal === "gold" ? "Gold" : "Silver"} in this bill</span>
                    <span className="font-mono tabular-nums">{mgToGramsDisplay(metalTotals[metal].netMg)} g net</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={goldPanel}>
          <h2 className={goldHead}>
            <Scale className={goldIcon} /> Account Balance
          </h2>
          <div className="space-y-2.5 p-3 text-sm">
            {selectedCustomer ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{customerDuesPaise >= 0 ? "Customer Dues" : "Advance Paid"}</span>
                  <span className={`font-mono text-lg font-bold tabular-nums ${customerDuesPaise > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatPaise(Math.abs(customerDuesPaise))}
                  </span>
                </div>
                {!editSaleId && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">This bill balance</span>
                      <span className="font-mono tabular-nums">{formatPaise(totals.balancePaise)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-amber-200/80 to-amber-100/60 px-3 py-2 dark:from-amber-800/40 dark:to-amber-900/20">
                      <span className="font-bold">Balance</span>
                      <span className="font-mono text-lg font-bold tabular-nums">{formatPaise(customerDuesPaise + totals.balancePaise)}</span>
                    </div>
                  </>
                )}
                {editSaleId && <p className="text-[11px] text-muted-foreground">Dues already include this bill as it was saved.</p>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {customerNameInput.trim() ? "New customer — no previous balance." : "Walk-in customer. Pick a customer to see their dues."}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Dialog for SHOW PARTIES */}
      <Dialog open={partiesDialogOpen} onOpenChange={setPartiesDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Select Party</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Search party by name or phone..." value={partySearch} onChange={(e) => setPartySearch(e.target.value)} className="h-9 text-xs" />
            <div className="max-h-72 divide-y divide-border/60 overflow-y-auto">
              {customers
                ?.filter((c) => c.name.toLowerCase().includes(partySearch.toLowerCase()) || c.phone?.includes(partySearch))
                .map((c) => (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() => {
                      selectExistingCustomer(c);
                      setPartiesDialogOpen(false);
                    }}
                    className="flex w-full items-center justify-between p-2.5 text-left text-xs transition hover:bg-muted/40"
                  >
                    <div>
                      <p className="font-semibold text-foreground">{c.name}</p>
                      <p className="text-muted-foreground">{c.phone || "No phone"}</p>
                    </div>
                    <span className="font-semibold tabular-nums text-primary">{formatPaise(c.currentBalancePaise ?? c.openingBalancePaise ?? 0)}</span>
                  </button>
                ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {prefs?.items.barcodeScan !== false && <BarcodeScanInput onBox={(box) => addRow(box._id)} />}

      {/* Item table: one row per item. Daily Sales rows take their gross weight out of the chosen box. */}
      <section className={`${goldPanel} shrink-0`}>
        <datalist id="bill-items">
          {products?.filter((p) => p.isActive && p.itemType !== "service").map((p) => <option key={p._id} value={p.name} />)}
        </datalist>
        <div className="erp-scroll overflow-auto lg:max-h-[56svh]">
          <table className="w-full min-w-[1280px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gradient-to-b from-amber-700 to-amber-800 dark:from-amber-800 dark:to-amber-900">
              <tr>
                <th className={`${thCls} w-10`}>Sl. No.</th>
                <th className={`${thCls} w-36`}>Box No.</th>
                <th className={`${thCls} w-20`}>Category</th>
                <th className={`${thCls} min-w-40`}>Description</th>
                <th className={`${thCls} w-20`}>Purity</th>
                <th className={`${thCls} w-14`}>Pcs<br /><span className="font-normal opacity-80">(optional)</span></th>
                <th className={`${thCls} w-20`}>Gross Wt<br />(g)</th>
                <th className={`${thCls} w-16`}>Stone Wt<br />(g)</th>
                <th className={`${thCls} w-20`}>Net Wt<br />(g)</th>
                <th className={`${thCls} w-20`}>Rate<br />(₹/g)</th>
                <th className={`${thCls} w-20`}>Price / pc<br />(₹)</th>
                <th className={`${thCls} w-32`}>Making</th>
                <th className={`${thCls} w-20`}>Discount<br />(₹ / %)</th>
                {isGst && <th className={`${thCls} w-28`}>GST</th>}
                {showCost && <th className={`${thCls} w-24`}>Cost /<br />Margin</th>}
                <th className={`${thCls} w-24`}>Total (₹)</th>
                <th className={`${thCls} w-9`}><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const computed = computedLines[index];
                const error = lineErrors[index];
                const box = boxById.get(line.boxId);
                const available = line.boxId ? boxAvailable(line.boxId) : null;
                const taken = takenByBox.get(line.boxId);
                const product = line.productId ? productById.get(line.productId as Id<"products">) : undefined;
                return (
                  <Fragment key={line.key}>
                    <tr
                      data-line={line.key}
                      className={`border-b border-amber-200/70 dark:border-amber-500/15 ${index % 2 ? "bg-amber-50/50 dark:bg-amber-950/10" : "bg-card"} hover:bg-amber-100/40 dark:hover:bg-amber-900/20`}
                      onKeyDown={(e) => {
                        // Enter on the last item adds the next one (keyboard billing).
                        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && index === lines.length - 1) {
                          e.preventDefault();
                          addRow();
                        }
                      }}
                    >
                      <td className={`${tdCls} pt-2.5 text-center font-semibold text-amber-900 dark:text-amber-200`}>{index + 1}</td>
                      <td className={tdCls}>
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
                          triggerClassName="w-full min-w-0"
                        />
                        {box && available && (
                          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                            Has {mgToGramsDisplay(available.weightMg)} g · {available.pieces} pcs
                            {taken ? ` → ${mgToGramsDisplay(available.weightMg - taken.weightMg)} g` : ""}
                          </p>
                        )}
                      </td>
                      <td className={tdCls}>
                        <select
                          aria-label={`Row ${index + 1} category`}
                          className="h-8 w-full min-w-0 rounded-md border bg-background px-1 text-sm"
                          value={line.metal}
                          onChange={(e) => pickMetal(index, e.target.value as Metal | "")}
                        >
                          <option value="">—</option>
                          <option value="gold">Gold</option>
                          <option value="silver">Silver</option>
                        </select>
                      </td>
                      <td className={tdCls}>
                        <Input
                          aria-label={`Row ${index + 1} description`}
                          list="bill-items"
                          placeholder="Item name"
                          value={line.label}
                          maxLength={80}
                          onChange={(e) => typeDescription(index, e.target.value)}
                          className={`${tblInput} w-full min-w-0`}
                        />
                        {line.label.trim() && !line.productId && !isLoose(line) && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">New item — added to Item List on save</p>
                        )}
                        {isLoose(line) && line.productId && (() => {
                          const stock = gstStock?.find((row) => row.productId === line.productId);
                          return <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">Loose GST stock: {mgToGramsDisplay(stock?.looseWeightMg ?? 0)} g · {stock?.loosePieces ?? 0} pcs</p>;
                        })()}
                        {product?.sku && <p className="mt-0.5 text-[10px] text-muted-foreground">Code {product.sku}</p>}
                      </td>
                      <td className={tdCls}>
                        <select
                          aria-label={`Row ${index + 1} purity`}
                          className="h-8 w-full min-w-0 rounded-md border bg-background px-1 text-sm"
                          value={line.metalPurityId}
                          onChange={(e) => pickPurity(index, e.target.value)}
                        >
                          <option value="">—</option>
                          {activePurities.filter((p) => !line.metal || p.metal === line.metal).map((p) => (
                            <option key={p._id} value={p._id}>{p.label}</option>
                          ))}
                        </select>
                        {!line.metalPurityId && product?.purityOther && <p className="mt-0.5 text-[10px] text-muted-foreground">{product.purityOther}</p>}
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${index + 1} pieces`} inputMode="numeric" placeholder={isLoose(line) ? "1" : "0"} value={line.piecesText} onChange={(e) => typePieces(index, e.target.value)} className={`${tblInput} w-full min-w-0 text-right`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${index + 1} gross weight`} inputMode="decimal" placeholder="0.000" value={line.grossGrams} onChange={(e) => typeGross(index, e.target.value)} className={`${tblInput} w-full min-w-0 text-right font-mono`} />
                      </td>
                      <td className={`${tdCls} pt-2.5 text-right font-mono text-xs text-muted-foreground tabular-nums`}>
                        {computed.stoneWeightMg > 0 ? mgToGramsDisplay(computed.stoneWeightMg) : "—"}
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${index + 1} net weight`} inputMode="decimal" placeholder="0.000" value={line.netGrams} onChange={(e) => updateLine(index, { netGrams: e.target.value })} className={`${tblInput} w-full min-w-0 text-right font-mono text-emerald-600`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${index + 1} rate per gram`} inputMode="decimal" placeholder="0.00" value={line.ratePerGramRupees} onChange={(e) => updateLine(index, { ratePerGramRupees: e.target.value })} className={`${tblInput} w-full min-w-0 text-right font-mono`} />
                      </td>
                      <td className={tdCls}>
                        <Input
                          aria-label={`Row ${index + 1} price per piece`}
                          inputMode="decimal"
                          placeholder="by rate/g"
                          value={line.unitPriceRupees}
                          disabled={!canOverride && line.savedPricePaise !== undefined}
                          title={!canOverride && line.savedPricePaise !== undefined ? "Saved selling price — only the Owner or an Admin can change it" : "Leave blank to price by net weight × rate per gram"}
                          onChange={(e) => updateLine(index, { unitPriceRupees: e.target.value })}
                          className={`${tblInput} w-full min-w-0 text-right font-mono`}
                        />
                        {line.savedPricePaise !== undefined && (rupeesToPaise(line.unitPriceRupees || "0") ?? 0) !== line.savedPricePaise && (
                          <p className="mt-0.5 text-[10px] text-amber-600">Saved {formatPaise(line.savedPricePaise)} · override</p>
                        )}
                      </td>
                      <td className={tdCls}>
                        <div className="flex min-w-0 items-center gap-1">
                          <select
                            aria-label={`Row ${index + 1} making charge type`}
                            className="h-8 shrink-0 rounded-md border bg-background px-0.5 text-xs"
                            value={line.makingMode}
                            onChange={(e) => updateLine(index, { makingMode: e.target.value as MakingMode })}
                          >
                            {MAKING_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                          <Input aria-label={`Row ${index + 1} making charge`} inputMode="decimal" placeholder="0" value={line.makingValue} onChange={(e) => updateLine(index, { makingValue: e.target.value })} className={`${tblInput} w-full min-w-0 text-right`} />
                        </div>
                        {line.makingMode !== "fixed" && computed.makingChargePaise > 0 && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">= {formatPaise(computed.makingChargePaise)}</p>
                        )}
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${index + 1} discount`} placeholder="0 or 5%" value={line.discount} onChange={(e) => updateLine(index, { discount: e.target.value })} className={`${tblInput} w-full min-w-0 text-right`} />
                      </td>
                      {isGst && (
                        <td className={tdCls}>
                          <div className="flex min-w-0 items-center gap-1">
                            <Select
                              value={line.isManualTax ? "manual" : line.taxConfigurationId || defaultTaxId || "none"}
                              onValueChange={(val) => {
                                if (val === "manual") updateLine(index, { isManualTax: true, manualGstPercent: "3.0" });
                                else updateLine(index, { isManualTax: false, taxConfigurationId: val });
                              }}
                            >
                              <SelectTrigger className="h-8 w-full min-w-0 text-xs">
                                <SelectValue placeholder="Tax" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">0% (Nil)</SelectItem>
                                {taxConfigs?.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                                <SelectItem value="manual">Manual GST...</SelectItem>
                              </SelectContent>
                            </Select>
                            {line.isManualTax && (
                              <Input inputMode="decimal" placeholder="3.0" value={line.manualGstPercent || ""} onChange={(e) => updateLine(index, { manualGstPercent: e.target.value })} className="h-8 w-12 shrink-0 px-1 text-right text-xs" title="Custom GST %" />
                            )}
                          </div>
                          {computed.lineTaxPaise > 0 && <p className="mt-0.5 text-[10px] text-muted-foreground">= {formatPaise(computed.lineTaxPaise)}</p>}
                        </td>
                      )}
                      {showCost && (
                        <td className={`${tdCls} pt-1.5 text-right`}>
                          <p className="font-mono text-xs text-muted-foreground">
                            {line.costPaise !== undefined ? formatPaise(line.costPaise * (piecesOf(line) || 1)) : "—"}
                          </p>
                          {line.costPaise !== undefined && (
                            <p className={`font-mono text-[10px] ${computed.taxableValuePaise - line.costPaise * (piecesOf(line) || 1) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                              {formatPaise(computed.taxableValuePaise - line.costPaise * (piecesOf(line) || 1))}
                            </p>
                          )}
                        </td>
                      )}
                      <td className={`${tdCls} pt-2 text-right font-mono font-bold tabular-nums`}>{formatPaise(computed.lineTotalPaise)}</td>
                      <td className={`${tdCls} text-center`}>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" aria-label={`Remove item ${index + 1}`} onClick={() => removeLine(index)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                    {error && (
                      <tr className="bg-destructive/5">
                        <td colSpan={columnCount} className="px-3 py-1 text-xs font-medium text-destructive">Row {index + 1}: {error}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/80 bg-amber-50/60 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 border-amber-300 text-xs" onClick={() => addRow()}>
              <Plus className="h-3.5 w-3.5" /> Add Row
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs font-medium" onClick={() => setShowNotes(!showNotes)}>
              + Add Description
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs font-medium" onClick={() => setShowTerms(!showTerms)}>
              + Add Terms & Conditions
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs font-medium text-amber-600 dark:text-amber-400" onClick={() => setOldGoldEnabled(!oldGoldEnabled)}>
              {oldGoldEnabled ? "✓ Old Gold Added" : "+ Old Gold Exchange"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs font-medium text-amber-600 dark:text-amber-400" onClick={() => setOldItemEnabled(!oldItemEnabled)}>
              {oldItemEnabled ? "✓ Old Item Deduction Added" : "+ Old Item Deduction"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Tip: press Enter in the last row to add a new row. Typing an item name or code fills its purity, price and making charge.</p>
        </div>
      </section>

      {(showNotes || showTerms) && (
        <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-2">
          {showNotes && <Input placeholder="Enter notes / description for invoice..." value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-xs" />}
          {showTerms && <Input placeholder="Terms and conditions..." value={terms} onChange={(e) => setTerms(e.target.value)} className="h-9 text-xs" />}
        </div>
      )}

      {(oldGoldEnabled || oldItemEnabled) && (
        <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Old Gold Exchange */}
          {oldGoldEnabled && (
            <section className={goldPanel}>
              <h2 className={goldHead}>
                <Gem className={goldIcon} /> Old Gold / Silver Exchange
                <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 text-xs text-muted-foreground" onClick={() => setOldGoldEnabled(false)}>
                  ×
                </Button>
              </h2>
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
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
                  <Input inputMode="decimal" placeholder="0.000" value={oldGoldGrossGrams} onChange={(e) => setOldGoldGrossGrams(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Melting %</Label>
                  <Input inputMode="decimal" placeholder="0" value={oldGoldMeltingPercent} onChange={(e) => setOldGoldMeltingPercent(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Rate / g (₹)</Label>
                  <Input inputMode="decimal" placeholder="0.00" value={oldGoldRateRupees} onChange={(e) => setOldGoldRateRupees(e.target.value)} className="h-8 text-xs" />
                </div>
                {oldGoldComputed && (
                  <p className="col-span-2 mt-1 text-[11px] font-medium text-amber-700 sm:col-span-4 dark:text-amber-300">
                    Value: {formatPaise(oldGoldComputed.exchangeValuePaise)} credited against bill
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Old Item Deduction: amount only (no weight/purity/rate), with what it was for. */}
          {oldItemEnabled && (
            <section className={goldPanel}>
              <h2 className={goldHead}>
                <Receipt className={goldIcon} /> Old Item Deduction
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 text-xs text-muted-foreground"
                  aria-label="Remove old item deduction"
                  onClick={() => {
                    setOldItemEnabled(false);
                    setOldItemDeductionRupees("0");
                    setOldItemDeductionNote("");
                  }}
                >
                  ×
                </Button>
              </h2>
              <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_2fr]">
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
                  <Input id="old-item-note" placeholder="e.g. Old ring" maxLength={80} value={oldItemDeductionNote} onChange={(e) => setOldItemDeductionNote(e.target.value)} className="h-8 text-xs" />
                </div>
                {oldItemDeductionError && <p className="text-[11px] font-medium text-destructive sm:col-span-2">{oldItemDeductionError}</p>}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Bottom panels: Bill Summary · Payment Mode · Totals */}
      <div className="grid shrink-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
        <section className={`${goldPanel} flex flex-col`}>
          <h2 className={goldHead}>
            <Calculator className={goldIcon} /> Bill Summary
          </h2>
          <div className="flex-1 space-y-1 p-3 text-sm">
            <SummaryRow label="Total Pieces" value={String(sumPieces)} />
            <SummaryRow label="Total Gross Wt." value={`${mgToGramsDisplay(sumGrossMg)} g`} mono />
            {sumStoneMg > 0 && <SummaryRow label="Total Stone Wt." value={`${mgToGramsDisplay(sumStoneMg)} g`} mono />}
            <SummaryRow label="Total Net Wt." value={`${mgToGramsDisplay(sumNetMg)} g`} mono valueClassName="text-emerald-600" />
            <SummaryRow label="Total Making" value={formatPaise(sumMakingPaise)} mono />
            {sumLineDiscountPaise > 0 && <SummaryRow label="Item Discount" value={`-${formatPaise(sumLineDiscountPaise)}`} mono valueClassName="text-emerald-600" />}
            {totals.oldItemDeductionPaise > 0 && <SummaryRow label="Old Item Deduction" value={`-${formatPaise(totals.oldItemDeductionPaise)}`} mono valueClassName="text-amber-600" />}
            {totals.oldGoldValuePaise > 0 && <SummaryRow label="Old Gold / Silver" value={`-${formatPaise(totals.oldGoldValuePaise)}`} mono valueClassName="text-amber-600" />}
          </div>
          <div className="mx-3 mb-3 flex items-center justify-between rounded-lg bg-gradient-to-r from-amber-300 via-amber-200 to-amber-100 px-3 py-2 text-amber-950 dark:from-amber-700/60 dark:via-amber-800/40 dark:to-amber-900/30 dark:text-amber-50">
            <span className="flex items-center gap-2 font-serif text-lg font-bold"><Gem className="h-4 w-4" /> Grand Total</span>
            <span className="font-mono text-xl font-bold tabular-nums">{formatPaise(totals.totalPaise)}</span>
          </div>
        </section>

        <section className={goldPanel}>
          <h2 className={goldHead}>
            <Wallet className={goldIcon} /> Payment Mode
          </h2>
          <div className="space-y-2 p-3">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={payFull} onChange={(e) => setPayFull(e.target.checked)} />
              Received full amount ({formatPaise(totals.fullFirstPaymentPaise)})
              <span className="font-normal text-muted-foreground">— untick to type the amount</span>
            </label>
            {payments.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={p.mode}
                  onValueChange={(val) => setPayments((prev) => prev.map((pm, i) => (i === idx ? { ...pm, mode: val as PaymentMode } : pm)))}
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
                  onChange={(e) => setPayments((prev) => prev.map((pm, i) => (i === idx ? { ...pm, amountRupees: e.target.value } : pm)))}
                  className="h-8 font-mono text-xs"
                />
                {payments.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setPayments((prev) => prev.filter((_, i) => i !== idx))}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="h-7 border-amber-300 text-xs font-medium" onClick={() => setPayments((prev) => [...prev, { mode: "cash", amountRupees: "" }])}>
              <Plus className="mr-1 h-3 w-3" /> Add Payment Split
            </Button>
          </div>
        </section>

        <section className={goldPanel}>
          <div className="space-y-2 p-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Sub Total (taxable value)</span>
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
                  className="h-8 w-20 text-right font-mono text-xs"
                />
                <span className="w-20 text-right font-mono text-emerald-600">{totals.discountPaise > 0 ? `-${formatPaise(totals.discountPaise)}` : ""}</span>
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

            <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-amber-300 via-amber-200 to-amber-100 px-3 py-2 text-amber-950 dark:from-amber-700/60 dark:via-amber-800/40 dark:to-amber-900/30 dark:text-amber-50">
              <span className="text-base font-bold">Total Amount</span>
              <span className="font-mono text-xl font-bold tabular-nums">{formatPaise(totals.totalPaise)}</span>
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
                <Input id="bill-due-date" type="date" value={dueDate} min={todayDateInput()} onChange={(e) => setDueDate(e.target.value)} className="h-8 w-40 text-xs" />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>

    {/* Pinned bottom bar: the bill total and the save / print / share actions are always on screen. */}
    <div className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-amber-300/80 bg-gradient-to-r from-amber-50 via-card to-amber-50 px-3 py-2.5 shadow-[0_-6px_16px_rgb(120_80_10/8%)] backdrop-blur dark:border-amber-500/30 dark:from-amber-950/40 dark:via-card dark:to-amber-950/40">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="text-muted-foreground">{lines.length} item{lines.length === 1 ? "" : "s"}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono text-lg font-bold tabular-nums text-amber-800 dark:text-amber-300">{formatPaise(totals.totalPaise)}</span>
        </span>
        <span className="text-muted-foreground">Paid <span className="font-mono text-foreground">{formatPaise(totals.amountPaidPaise)}</span></span>
        <span className={totals.balancePaise > 0 ? "font-semibold text-rose-600" : "text-muted-foreground"}>Balance <span className="font-mono">{formatPaise(Math.max(0, totals.balancePaise))}</span></span>
        {serverError && <p className="w-full text-xs font-medium text-destructive">{serverError}</p>}
        {holdNotice && !serverError && <p className="w-full text-xs font-medium text-amber-700">{holdNotice}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className={pillBtn} onClick={() => addRow()}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
        </Button>
        {!editSaleId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={pillBtn}
            disabled={submitting || holding}
            onClick={() => void holdBill()}
            title="Park this bill and start a new one for the next customer"
          >
            <Pause className="mr-1 h-3.5 w-3.5" />
            {holding ? "Holding..." : "Hold"}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className={pillBtn} disabled={submitting} onClick={() => finalizeSale("printShare")}>
          <MessageCircle className="mr-1 h-3.5 w-3.5" />
          Share [F4]
        </Button>
        <Button type="button" variant="outline" size="sm" className={pillBtn} disabled={submitting} onClick={() => finalizeSale("print")}>
          <Printer className="mr-1 h-3.5 w-3.5" />
          Print A5 [F2]
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-9 rounded-full bg-gradient-to-b from-amber-500 to-amber-700 px-5 font-semibold text-white shadow hover:from-amber-600 hover:to-amber-800"
          disabled={submitting}
          onClick={() => finalizeSale("new")}
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {submitting ? "Saving…" : "Save Bill [F3]"}
        </Button>
      </div>
    </div>
    </div>
  );
}

/** One label · value line in the Bill Summary panel. */
function SummaryRow({ label, value, mono, valueClassName }: { label: string; value: string; mono?: boolean; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono" : "font-semibold"} tabular-nums ${valueClassName ?? ""}`}>{value}</span>
    </div>
  );
}
