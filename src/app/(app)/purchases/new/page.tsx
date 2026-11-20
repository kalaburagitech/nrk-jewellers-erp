"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Pause, Plus, Search, Trash2 } from "lucide-react";
import { HeldBillTabs, HeldDeleteConfirm, LineField } from "@/components/held-bills";
import { BarcodeScanInput } from "@/components/barcode-scan-input";
import { BoxPicker } from "@/components/box-picker";
import type { BoxEntryRow } from "@/components/box-items";
import { MetalRateTicker } from "@/components/metal-rate-ticker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  basisPointsOf,
  computePurchaseLine,
  gramsToMg,
  makingChargeFor,
  metalValuePaise,
  mgToGramsDisplay,
  type MakingChargeMode,
} from "@/lib/jewelry-calc";
import { formatPaise, percentToBasisPoints, rupeesToPaise } from "@/lib/money";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { GST_STATES } from "@/lib/gst-state-codes";

type PaymentModeValue = "cash" | "upi" | "card" | "cheque" | "bank_transfer";

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

type Metal = "gold" | "silver";
type MakingMode = MakingChargeMode;
type BoxRow = Doc<"boxes"> & { weightMg: number; pieces: number; entries?: BoxEntryRow[] };

const MAKING_MODES: { value: MakingMode; label: string }[] = [
  { value: "fixed", label: "₹" },
  { value: "per_gram", label: "₹/g" },
  { value: "percent", label: "%" },
];

/** One editable purchase row — same columns as the sales bill. Weights/amounts stay typed text until save. */
type PurchaseLine = {
  key: string;
  /** The box the gross weight and pieces go into (GST company: blank = loose GST item stock). */
  boxId: string;
  metal: Metal | "";
  /** Picked from the Item List; empty = typed description (created in the Item List on save). */
  productId: string;
  label: string;
  metalPurityId: string;
  piecesText: string;
  grossGrams: string;
  netGrams: string;
  ratePerGramRupees: string;
  /** Purchase price per piece (₹). Blank → priced by net weight × rate per gram. */
  unitPriceRupees: string;
  makingMode: MakingMode;
  makingValue: string;
  /** Line discount, "5%" or rupees. */
  discount: string;
  /** Kept from older purchases so an edit doesn't drop it (not on the grid). */
  stoneChargeRupees: string;
};

function blankLine(): PurchaseLine {
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
    unitPriceRupees: "",
    makingMode: "fixed",
    makingValue: "",
    discount: "",
    stoneChargeRupees: "",
  };
}

const cellInput = "h-9 text-sm";

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

function numberFieldError(raw: string, opts?: { max?: number }): string | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a valid number";
  if (n < 0) return "Cannot be negative";
  if (opts?.max !== undefined && n > opts.max) return `Cannot exceed ${opts.max}`;
  return null;
}

/** "5%" → 5% of the line's value; "200" → ₹200. Blank or invalid → no discount. */
function lineDiscountPaise(raw: string, valuePaise: number): number {
  const text = raw.trim();
  if (!text) return 0;
  if (text.endsWith("%")) {
    const bp = percentToBasisPoints(text.slice(0, -1).trim());
    return bp === null ? 0 : Math.round((valuePaise * bp) / 10000);
  }
  return Math.min(rupeesToPaise(text) ?? 0, valuePaise);
}

function makingValueUnits(mode: MakingMode, raw: string): number {
  return mode === "percent" ? percentToBasisPoints(raw || "0") ?? 0 : rupeesToPaise(raw || "0") ?? 0;
}

/** Type-to-search-or-create supplier, like the customer field on the sales bill. */
function SupplierPicker({
  suppliers,
  supplierId,
  nameInput,
  phoneInput,
  allowNew,
  onSelectExisting,
  onNameChange,
  onPhoneChange,
}: {
  suppliers: Doc<"suppliers">[];
  supplierId: string;
  nameInput: string;
  phoneInput: string;
  allowNew: boolean;
  onSelectExisting: (supplier: Doc<"suppliers">) => void;
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
  const matches = (term.length === 0 ? suppliers : suppliers.filter((s) => s.name.toLowerCase().includes(term) || s.phone?.toLowerCase().includes(term))).slice(0, 8);
  const isNew = !supplierId && nameInput.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          aria-label="Supplier name"
          placeholder={allowNew ? "Type a name to search, or add a new supplier" : "Type a name to search suppliers"}
          value={nameInput}
          onChange={(e) => onNameChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
          {matches.map((s) => (
            <button
              type="button"
              key={s._id}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onSelectExisting(s);
                setOpen(false);
              }}
            >
              <span className="flex flex-col">
                <span>{s.name}</span>
                {s.phone && <span className="text-xs text-muted-foreground">{s.phone}</span>}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatPaise(s.currentBalancePaise ?? s.openingBalancePaise ?? 0)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-2">
        <Input placeholder="Phone number" aria-label="Supplier phone" inputMode="tel" value={phoneInput} disabled={!!supplierId} onChange={(e) => onPhoneChange(e.target.value)} />
        {isNew && allowNew && (
          <Badge variant="secondary" className="w-fit font-normal">
            New supplier — saved when you save this purchase
          </Badge>
        )}
      </div>
    </div>
  );
}

/** Everything on the New Purchase form, saved when a purchase is put on hold. */
type HeldPurchaseDraft = {
  supplierId: string;
  supplierNameInput: string;
  supplierPhoneInput: string;
  billDate: string;
  supplierBillNumber: string;
  stateOfSupply: string;
  lines: PurchaseLine[];
  gstPercent: string;
  roundOff: boolean;
  payments: { mode: PaymentModeValue; rupees: string }[];
  payFull: boolean;
  notes: string;
  billImageId?: string;
  billImageName: string;
};

export default function NewPurchasePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editPurchaseId = searchParams.get("edit") as Id<"purchases"> | null;
  const existingPurchase = useQuery(api.purchases.getForEdit, editPurchaseId ? { purchaseId: editPurchaseId } : "skip");

  const suppliers = useQuery(api.suppliers.list);
  const products = useQuery(api.products.list);
  const boxes = useQuery(api.boxes.list);
  const access = useQuery(api.organizations.getMyAccess);
  const gstCompany = access?.organization?.companyType === "gst_gold" || access?.organization?.companyType === "gst_silver";
  const purities = useQuery(api.metalPurities.list);
  const currentRates = useQuery(api.metalRates.getCurrent);
  const taxConfigs = useQuery(api.taxConfigurations.list);
  const prefs = useQuery(api.appPreferences.get);
  const blockNewParties = prefs?.blockNewPartiesFromTxn ?? false;
  const blockNewItems = prefs?.blockNewItemsFromTxn ?? false;
  const createPurchase = useMutation(api.purchases.create);
  const updatePurchase = useMutation(api.purchases.update);
  const createSupplier = useMutation(api.suppliers.create);
  const createProduct = useMutation(api.products.create);
  const uploadBillUrl = useMutation(api.purchases.generateBillImageUploadUrl);
  // Held purchases: parked with "Hold" so another supplier's bill can be entered, then finished later.
  const heldParam = searchParams.get("held") as Id<"heldBills"> | null;
  const heldBillToOpen = useQuery(api.heldBills.get, heldParam && !editPurchaseId ? { heldBillId: heldParam, kind: "purchase" } : "skip");
  const holdBillMutation = useMutation(api.heldBills.hold);
  const removeHeldBill = useMutation(api.heldBills.remove);
  const [heldBillId, setHeldBillId] = useState<Id<"heldBills"> | null>(null);
  const [restoredHeldId, setRestoredHeldId] = useState<string | null>(null);
  const [holdNotice, setHoldNotice] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [confirmDeleteCurrent, setConfirmDeleteCurrent] = useState(false);

  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [supplierNameInput, setSupplierNameInput] = useState("");
  const [supplierPhoneInput, setSupplierPhoneInput] = useState("");
  const [billDate, setBillDate] = useState(() => todayDateInput());
  const [supplierBillNumber, setSupplierBillNumber] = useState("");
  const [stateOfSupply, setStateOfSupply] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>(() => [blankLine()]);
  const [gstPercent, setGstPercent] = useState("");
  const [roundOff, setRoundOff] = useState(true);
  const [payments, setPayments] = useState<{ mode: PaymentModeValue; rupees: string }[]>([{ mode: "cash", rupees: "" }]);
  const [payFull, setPayFull] = useState(false);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [billImageId, setBillImageId] = useState<Id<"_storage"> | undefined>();
  const [billImageName, setBillImageName] = useState("");
  const [uploadingBill, setUploadingBill] = useState(false);

  async function uploadBill(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return setServerError("Upload a photo or PDF of the bill.");
    if (file.size > 10 * 1024 * 1024) return setServerError("Bill file must be 10 MB or smaller.");
    setUploadingBill(true);
    try {
      const url = await uploadBillUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed");
      setBillImageId(((await res.json()) as { storageId: Id<"_storage"> }).storageId);
      setBillImageName(file.name);
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not upload the bill."));
    } finally {
      setUploadingBill(false);
    }
  }

  // One-time prefill in edit mode.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!editPurchaseId || !existingPurchase || !suppliers || prefilled) return;
    const { purchase, items, payments: existingPayments } = existingPurchase;
    const supplier = suppliers.find((s) => s._id === purchase.supplierId);
    setSupplierId(purchase.supplierId);
    setSupplierNameInput(supplier?.name ?? "");
    setSupplierPhoneInput(supplier?.phone ?? "");
    setBillDate(timestampToDateInput(purchase.createdAt));
    setSupplierBillNumber(purchase.supplierBillNumber ?? "");
    setStateOfSupply(purchase.stateOfSupply ?? "");
    setRoundOff((purchase.roundOffPaise ?? 0) !== 0);
    setNotes(purchase.notes ?? "");
    setShowNotes(!!purchase.notes);
    setBillImageId(purchase.billImageStorageId);
    setBillImageName(purchase.billImageStorageId ? "Bill attached" : "");
    setGstPercent(purchase.subtotalPaise > 0 ? String(Math.round((purchase.taxPaise / purchase.subtotalPaise) * 10000) / 100) : "");
    if (existingPayments.length > 0) {
      setPayments(existingPayments.map((p) => ({ mode: p.mode as PaymentModeValue, rupees: (p.amountPaise / 100).toFixed(2) })));
    }
    setLines(
      items.map((item) => ({
        key: item._id,
        boxId: item.boxId ?? "",
        metal: item.metal ?? "",
        productId: item.productId,
        label: item.label,
        metalPurityId: item.metalPurityId ?? "",
        piecesText: String(item.pieces ?? 1),
        grossGrams: (item.grossWeightMg / 1000).toFixed(3),
        netGrams: (item.netWeightMg / 1000).toFixed(3),
        ratePerGramRupees: item.ratePerGramPaise ? (item.ratePerGramPaise / 100).toFixed(2) : "",
        unitPriceRupees: item.unitPricePaise ? (item.unitPricePaise / 100).toFixed(2) : "",
        makingMode: "fixed",
        makingValue: item.makingChargePaise ? (item.makingChargePaise / 100).toFixed(2) : "",
        discount: item.lineDiscountPaise ? (item.lineDiscountPaise / 100).toFixed(2) : "",
        stoneChargeRupees: item.stoneChargePaise ? (item.stoneChargePaise / 100).toFixed(2) : "",
      })),
    );
    setPrefilled(true);
  }, [editPurchaseId, existingPurchase, suppliers, prefilled]);

  // Reopening a held purchase (?held=...) puts its saved form back, once per purchase.
  useEffect(() => {
    if (!heldParam || editPurchaseId || restoredHeldId === heldParam || heldBillToOpen === undefined) return;
    setRestoredHeldId(heldParam);
    if (heldBillToOpen === null) {
      setServerError("That held purchase was already saved or removed.");
      return;
    }
    let draft: Partial<HeldPurchaseDraft>;
    try {
      draft = JSON.parse(heldBillToOpen.draft) as Partial<HeldPurchaseDraft>;
    } catch {
      setServerError("Could not open that held purchase.");
      return;
    }
    setHeldBillId(heldBillToOpen._id);
    setIdempotencyKey(crypto.randomUUID());
    setSupplierId(draft.supplierId ?? "");
    setSupplierNameInput(draft.supplierNameInput ?? "");
    setSupplierPhoneInput(draft.supplierPhoneInput ?? "");
    setBillDate(draft.billDate || todayDateInput());
    setSupplierBillNumber(draft.supplierBillNumber ?? "");
    setStateOfSupply(draft.stateOfSupply ?? "");
    setLines(draft.lines?.length ? draft.lines : [blankLine()]);
    setGstPercent(draft.gstPercent ?? "");
    setRoundOff(draft.roundOff ?? true);
    setPayments(draft.payments?.length ? draft.payments : [{ mode: "cash", rupees: "" }]);
    setPayFull(Boolean(draft.payFull));
    setNotes(draft.notes ?? "");
    setShowNotes(Boolean(draft.notes));
    setBillImageId(draft.billImageId ? (draft.billImageId as Id<"_storage">) : undefined);
    setBillImageName(draft.billImageName ?? "");
    setServerError(null);
    setHoldNotice(null);
  }, [heldParam, editPurchaseId, restoredHeldId, heldBillToOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedSupplier = suppliers?.find((s) => s._id === supplierId);
  // State of supply defaults to the supplier's state.
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { if (selectedSupplier?.state && !stateOfSupply) setStateOfSupply(selectedSupplier.state); }, [selectedSupplier, stateOfSupply]);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p._id as string, p])), [products]);
  const productByName = useMemo(() => new Map((products ?? []).filter((p) => p.isActive).map((p) => [p.name.trim().toLowerCase(), p])), [products]);
  const productBySku = useMemo(() => new Map((products ?? []).filter((p) => p.isActive && p.sku).map((p) => [p.sku!.trim().toLowerCase(), p])), [products]);
  const boxById = useMemo(() => new Map((boxes ?? []).map((b) => [b._id as string, b as BoxRow])), [boxes]);
  const activePurities = useMemo(() => (purities ?? []).filter((p) => p.isActive), [purities]);
  const rateByPurity = useMemo(() => {
    const map = new Map<string, number>();
    currentRates?.forEach(({ purity, latest }) => { if (latest) map.set(purity._id, latest.ratePerGramPaise); });
    return map;
  }, [currentRates]);

  const isLoose = useCallback((line: PurchaseLine) => gstCompany && !line.boxId, [gstCompany]);
  /** Pcs left blank: 1 for loose GST stock, else 0 (weight-only box receipt). */
  const piecesOf = useCallback((line: PurchaseLine) => (line.piecesText.trim() === "" ? (isLoose(line) ? 1 : 0) : Number(line.piecesText)), [isLoose]);

  function defaultPurityFor(metal: Metal | "") {
    if (!metal) return "";
    const ofMetal = activePurities.filter((p) => p.metal === metal);
    return (ofMetal.find((p) => metal === "gold" && p.label.includes("22")) ?? ofMetal[0])?._id ?? "";
  }
  function autoRate(purityId: string) {
    const ratePaise = purityId ? rateByPurity.get(purityId) : undefined;
    return ratePaise ? (ratePaise / 100).toFixed(2) : "";
  }

  function updateLine(index: number, patch: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /** Box picked: category follows the box's metal; purity and rate default from it. */
  function withBox(line: PurchaseLine, boxId: string): Partial<PurchaseLine> {
    const box = boxById.get(boxId);
    const metal = box?.metal ?? line.metal;
    const purityOk = activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal;
    const metalPurityId = purityOk ? line.metalPurityId : defaultPurityFor(metal) || line.metalPurityId;
    return {
      boxId,
      metal,
      metalPurityId,
      piecesText: line.piecesText || (box && box.pieces > 0 ? "1" : ""),
      ratePerGramRupees: line.ratePerGramRupees || autoRate(metalPurityId),
    };
  }
  /** Box picked from the dropdown: the box, and the item when the row was one of its items. */
  function pickBoxItem(index: number, boxId: string, entry?: BoxEntryRow) {
    let next: PurchaseLine = { ...lines[index], ...withBox(lines[index], boxId) };
    if (entry) next = { ...next, ...entryPatch(next, entry) };
    updateLine(index, next);
  }

  /** The item as kept in its box: purity, purchase price and making come from the box. */
  function entryPatch(line: PurchaseLine, entry: BoxEntryRow): Partial<PurchaseLine> {
    const purity = activePurities.find((p) => p._id === entry.metalPurityId);
    const box = boxById.get(line.boxId);
    const metal = purity?.metal ?? box?.metal ?? line.metal;
    const metalPurityId = purity?._id ?? (activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal ? line.metalPurityId : defaultPurityFor(metal));
    return {
      label: entry.productName,
      productId: entry.productId,
      metal,
      metalPurityId,
      ratePerGramRupees: autoRate(metalPurityId) || line.ratePerGramRupees,
      makingMode: entry.makingChargeMode ?? "fixed",
      makingValue: entry.makingChargeValue ? (entry.makingChargeValue / 100).toFixed(2) : "",
      unitPriceRupees: entry.purchasePricePaise ? (entry.purchasePricePaise / 100).toFixed(2) : line.unitPriceRupees,
    };
  }
  function pickMetal(index: number, metal: Metal | "") {
    const line = lines[index];
    if (activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal) return updateLine(index, { metal });
    const metalPurityId = defaultPurityFor(metal);
    updateLine(index, { metal, metalPurityId, ratePerGramRupees: autoRate(metalPurityId) || line.ratePerGramRupees });
  }
  function pickPurity(index: number, metalPurityId: string) {
    const line = lines[index];
    const purity = activePurities.find((p) => p._id === metalPurityId);
    updateLine(index, { metalPurityId, metal: purity?.metal ?? line.metal, ratePerGramRupees: autoRate(metalPurityId) || line.ratePerGramRupees });
  }

  /** Description typed: an Item List name or code fills purity, box, weights, purchase price and making charge. */
  function typeDescription(index: number, label: string) {
    updateLine(index, descriptionPatch(lines[index], label));
  }

  function descriptionPatch(line: PurchaseLine, label: string): Partial<PurchaseLine> {
    const product = productByName.get(label.trim().toLowerCase()) ?? productBySku.get(label.trim().toLowerCase());
    if (!product) return { label, productId: "" };
    if (product._id === line.productId) return { label };
    // The box already holds this item: its details come from the box.
    const entry = boxById.get(line.boxId)?.entries?.find((e) => e.productId === product._id);
    if (entry) return entryPatch(line, entry);
    const purity = activePurities.find((p) => p._id === product.metalPurityId);
    const boxId = line.boxId || product.defaultBoxId || "";
    const box = boxById.get(boxId);
    const metal = purity?.metal ?? box?.metal ?? line.metal;
    const metalPurityId = purity?._id ?? (activePurities.find((p) => p._id === line.metalPurityId)?.metal === metal ? line.metalPurityId : defaultPurityFor(metal));
    const gross = product.grossWeightMg ? (product.grossWeightMg / 1000).toFixed(3) : "";
    const net = product.grossWeightMg ? ((product.grossWeightMg - (product.stoneWeightMg ?? 0)) / 1000).toFixed(3) : "";
    // GST % from the item's tax rate, when the bill has none yet.
    const tax = product.taxConfigurationId ? taxConfigs?.find((t) => t._id === product.taxConfigurationId) : undefined;
    if (gstCompany && tax && !gstPercent) setGstPercent(String((tax.cgstBasisPoints + tax.sgstBasisPoints || tax.igstBasisPoints) / 100));
    return {
      label: product.name,
      productId: product._id,
      boxId,
      metal,
      metalPurityId,
      ratePerGramRupees: autoRate(metalPurityId) || line.ratePerGramRupees,
      ...(line.grossGrams === "" && gross ? { grossGrams: gross, netGrams: net } : {}),
      ...(product.makingChargePaise ? { makingMode: "fixed" as const, makingValue: (product.makingChargePaise / 100).toFixed(2) } : {}),
      unitPriceRupees: product.purchasePricePaise ? (product.purchasePricePaise / 100).toFixed(2) : line.unitPriceRupees,
    };
  }

  /** Gross typed: net follows it until the operator types a different net weight. */
  function typeGross(index: number, grossGrams: string) {
    const line = lines[index];
    updateLine(index, { grossGrams, ...(line.netGrams === "" || line.netGrams === line.grossGrams ? { netGrams: grossGrams } : {}) });
  }

  function addRow(boxId?: string) {
    const blank = blankLine();
    const line = boxId ? { ...blank, ...withBox(blank, boxId) } : blank;
    setLines((prev) => [...prev, line]);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-line="${line.key}"] ${boxId ? "input" : "select"}`)?.focus());
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const computedLines = useMemo(
    () =>
      lines.map((line) => {
        const grossWeightMg = gramsToMg(line.grossGrams || "0");
        const netWeightMg = gramsToMg(line.netGrams || "0");
        const ratePerGramPaise = rupeesToPaise(line.ratePerGramRupees || "0") ?? 0;
        const unitPricePaise = rupeesToPaise(line.unitPriceRupees || "0") ?? 0;
        const pieces = piecesOf(line) || 0;
        const metalValue = unitPricePaise > 0 ? unitPricePaise * pieces : metalValuePaise(netWeightMg, ratePerGramPaise);
        const input = {
          grossWeightMg,
          stoneWeightMg: Math.max(0, grossWeightMg - netWeightMg),
          ratePerGramPaise,
          unitPricePaise,
          pieces,
          makingChargePaise: makingChargeFor(line.makingMode, makingValueUnits(line.makingMode, line.makingValue), netWeightMg, metalValue),
          stoneChargePaise: rupeesToPaise(line.stoneChargeRupees || "0") ?? 0,
        };
        const discount = lineDiscountPaise(line.discount, computePurchaseLine(input).lineTotalPaise);
        return { ...computePurchaseLine({ ...input, lineDiscountPaise: discount }), lineDiscountPaise: discount };
      }),
    [lines, piecesOf],
  );

  /** Weight and pieces this purchase puts into each box. */
  const addedByBox = useMemo(() => {
    const added = new Map<string, { weightMg: number; pieces: number }>();
    lines.forEach((line) => {
      if (!line.boxId) return;
      const row = added.get(line.boxId) ?? { weightMg: 0, pieces: 0 };
      row.weightMg += gramsToMg(line.grossGrams || "0");
      row.pieces += piecesOf(line) || 0;
      added.set(line.boxId, row);
    });
    return added;
  }, [lines, piecesOf]);

  /** On an edited purchase, its original lines are already in the boxes — take them out to show the true "before". */
  const ownByBox = useMemo(() => {
    const own = new Map<string, { weightMg: number; pieces: number }>();
    for (const item of existingPurchase?.items ?? []) {
      if (!item.boxId) continue;
      const row = own.get(item.boxId) ?? { weightMg: 0, pieces: 0 };
      row.weightMg += item.stockWeightMg ?? item.grossWeightMg;
      row.pieces += item.pieces ?? 1;
      own.set(item.boxId, row);
    }
    return own;
  }, [existingPurchase]);

  function boxBefore(boxId: string) {
    const box = boxById.get(boxId);
    if (!box) return null;
    const own = ownByBox.get(boxId) ?? { weightMg: 0, pieces: 0 };
    return { weightMg: box.weightMg - own.weightMg, pieces: box.pieces - own.pieces };
  }

  const lineErrors = useMemo(
    () =>
      lines.map((line, index) => {
        const box = boxById.get(line.boxId);
        if (!gstCompany && !line.boxId) return "Choose the box.";
        if (!line.label.trim()) return "Enter the description.";
        if (!line.productId && blockNewItems) return "Pick an item from the Item List (adding new items from a bill is turned off).";
        if (box?.metal && line.metal && box.metal !== line.metal) return `Box ${box.boxNumber} holds ${box.metal === "gold" ? "Gold" : "Silver"}.`;
        const pieces = piecesOf(line);
        if (!Number.isInteger(pieces) || pieces < 0) return "Pcs must be a whole number.";
        if (isLoose(line) && pieces < 1) return "Pcs must be 1 or more.";
        const checks: [string, string | null][] = [
          ["Gross wt", numberFieldError(line.grossGrams)],
          ["Net wt", numberFieldError(line.netGrams)],
          ["Rate/g", numberFieldError(line.ratePerGramRupees)],
          ["Price / pc", numberFieldError(line.unitPriceRupees)],
          ["Making", numberFieldError(line.makingValue, line.makingMode === "percent" ? { max: 100 } : undefined)],
        ];
        const failed = checks.find(([, error]) => error);
        if (failed) return `${failed[0]}: ${failed[1]}`;
        const computed = computedLines[index];
        if (!(computed.grossWeightMg > 0)) return "Enter the gross weight.";
        if (!(computed.netWeightMg > 0)) return "Enter the net weight.";
        if (computed.netWeightMg > computed.grossWeightMg) return "Net weight cannot be more than gross weight.";
        if (!(computed.ratePerGramPaise > 0) && !((computed.unitPricePaise ?? 0) > 0)) return "Enter the rate per gram (or a price per piece).";
        return null;
      }),
    [lines, computedLines, boxById, gstCompany, blockNewItems, isLoose, piecesOf],
  );

  const metalTotals = useMemo(() => {
    const totals = { gold: { grossMg: 0, paise: 0 }, silver: { grossMg: 0, paise: 0 } };
    lines.forEach((line, index) => {
      const metal = line.metal || activePurities.find((p) => p._id === line.metalPurityId)?.metal;
      if (!metal) return;
      totals[metal].grossMg += computedLines[index].grossWeightMg;
      totals[metal].paise += computedLines[index].lineTotalPaise;
    });
    return totals;
  }, [lines, computedLines, activePurities]);

  const gstError = numberFieldError(gstPercent, { max: 100 });
  const paymentErrors = payments.map((p) => numberFieldError(p.rupees));

  const totals = useMemo(() => {
    const subtotalPaise = computedLines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    const taxPaise = basisPointsOf(subtotalPaise, percentToBasisPoints(gstPercent || "0") ?? 0);
    const unrounded = subtotalPaise + taxPaise;
    const roundOffPaise = roundOff ? Math.round(unrounded / 100) * 100 - unrounded : 0;
    const totalPaise = unrounded + roundOffPaise;
    const otherPaid = payments.slice(payFull ? 1 : 0).reduce((a, p) => a + (rupeesToPaise(p.rupees || "0") ?? 0), 0);
    const fullFirstPaymentPaise = Math.max(0, totalPaise - otherPaid);
    const amountPaidPaise = otherPaid + (payFull ? fullFirstPaymentPaise : 0);
    return { subtotalPaise, taxPaise, roundOffPaise, totalPaise, amountPaidPaise, fullFirstPaymentPaise, balancePaise: totalPaise - amountPaidPaise };
  }, [computedLines, gstPercent, roundOff, payments, payFull]);

  function resetForm() {
    setIdempotencyKey(crypto.randomUUID());
    setSupplierId("");
    setSupplierNameInput("");
    setSupplierPhoneInput("");
    setBillDate(todayDateInput());
    setSupplierBillNumber("");
    setStateOfSupply("");
    setLines([blankLine()]);
    setGstPercent("");
    setRoundOff(true);
    setPayments([{ mode: "cash", rupees: "" }]);
    setPayFull(false);
    setNotes("");
    setShowNotes(false);
    setBillImageId(undefined);
    setBillImageName("");
    setServerError(null);
    setHeldBillId(null);
    setConfirmDeleteCurrent(false);
  }

  const partyName = supplierNameInput.trim() || suppliers?.find((s) => s._id === supplierId)?.name || "Supplier";

  /** True once anything has been entered, so switching purchases never silently drops work. */
  function billHasContent() {
    return Boolean(
      supplierId ||
        supplierNameInput.trim() ||
        supplierBillNumber.trim() ||
        lines.some((l) => l.boxId || l.label.trim() || l.grossGrams || l.netGrams || l.unitPriceRupees),
    );
  }

  /** Parks the purchase on screen as a held purchase. Returns false (with a message) if it could not. */
  async function holdCurrentBill(): Promise<boolean> {
    if (!billHasContent()) {
      setServerError("Nothing to hold yet - add a supplier or an item first.");
      return false;
    }
    const draft: HeldPurchaseDraft = {
      supplierId, supplierNameInput, supplierPhoneInput, billDate, supplierBillNumber, stateOfSupply, lines,
      gstPercent, roundOff, payments, payFull, notes, billImageId, billImageName,
    };
    const name = partyName;
    setHolding(true);
    try {
      await holdBillMutation({
        heldBillId: heldBillId ?? undefined,
        kind: "purchase",
        customerName: name,
        itemCount: lines.filter((l) => l.boxId || l.label.trim()).length,
        totalPaise: totals.totalPaise,
        draft: JSON.stringify(draft),
      });
      resetForm();
      setHoldNotice(`Purchase from ${name} is on hold. Click its yellow tab above to finish it.`);
      return true;
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not hold the purchase."));
      return false;
    } finally {
      setHolding(false);
    }
  }

  async function holdBill() {
    if ((await holdCurrentBill()) && heldParam) router.replace("/purchases/new");
  }

  /** "+": start a blank purchase; the one on screen (if any) is put on hold first. */
  async function startNewBill() {
    if (billHasContent()) {
      await holdBill();
      return;
    }
    resetForm();
    if (heldParam) router.replace("/purchases/new");
  }

  /** Opens a held purchase; the one on screen (if any) is put on hold first so nothing is lost. */
  async function openHeldBill(id: Id<"heldBills">) {
    if (id === heldBillId) return;
    if (billHasContent() && !(await holdCurrentBill())) return;
    setRestoredHeldId(null);
    router.push(`/purchases/new?held=${id}`);
  }

  /** Deletes the held purchase on screen (the supplier left) and clears the screen. */
  async function deleteCurrentHeld() {
    if (!heldBillId) return;
    setConfirmDeleteCurrent(false);
    try {
      await removeHeldBill({ heldBillId });
      resetForm();
      setHoldNotice(`Held purchase from ${partyName} deleted.`);
      if (heldParam) router.replace("/purchases/new");
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not delete the held purchase."));
    }
  }

  async function savePurchase(after: "list" | "new") {
    setServerError(null);
    if (!supplierId && !supplierNameInput.trim()) return setServerError("Select or enter a supplier.");
    if (!supplierId && blockNewParties) return setServerError("Select an existing supplier. Adding new parties from the bill is turned off in Settings → General.");
    if (lines.length === 0) return setServerError("Add at least one item.");
    const firstLineError = lineErrors.findIndex(Boolean);
    if (firstLineError >= 0) return setServerError(`Row ${firstLineError + 1}: ${lineErrors[firstLineError]}`);
    if (gstError) return setServerError(`GST %: ${gstError}`);
    const firstPaymentError = paymentErrors.find(Boolean);
    if (firstPaymentError) return setServerError(`Payment amount: ${firstPaymentError}`);
    if (totals.amountPaidPaise > totals.totalPaise) return setServerError("Amount paid cannot be more than the bill total.");

    setSubmitting(true);
    try {
      let resolvedSupplierId: Id<"suppliers">;
      if (supplierId) {
        resolvedSupplierId = supplierId as Id<"suppliers">;
      } else {
        const name = supplierNameInput.trim();
        const existing = suppliers?.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
        resolvedSupplierId = existing ? existing._id : await createSupplier({ name, phone: supplierPhoneInput.trim() || undefined });
      }

      // Typed descriptions become Item List entries (one per distinct name).
      const createdProducts = new Map<string, Id<"products">>();
      const items = [];
      for (const [index, line] of lines.entries()) {
        let productId = line.productId as Id<"products"> | "";
        if (!productId) {
          const key = line.label.trim().toLowerCase();
          productId = productByName.get(key)?._id ?? createdProducts.get(key) ?? "";
          if (!productId) {
            productId = await createProduct({
              name: line.label.trim(),
              unit: "piece",
              itemType: "product",
              metalPurityId: line.metalPurityId ? (line.metalPurityId as Id<"metalPurities">) : undefined,
              defaultBoxId: line.boxId ? (line.boxId as Id<"boxes">) : undefined,
            });
            createdProducts.set(key, productId);
          }
        }
        const computed = computedLines[index];
        items.push({
          productId,
          boxId: line.boxId ? (line.boxId as Id<"boxes">) : undefined,
          pieces: piecesOf(line),
          metal: line.metal || undefined,
          label: line.label.trim(),
          metalPurityId: line.metalPurityId ? (line.metalPurityId as Id<"metalPurities">) : undefined,
          grossWeightMg: computed.grossWeightMg,
          stoneWeightMg: computed.stoneWeightMg,
          ratePerGramPaise: computed.ratePerGramPaise,
          unitPricePaise: computed.unitPricePaise || undefined,
          makingChargePaise: computed.makingChargePaise,
          stoneChargePaise: computed.stoneChargePaise,
          lineDiscountPaise: computed.lineDiscountPaise || undefined,
        });
      }

      const paymentSplits = payments
        .map((p, index) => ({ mode: p.mode, amountPaise: payFull && index === 0 ? totals.fullFirstPaymentPaise : rupeesToPaise(p.rupees || "0") ?? 0 }))
        .filter((p) => p.amountPaise > 0);
      const common = {
        supplierId: resolvedSupplierId,
        items,
        gstBasisPoints: percentToBasisPoints(gstPercent || "0") ?? 0,
        amountPaidPaise: totals.amountPaidPaise,
        payments: paymentSplits,
        roundOff,
        supplierBillNumber: supplierBillNumber.trim() || undefined,
        stateOfSupply: stateOfSupply || undefined,
        notes: notes.trim() || undefined,
        billImageStorageId: billImageId,
        billDate: dateInputToTimestamp(billDate),
      };

      if (editPurchaseId) {
        await updatePurchase({ purchaseId: editPurchaseId, ...common });
        router.push(`/purchases/invoices?updated=${editPurchaseId}`);
        return;
      }
      const result = await createPurchase({ ...common, idempotencyKey, heldBillId: heldBillId ?? undefined });
      if (after === "new") {
        resetForm();
        setHoldNotice(null);
        if (heldParam) router.replace("/purchases/new");
      } else router.push(`/purchases/invoices?created=${result.purchaseId}`);
    } catch (e) {
      setServerError(getUserErrorMessage(e, "Could not save the purchase. You may need Purchase Manager access, or check the item details."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!suppliers || !products || !boxes || !purities || (editPurchaseId && !prefilled)) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{editPurchaseId ? "Edit Purchase" : "New Purchase"}</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="erp-fill flex w-full flex-col">
    <div className="erp-scroll flex min-h-0 flex-1 flex-col gap-3 pb-3 lg:overflow-y-auto lg:pr-1">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{editPurchaseId ? "Edit Purchase" : "New Purchase"}</h1>
          <p className="text-xs text-muted-foreground">
            {editPurchaseId
              ? "Editing reverses the original stock and ledger effects, then reapplies the corrected ones."
              : "Choose the box, enter gross and net weight — the gross weight and pieces are added to the box."}
          </p>
        </div>
      </div>

      <MetalRateTicker currentRates={currentRates} />

      {/* Purchase tabs: the purchase on screen, then held purchases (yellow). */}
      {!editPurchaseId && (
        <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
          <div className="flex items-center gap-2 rounded-t-lg border-t border-l border-r bg-card px-3 py-1.5 text-xs font-semibold shadow-xs">
            <span>{heldBillId ? `Held · ${partyName}` : "Purchase #1"}</span>
            {heldBillId && confirmDeleteCurrent ? (
              <HeldDeleteConfirm onYes={() => void deleteCurrentHeld()} onNo={() => setConfirmDeleteCurrent(false)} />
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => (heldBillId ? setConfirmDeleteCurrent(true) : resetForm())}
                title={heldBillId ? "Delete this held purchase" : "Reset purchase"}
                aria-label={heldBillId ? "Delete this held purchase" : "Reset purchase"}
              >
                ×
              </button>
            )}
          </div>
          <HeldBillTabs
            kind="purchase"
            currentId={heldBillId}
            disabled={holding}
            onOpen={(id) => void openHeldBill(id)}
            onDeleted={(name) => setHoldNotice(`Held purchase from ${name} deleted.`)}
            onError={setServerError}
          />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded border border-dashed text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void startNewBill()}
            title="New purchase (the one on screen is put on hold)"
            aria-label="New purchase"
          >
            +
          </button>
        </div>
      )}

      <Card className="shrink-0 border-border/80 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">Supplier</Label>
              <SupplierPicker
                suppliers={suppliers}
                supplierId={supplierId}
                nameInput={supplierNameInput}
                phoneInput={supplierPhoneInput}
                allowNew={!blockNewParties}
                onSelectExisting={(s) => {
                  setSupplierId(s._id);
                  setSupplierNameInput(s.name);
                  setSupplierPhoneInput(s.phone ?? "");
                }}
                onNameChange={(value) => {
                  setSupplierNameInput(value);
                  setSupplierId("");
                }}
                onPhoneChange={(value) => {
                  setSupplierPhoneInput(value);
                  const match = suppliers.find((s) => s.phone && s.phone === value.trim());
                  if (match) {
                    setSupplierId(match._id);
                    setSupplierNameInput(match.name);
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Supplier Bill No.</Label>
                <Input value={supplierBillNumber} onChange={(e) => setSupplierBillNumber(e.target.value)} placeholder="No. on their bill" aria-label="Supplier bill number" className="h-9 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Bill Date</Label>
                <Input type="date" aria-label="Bill date" className="h-9 text-xs" value={billDate} max={todayDateInput()} onChange={(e) => setBillDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">State of Supply</Label>
                <Select value={stateOfSupply} onValueChange={setStateOfSupply}>
                  <SelectTrigger className="h-9 text-xs" aria-label="State of supply"><SelectValue placeholder={access?.organization?.state ?? "Select state"} /></SelectTrigger>
                  <SelectContent>{GST_STATES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {prefs?.items.barcodeScan !== false && <BarcodeScanInput onBox={(box) => addRow(box._id)} />}

      {/* Items: one card per item, same as the sales bill. Each item's gross weight and pieces go into its box. */}
      <Card className="shrink-0 gap-0 overflow-hidden border-border/80 py-0 shadow-xs">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2.5">
          <CardTitle className="text-sm font-bold uppercase tracking-wide">Items in this purchase ({lines.length})</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            {gstCompany
              ? "Priced on net weight (or price per piece); the gross weight and pieces go into the selected box — or loose GST item stock when no box is chosen."
              : "Priced on net weight (or price per piece); the gross weight and pieces are added to the selected box."}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <datalist id="purchase-items">
            {products.filter((p) => p.isActive && p.itemType !== "service").map((p) => <option key={p._id} value={p.name} />)}
          </datalist>
          <div className="erp-scroll divide-y divide-border/60 overflow-auto lg:max-h-[62svh]">
            {lines.map((line, index) => {
              const computed = computedLines[index];
              const error = lineErrors[index];
              const box = boxById.get(line.boxId);
              const before = line.boxId ? boxBefore(line.boxId) : null;
              const added = addedByBox.get(line.boxId);
              return (
                <div
                  key={line.key}
                  data-line={line.key}
                  className="space-y-3 px-3 py-3 hover:bg-muted/10"
                  onKeyDown={(e) => {
                    // Enter on the last item adds the next one.
                    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && index === lines.length - 1) {
                      e.preventDefault();
                      addRow();
                    }
                  }}
                >
                  {/* Item heading: number, line amount, remove */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-muted-foreground">
                      Item {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Amount</span>
                      <span className="text-base font-bold tabular-nums text-foreground">{formatPaise(computed.lineTotalPaise)}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" aria-label={`Remove item ${index + 1}`} onClick={() => removeLine(index)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Row 1: what the item is */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                    <LineField label="Box No">
                      <BoxPicker
                        ariaLabel={`Row ${index + 1} box`}
                        boxes={boxes as BoxRow[]}
                        purities={activePurities}
                        rateByPurity={rateByPurity}
                        value={line.boxId}
                        metal={line.metal}
                        priceKind="purchase"
                        emptyLabel={gstCompany ? "Loose GST stock" : undefined}
                        onPick={(boxId, entry) => pickBoxItem(index, boxId, entry)}
                        triggerClassName="w-full min-w-0"
                      />
                      {box && before && (
                        <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                          Has {mgToGramsDisplay(before.weightMg)} g · {before.pieces} pcs
                          {added ? ` → ${mgToGramsDisplay(before.weightMg + added.weightMg)} g · ${before.pieces + added.pieces} pcs` : ""}
                        </p>
                      )}
                    </LineField>
                    <LineField label="Category">
                      <select aria-label={`Row ${index + 1} category`} className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={line.metal} onChange={(e) => pickMetal(index, e.target.value as Metal | "")}>
                        <option value="">—</option>
                        <option value="gold">Gold</option>
                        <option value="silver">Silver</option>
                      </select>
                    </LineField>
                    <LineField label="Description">
                      <Input aria-label={`Row ${index + 1} description`} list="purchase-items" placeholder="Item name or code" value={line.label} maxLength={80} onChange={(e) => typeDescription(index, e.target.value)} className={`${cellInput} w-full min-w-0`} />
                      {line.label.trim() && !line.productId && !blockNewItems && <p className="mt-1 text-[10px] text-muted-foreground">New item — added to Item List on save</p>}
                      {line.productId && productById.get(line.productId)?.sku && <p className="mt-1 text-[10px] text-muted-foreground">Code {productById.get(line.productId)?.sku}</p>}
                    </LineField>
                    <LineField label="Purity">
                      <select aria-label={`Row ${index + 1} purity`} className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={line.metalPurityId} onChange={(e) => pickPurity(index, e.target.value)}>
                        <option value="">—</option>
                        {activePurities.filter((p) => !line.metal || p.metal === line.metal).map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
                      </select>
                    </LineField>
                  </div>

                  {/* Row 2: quantity, weight and price */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 md:grid-cols-5">
                    <LineField label="Pcs">
                      <Input aria-label={`Row ${index + 1} pieces`} inputMode="numeric" placeholder={isLoose(line) ? "1" : "0"} value={line.piecesText} onChange={(e) => updateLine(index, { piecesText: e.target.value })} className={`${cellInput} w-full min-w-0 text-right`} />
                    </LineField>
                    <LineField label="Gross Wt (g)">
                      <Input aria-label={`Row ${index + 1} gross weight`} inputMode="decimal" placeholder="0.000" value={line.grossGrams} onChange={(e) => typeGross(index, e.target.value)} className={`${cellInput} w-full min-w-0 text-right font-mono`} />
                    </LineField>
                    <LineField label="Net Wt (g)">
                      <Input aria-label={`Row ${index + 1} net weight`} inputMode="decimal" placeholder="0.000" value={line.netGrams} onChange={(e) => updateLine(index, { netGrams: e.target.value })} className={`${cellInput} w-full min-w-0 text-right font-mono text-emerald-600`} />
                    </LineField>
                    <LineField label="Rate / g (₹)">
                      <Input aria-label={`Row ${index + 1} rate per gram`} inputMode="decimal" placeholder="0.00" value={line.ratePerGramRupees} onChange={(e) => updateLine(index, { ratePerGramRupees: e.target.value })} className={`${cellInput} w-full min-w-0 text-right font-mono`} />
                    </LineField>
                    <LineField label="Price / pc (₹)">
                      <Input aria-label={`Row ${index + 1} price per piece`} inputMode="decimal" placeholder="by rate/g" title="Purchase price per piece — leave blank to price by net weight × rate per gram" value={line.unitPriceRupees} onChange={(e) => updateLine(index, { unitPriceRupees: e.target.value })} className={`${cellInput} w-full min-w-0 text-right font-mono`} />
                    </LineField>
                  </div>

                  {/* Row 3: charges and discount */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                    <LineField label="Making">
                      <div className="flex min-w-0 items-center gap-1">
                        <select aria-label={`Row ${index + 1} making charge type`} className="h-9 shrink-0 rounded-md border bg-background px-1 text-sm" value={line.makingMode} onChange={(e) => updateLine(index, { makingMode: e.target.value as MakingMode })}>
                          {MAKING_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <Input aria-label={`Row ${index + 1} making charge`} inputMode="decimal" placeholder="0" value={line.makingValue} onChange={(e) => updateLine(index, { makingValue: e.target.value })} className={`${cellInput} w-full min-w-0 text-right`} />
                      </div>
                      {line.makingMode !== "fixed" && computed.makingChargePaise > 0 && <p className="mt-1 text-[10px] text-muted-foreground">= {formatPaise(computed.makingChargePaise)}</p>}
                    </LineField>
                    <LineField label="Discount (₹ / %)">
                      <Input aria-label={`Row ${index + 1} discount`} placeholder="0 or 5%" value={line.discount} onChange={(e) => updateLine(index, { discount: e.target.value })} className={`${cellInput} w-full min-w-0 text-right`} />
                    </LineField>
                  </div>

                  {error && <p className="text-xs font-medium text-destructive">{error}</p>}
                </div>
              );
            })}
          </div>
          {lines.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t bg-muted/20 px-3 py-2 text-sm font-semibold">
              <span className="text-muted-foreground">Total</span>
              <span className="tabular-nums">{lines.reduce((sum, l) => sum + (piecesOf(l) || 0), 0)} pcs</span>
              <span className="font-mono tabular-nums">Gross {mgToGramsDisplay(computedLines.reduce((sum, l) => sum + l.grossWeightMg, 0))} g</span>
              <span className="font-mono tabular-nums text-emerald-600">Net {mgToGramsDisplay(computedLines.reduce((sum, l) => sum + l.netWeightMg, 0))} g</span>
              <span className="text-base tabular-nums">{formatPaise(totals.subtotalPaise)}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <Button type="button" variant="outline" size="sm" onClick={() => addRow()}>
              <Plus className="h-3.5 w-3.5" /> Add Row
            </Button>
            <p className="text-[11px] text-muted-foreground">Tip: press Enter in the last item to add a new one. Typing an item name or code fills its purity, weights, purchase price and making charge.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid shrink-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowNotes((v) => !v)}>
              {showNotes ? "Hide Description" : "+ Add Description / Terms"}
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">
              {uploadingBill ? "Uploading…" : billImageName ? `Bill: ${billImageName} (change)` : "+ Upload Bill (photo / PDF)"}
              <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={uploadingBill} onChange={(e) => uploadBill(e.target.files?.[0])} />
            </label>
            {billImageId && (
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => { setBillImageId(undefined); setBillImageName(""); }}>
                Remove bill
              </Button>
            )}
          </div>
          {showNotes && <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Description, terms & conditions, remarks…" aria-label="Description and terms" />}

          {(metalTotals.gold.grossMg > 0 || metalTotals.silver.grossMg > 0) && (
            <Card>
              <CardContent className="grid grid-cols-2 gap-3 p-3 text-xs">
                {(["gold", "silver"] as const).filter((m) => metalTotals[m].grossMg > 0).map((m) => (
                  <div key={m}>
                    <p className="font-semibold">{m === "gold" ? "Gold" : "Silver"} received</p>
                    <p className="tabular-nums text-muted-foreground">{mgToGramsDisplay(metalTotals[m].grossMg)} g · {formatPaise(metalTotals[m].paise)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">GST (%)</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <Input aria-label="GST percent" inputMode="decimal" placeholder="0" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} className="h-8 w-20 text-right text-xs" />
                {[
                  { label: "0% Non-GST", val: "0" },
                  { label: "3% Jewellery", val: "3" },
                  { label: "5%", val: "5" },
                  { label: "18%", val: "18" },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    onClick={() => setGstPercent(item.val)}
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${gstPercent === item.val ? "border-amber-600 bg-amber-500 text-white shadow-sm" : "border-border bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatPaise(totals.subtotalPaise)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>{formatPaise(totals.taxPaise)}</span></div>
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Checkbox checked={roundOff} onCheckedChange={(c) => setRoundOff(c === true)} aria-label="Round off" />
                  Round Off
                </span>
                <span>{formatPaise(totals.roundOffPaise)}</span>
              </label>
              <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatPaise(totals.totalPaise)}</span></div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground">Payment to supplier</Label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={payFull} onCheckedChange={(c) => setPayFull(c === true)} aria-label="Paid in full" />
                Paid in full
              </label>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={p.mode} onValueChange={(v) => setPayments((all) => all.map((x, j) => (j === i ? { ...x, mode: v as PaymentModeValue } : x)))}>
                  <SelectTrigger className="h-8 w-36 text-xs" aria-label={`Payment ${i + 1} mode`}><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input
                  aria-label={`Payment ${i + 1} amount`}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-8 flex-1 text-right font-mono text-xs"
                  disabled={payFull && i === 0}
                  value={payFull && i === 0 ? (totals.fullFirstPaymentPaise / 100).toFixed(2) : p.rupees}
                  onChange={(e) => setPayments((all) => all.map((x, j) => (j === i ? { ...x, rupees: e.target.value } : x)))}
                />
                {payments.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove payment" onClick={() => setPayments((all) => all.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="link" className="h-auto self-start p-0 text-xs" onClick={() => setPayments((all) => [...all, { mode: "upi", rupees: "" }])}>
              + Add Payment type
            </Button>

            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Paid</span><span>{formatPaise(totals.amountPaidPaise)}</span></div>
              <div className="flex justify-between font-medium"><span>Balance payable to supplier</span><span>{formatPaise(totals.balancePaise)}</span></div>
            </div>

          </CardContent>
        </Card>
      </div>
    </div>

    {/* Pinned bottom bar: the purchase total and the hold / save actions are always on screen. */}
    <div className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-card/95 px-3 py-2.5 shadow-[0_-6px_16px_rgb(17_45_78/6%)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="text-muted-foreground">{lines.length} item{lines.length === 1 ? "" : "s"}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono text-lg font-bold tabular-nums text-primary">{formatPaise(totals.totalPaise)}</span>
        </span>
        <span className="text-muted-foreground">Paid <span className="font-mono text-foreground">{formatPaise(totals.amountPaidPaise)}</span></span>
        <span className={totals.balancePaise > 0 ? "font-semibold text-rose-600" : "text-muted-foreground"}>Balance payable <span className="font-mono">{formatPaise(Math.max(0, totals.balancePaise))}</span></span>
        {serverError && <p className="w-full text-xs font-medium text-destructive">{serverError}</p>}
        {holdNotice && !serverError && <p className="w-full text-xs font-medium text-amber-700">{holdNotice}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!editPurchaseId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 border-amber-300 text-amber-800 hover:bg-amber-50"
            disabled={submitting || holding}
            onClick={() => void holdBill()}
            title="Park this purchase and start a new one"
          >
            <Pause className="h-3.5 w-3.5 mr-1" />
            {holding ? "Holding..." : "Hold"}
          </Button>
        )}
        {!editPurchaseId && (
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={submitting} onClick={() => savePurchase("new")}>
            Save &amp; New
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="h-9 bg-[#1a73e8] font-semibold text-white shadow-xs hover:bg-[#1557b0]"
          disabled={submitting}
          onClick={() => savePurchase("list")}
        >
          {submitting ? "Saving…" : editPurchaseId ? "Save Changes" : "Save Purchase"}
        </Button>
      </div>
    </div>
    </div>
  );
}
