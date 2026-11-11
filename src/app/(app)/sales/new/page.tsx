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

type BillLine = {
  boxItemId: Id<"boxItems">;
  label: string;
  productName: string;
  grossWeightMg: number;
  stoneWeightMg: number;
  metalPurityId: string;
  otherDeductionGrams: string;
  ratePerGramRupees: string;
  wastagePercent: string;
  makingChargeRupees: string;
  stoneChargeRupees: string;
  taxConfigurationId: string;
};

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add items to this bill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative max-w-xs">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Enter box number"
            value={boxNumberInput}
            onChange={(e) => setBoxNumberInput(e.target.value)}
          />
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
      </CardContent>
    </Card>
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

  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const boxPickerRef = useRef<HTMLDivElement>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [billDate, setBillDate] = useState(() => todayDateInput());
  const [customerId, setCustomerId] = useState("");
  const [isGst, setIsGst] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
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
    const { sale, items, oldGoldExchange, payments: existingPayments } = existingSale;
    setInvoiceNumber(sale.invoiceNumber);
    setBillDate(timestampToDateInput(sale.createdAt));
    setCustomerId(sale.customerId);
    setIsGst(sale.isGst);
    setLines(
      items.map((item) => ({
        boxItemId: item.boxItemId as Id<"boxItems">,
        label: item.label,
        productName: item.productName,
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
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

  function addLine(boxItem: Doc<"boxItems">) {
    const product = productById.get(boxItem.productId);
    const purityId = product?.metalPurityId ?? "";
    const defaultRatePaise = purityId ? rateByPurity.get(purityId) : undefined;
    setLines((prev) => [
      ...prev,
      {
        boxItemId: boxItem._id,
        label: boxItem.label,
        productName: product?.name ?? "Product",
        grossWeightMg: boxItem.grossWeightMg,
        stoneWeightMg: boxItem.stoneWeightMg,
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
      lines.map((line) => {
        const taxConfig = taxConfigs?.find((t) => t._id === line.taxConfigurationId);
        const gstBasisPoints =
          isGst && taxConfig ? taxConfig.cgstBasisPoints + taxConfig.sgstBasisPoints + taxConfig.igstBasisPoints : 0;
        return computeSaleLine({
          grossWeightMg: line.grossWeightMg,
          stoneWeightMg: line.stoneWeightMg,
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

  const oldGoldComputed = useMemo(() => {
    if (!oldGoldEnabled) return null;
    return computeOldGoldExchange({
      grossWeightMg: gramsToMg(oldGoldGrossGrams || "0"),
      meltingDeductionBasisPoints: percentToBasisPoints(oldGoldMeltingPercent || "0") ?? 0,
      ratePerGramPaise: rupeesToPaise(oldGoldRateRupees || "0") ?? 0,
    });
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
    const preRound = subtotalPaise - discountPaise + taxPaise;
    const roundedTotal = preRound;
    const roundOffPaise = 0;
    const paymentsPaise = payments.reduce((sum, p) => sum + (rupeesToPaise(p.amountRupees || "0") ?? 0), 0);
    const oldGoldValuePaise = oldGoldComputed?.exchangeValuePaise ?? 0;
    const amountPaidPaise = paymentsPaise + oldGoldValuePaise;
    return {
      subtotalPaise,
      taxPaise,
      discountPaise,
      roundOffPaise,
      totalPaise: roundedTotal,
      oldGoldValuePaise,
      amountPaidPaise,
      balancePaise: roundedTotal - amountPaidPaise,
    };
  }, [computedLines, discountMode, discountValue, payments, oldGoldComputed]);

  /** Clears the form back to a blank bill so the operator can keep billing the next customer without leaving the page. */
  function resetForm() {
    setIdempotencyKey(crypto.randomUUID());
    setBillDate(todayDateInput());
    setCustomerId("");
    setLines([]);
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
    if (!customerId) {
      setServerError("Select a customer.");
      return;
    }
    if (lines.length === 0) {
      setServerError("Add at least one item.");
      return;
    }
    if (oldGoldEnabled && (!oldGoldPurityId || !oldGoldComputed || oldGoldComputed.grossWeightMg <= 0 || oldGoldComputed.ratePerGramPaise <= 0)) {
      setServerError("Fill in the old gold purity, weight and rate, or turn off old gold exchange.");
      return;
    }
    setSubmitting(true);
    try {
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
          customerId: customerId as Id<"customers">,
          isGst,
          items,
          discountMode,
          discountValue: discountValuePaiseOrBp,
          payments: paymentSplits,
          oldGoldExchange: oldGoldExchangeArg,
          billDate: dateInputToTimestamp(billDate),
        });
        router.push(`/sales/invoices?updated=${editSaleId}`);
        return;
      }

      const result = await createSale({
        invoiceNumber: invoiceNumber.trim() || undefined,
        customerId: customerId as Id<"customers">,
        isGst,
        items,
        discountMode,
        discountValue: discountValuePaiseOrBp,
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
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers?.map((c) => (
                        <SelectItem key={c._id} value={c._id}>
                          {c.name}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Invoice serial number</Label>
                  <Input aria-label="Invoice serial number" maxLength={60} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Enter number / leave blank for auto" className="mb-3 w-64" />
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

          <div ref={boxPickerRef}>
            <BoxItemPicker
              boxes={boxes}
              products={products}
              onAdd={addLine}
              alreadyAddedIds={new Set(lines.map((l) => l.boxItemId))}
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div>
                <h2 className="font-semibold">Items in this bill <span className="text-muted-foreground">({lines.length})</span></h2>
                <p className="mt-1 text-sm text-muted-foreground">No item-count limit is set. Each sale item must be a unique in-stock piece from a box.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => boxPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                <Plus className="h-4 w-4" /> Add Item
              </Button>
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
                      Gross {mgToGramsDisplay(line.grossWeightMg)}g · Stone {mgToGramsDisplay(line.stoneWeightMg)}g
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
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="grid gap-2">
                    <Label>Purity</Label>
                    <Select value={oldGoldPurityId} onValueChange={setOldGoldPurityId}>
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
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex flex-col gap-3">
                <Label>Payment</Label>
                {payments.map((payment, index) => (
                  <div key={index} className="flex items-center gap-2">
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
