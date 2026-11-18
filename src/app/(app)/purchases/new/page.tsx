"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { purchaseFormSchema, type PurchaseFormValues } from "@/lib/schemas/purchase";
import { basisPointsOf, computePurchaseLine, gramsToMg } from "@/lib/jewelry-calc";
import { boxOptionLabel } from "@/lib/box-label";
import { formatPaise, percentToBasisPoints, rupeesToPaise } from "@/lib/money";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { GST_STATES } from "@/lib/gst-state-codes";

type PaymentModeValue = "cash" | "upi" | "card" | "cheque" | "bank_transfer";

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

function emptyLine() {
  return {
    productId: "",
    manualProductName: "",
    boxId: "",
    manualBoxNumber: "",
    label: "",
    metalPurityId: "",
    piecesText: "1",
    grossWeightGrams: "",
    stoneWeightGrams: "",
    ratePerGramRupees: "",
    unitPriceRupees: "",
    makingChargeRupees: "",
    stoneChargeRupees: "",
    discountRupees: "",
  };
}

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

export default function NewPurchasePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editPurchaseId = searchParams.get("edit") as Id<"purchases"> | null;
  const existingPurchase = useQuery(
    api.purchases.getForEdit,
    editPurchaseId ? { purchaseId: editPurchaseId } : "skip",
  );

  const suppliers = useQuery(api.suppliers.list);
  const products = useQuery(api.products.list);
  const boxes = useQuery(api.boxes.list);
  const access = useQuery(api.organizations.getMyAccess);
  // GST companies keep item-wise stock: purchased lines go there, not into boxes.
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
  const createBox = useMutation(api.boxes.createNext);

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [serverError, setServerError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const [isNewSupplier, setIsNewSupplier] = useState(false);
  const [manualProductFlags, setManualProductFlags] = useState<Record<number, boolean>>({});
  const [manualBoxFlags, setManualBoxFlags] = useState<Record<number, boolean>>({});
  const [quickIsManualProduct, setQuickIsManualProduct] = useState(false);
  const [quickManualProductName, setQuickManualProductName] = useState("");
  const [quickIsManualBox, setQuickIsManualBox] = useState(false);
  const [quickManualBoxNumber, setQuickManualBoxNumber] = useState("");
  // Vyapar purchase-form extras kept outside react-hook-form (all optional).
  const [supplierBillNumber, setSupplierBillNumber] = useState("");
  const [stateOfSupply, setStateOfSupply] = useState("");
  const [roundOff, setRoundOff] = useState(true);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [extraPayments, setExtraPayments] = useState<{ mode: PaymentModeValue; rupees: string }[]>([]);
  const [billImageId, setBillImageId] = useState<Id<"_storage"> | undefined>();
  const [billImageName, setBillImageName] = useState("");
  const [uploadingBill, setUploadingBill] = useState(false);
  const uploadBillUrl = useMutation(api.purchases.generateBillImageUploadUrl);

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

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      supplierId: "",
      manualSupplierName: "",
      manualSupplierPhone: "",
      billDate: todayDateInput(),
      gstPercent: "",
      amountPaidRupees: "",
      paymentMode: undefined,
      items: [emptyLine()],
    },
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!editPurchaseId || !existingPurchase || prefilled) return;
    const { purchase, items, payment, payments } = existingPurchase;
    setSupplierBillNumber(purchase.supplierBillNumber ?? "");
    setStateOfSupply(purchase.stateOfSupply ?? "");
    setRoundOff((purchase.roundOffPaise ?? 0) !== 0);
    setNotes(purchase.notes ?? "");
    setShowNotes(!!purchase.notes);
    setBillImageId(purchase.billImageStorageId);
    setBillImageName(purchase.billImageStorageId ? "Bill attached" : "");
    setExtraPayments(payments.slice(1).map((p) => ({ mode: p.mode as PaymentModeValue, rupees: (p.amountPaise / 100).toFixed(2) })));
    const gstPercent = purchase.subtotalPaise > 0 ? ((purchase.taxPaise / purchase.subtotalPaise) * 100).toFixed(2) : "0";
    form.reset({
      supplierId: purchase.supplierId,
      billDate: timestampToDateInput(purchase.createdAt),
      gstPercent,
      amountPaidRupees: ((payment?.amountPaise ?? purchase.amountPaidPaise) / 100).toFixed(2),
      paymentMode: payment?.mode as PurchaseFormValues["paymentMode"],
      items: items.map((item) => ({
        productId: item.productId,
        boxId: item.boxId ?? "",
        label: item.label,
        metalPurityId: item.metalPurityId ?? "",
        piecesText: String(item.pieces ?? 1),
        grossWeightGrams: (item.grossWeightMg / 1000).toFixed(3),
        stoneWeightGrams: (item.stoneWeightMg / 1000).toFixed(3),
        ratePerGramRupees: item.ratePerGramPaise ? (item.ratePerGramPaise / 100).toFixed(2) : "",
        unitPriceRupees: item.unitPricePaise ? (item.unitPricePaise / 100).toFixed(2) : "",
        makingChargeRupees: (item.makingChargePaise / 100).toFixed(2),
        stoneChargeRupees: (item.stoneChargePaise / 100).toFixed(2),
        discountRupees: item.lineDiscountPaise ? (item.lineDiscountPaise / 100).toFixed(2) : "",
      })),
    });
    setPrefilled(true);
  }, [editPurchaseId, existingPurchase, prefilled, form]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  // Every purchased piece goes into a box — the GST company has its own boxes, like Daily Sales.
  const lineCount = fields.length;
  useEffect(() => {
    for (let i = 0; i < lineCount; i++) form.setValue(`items.${i}.toItemStock`, false);
  }, [lineCount, form]);

  // Quick-add: pick a product/box/rate once and generate that many pre-filled
  // lines at once — the operator still enters each piece's actual weight
  // (gold pieces of the "same" design never weigh exactly the same), but
  // doesn't have to re-pick product/box/charges N times for a bulk receipt.
  const [quickProductId, setQuickProductId] = useState("");
  const [quickBoxId, setQuickBoxId] = useState("");
  const [quickQuantity, setQuickQuantity] = useState("1");
  function handleQuickAdd() {
    const product = products?.find((p) => p._id === quickProductId);
    const prodName = product ? product.name : quickManualProductName.trim();
    if (!prodName) return;
    const quantity = Math.max(1, Math.min(50, Math.round(Number(quickQuantity)) || 1));
    const latestRate = product?.metalPurityId
      ? currentRates?.find((rate) => rate.purity._id === product.metalPurityId)?.latest?.ratePerGramPaise
      : undefined;
    const existingCount = fields.length;
    append(
      Array.from({ length: quantity }, (_, i) => ({
        ...emptyLine(),
        productId: quickProductId || "",
        manualProductName: quickIsManualProduct ? prodName : "",
        boxId: quickBoxId || product?.defaultBoxId || "",
        manualBoxNumber: quickIsManualBox ? quickManualBoxNumber.trim() : "",
        label: `${prodName} ${existingCount + i + 1}`,
        metalPurityId: product?.metalPurityId ?? "",
        grossWeightGrams: product?.grossWeightMg ? (product.grossWeightMg / 1000).toFixed(3) : "",
        stoneWeightGrams: product?.stoneWeightMg ? (product.stoneWeightMg / 1000).toFixed(3) : "",
        unitPriceRupees: product?.purchasePricePaise ? (product.purchasePricePaise / 100).toFixed(2) : "",
        makingChargeRupees: product?.makingChargePaise ? (product.makingChargePaise / 100).toFixed(2) : "",
        ratePerGramRupees: latestRate ? (latestRate / 100).toFixed(2) : "",
      })),
    );
    setQuickQuantity("1");
    if (quickIsManualProduct) {
      for (let k = existingCount; k < existingCount + quantity; k++) {
        setManualProductFlags((prev) => ({ ...prev, [k]: true }));
      }
    }
    if (quickIsManualBox) {
      for (let k = existingCount; k < existingCount + quantity; k++) {
        setManualBoxFlags((prev) => ({ ...prev, [k]: true }));
      }
    }
  }

  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedSupplierId = useWatch({ control: form.control, name: "supplierId" });
  const selectedSupplier = suppliers?.find((sup) => sup._id === watchedSupplierId);
  const supplierState = selectedSupplier?.state;
  // Vyapar defaults State of supply to the party's state.
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { if (supplierState && !stateOfSupply) setStateOfSupply(supplierState); }, [supplierState, stateOfSupply]);
  const watchedGst = useWatch({ control: form.control, name: "gstPercent" });
  const watchedPaid = useWatch({ control: form.control, name: "amountPaidRupees" });

  const totals = useMemo(() => {
    const lines = (watchedItems ?? []).map((item) =>
      computePurchaseLine({
        grossWeightMg: gramsToMg(item.grossWeightGrams || "0"),
        stoneWeightMg: gramsToMg(item.stoneWeightGrams || "0"),
        ratePerGramPaise: rupeesToPaise(item.ratePerGramRupees || "0") ?? 0,
        unitPricePaise: rupeesToPaise(item.unitPriceRupees || "0") ?? 0,
        // A price per piece is multiplied by the Qty, same as the server.
        pieces: Number(item.piecesText || 1),
        makingChargePaise: rupeesToPaise(item.makingChargeRupees || "0") ?? 0,
        stoneChargePaise: rupeesToPaise(item.stoneChargeRupees || "0") ?? 0,
        lineDiscountPaise: rupeesToPaise(item.discountRupees || "0") ?? 0,
      }),
    );
    const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    const gstBasisPoints = percentToBasisPoints(watchedGst || "0") ?? 0;
    const taxPaise = basisPointsOf(subtotalPaise, gstBasisPoints);
    const unrounded = subtotalPaise + taxPaise;
    const roundOffPaise = roundOff ? Math.round(unrounded / 100) * 100 - unrounded : 0;
    const totalPaise = unrounded + roundOffPaise;
    const paid = (rupeesToPaise(watchedPaid || "0") ?? 0) + extraPayments.reduce((a, p) => a + (rupeesToPaise(p.rupees || "0") ?? 0), 0);
    const amountPaidPaise = Math.min(paid, totalPaise);
    return { lines, subtotalPaise, taxPaise, roundOffPaise, totalPaise, amountPaidPaise, balancePaise: totalPaise - amountPaidPaise };
  }, [watchedItems, watchedGst, watchedPaid, roundOff, extraPayments]);

  async function onSubmit(values: PurchaseFormValues) {
    setServerError(null);
    try {
      // 1. Resolve supplierId
      let resolvedSupplierId: Id<"suppliers">;
      if (isNewSupplier || !values.supplierId) {
        const manualName = values.manualSupplierName?.trim() || "";
        if (!manualName) {
          setServerError("Please select a supplier or enter a supplier name.");
          return;
        }
        const existing = suppliers?.find(
          (s) => s.name.trim().toLowerCase() === manualName.toLowerCase()
        );
        if (existing) {
          resolvedSupplierId = existing._id;
        } else {
          resolvedSupplierId = await createSupplier({
            name: manualName,
            phone: values.manualSupplierPhone?.trim() || undefined,
          });
        }
      } else {
        resolvedSupplierId = values.supplierId as Id<"suppliers">;
      }

      // 2. Resolve items
      const resolvedItems: Array<{
        productId: Id<"products">;
        boxId?: Id<"boxes">;
        pieces?: number;
        metal?: "gold" | "silver";
        label: string;
        metalPurityId?: Id<"metalPurities">;
        grossWeightMg: number;
        stoneWeightMg: number;
        ratePerGramPaise: number;
        unitPricePaise?: number;
        makingChargePaise: number;
        stoneChargePaise: number;
        lineDiscountPaise?: number;
      }> = [];

      for (let i = 0; i < values.items.length; i++) {
        const item = values.items[i];

        // Resolve Product
        let resolvedProductId: Id<"products">;
        if (item.manualProductName?.trim()) {
          const manualProd = item.manualProductName.trim();
          const existingProd = products?.find(
            (p) => p.name.trim().toLowerCase() === manualProd.toLowerCase()
          );
          if (existingProd) {
            resolvedProductId = existingProd._id;
          } else {
            resolvedProductId = await createProduct({
              name: manualProd,
              unit: "piece",
              itemType: "product",
              metalPurityId: item.metalPurityId ? (item.metalPurityId as Id<"metalPurities">) : undefined,
            });
          }
        } else if (item.productId) {
          resolvedProductId = item.productId as Id<"products">;
        } else {
          setServerError(`Item ${i + 1}: Please select or type a product name.`);
          return;
        }

        // Resolve the box (each company has its own boxes)
        let resolvedBoxId: Id<"boxes"> | undefined;
        if (item.manualBoxNumber?.trim()) {
          const boxNum = Number(item.manualBoxNumber.trim());
          if (!Number.isSafeInteger(boxNum) || boxNum < 1) {
            setServerError(`Item ${i + 1}: Please enter a valid box number (e.g. 101).`);
            return;
          }
          const existingBox = boxes?.find((b) => b.boxNumber === boxNum);
          if (existingBox) {
            resolvedBoxId = existingBox._id;
          } else {
            resolvedBoxId = await createBox({
              boxNumber: boxNum,
              label: item.manualProductName || item.label || `Box ${boxNum}`,
              metal: purities?.find((p) => p._id === item.metalPurityId)?.metal,
            });
          }
        } else if (item.boxId) {
          resolvedBoxId = item.boxId as Id<"boxes">;
        } else {
          if (boxes && boxes.length > 0) {
            resolvedBoxId = boxes[0]._id;
          } else {
            resolvedBoxId = await createBox({ label: "Main Counter Box" });
          }
        }

        const label = item.label?.trim() || item.manualProductName?.trim() || `Item ${i + 1}`;

        resolvedItems.push({
          productId: resolvedProductId,
          boxId: resolvedBoxId,
          pieces: Number(item.piecesText || 1),
          metal: purities?.find((p) => p._id === item.metalPurityId)?.metal,
          label,
          metalPurityId: item.metalPurityId ? (item.metalPurityId as Id<"metalPurities">) : undefined,
          grossWeightMg: gramsToMg(item.grossWeightGrams || "0"),
          stoneWeightMg: gramsToMg(item.stoneWeightGrams || "0"),
          ratePerGramPaise: rupeesToPaise(item.ratePerGramRupees || "0") ?? 0,
          unitPricePaise: rupeesToPaise(item.unitPriceRupees || "0") || undefined,
          makingChargePaise: rupeesToPaise(item.makingChargeRupees || "0") ?? 0,
          stoneChargePaise: rupeesToPaise(item.stoneChargeRupees || "0") ?? 0,
          lineDiscountPaise: rupeesToPaise(item.discountRupees || "0") || undefined,
        });
      }

      const amountPaidPaise = rupeesToPaise(values.amountPaidRupees || "0") ?? 0;
      if (amountPaidPaise > 0 && !values.paymentMode) throw new Error("Select the payment mode for the amount paid.");
      const payments = [
        ...(amountPaidPaise > 0 && values.paymentMode ? [{ mode: values.paymentMode, amountPaise: amountPaidPaise }] : []),
        ...extraPayments.map((p) => {
          const amountPaise = rupeesToPaise(p.rupees || "0");
          if (amountPaise === null) throw new Error("One of the split payment amounts is not valid.");
          return { mode: p.mode, amountPaise };
        }).filter((p) => p.amountPaise > 0),
      ];
      const extras = {
        payments,
        roundOff,
        supplierBillNumber: supplierBillNumber.trim() || undefined,
        stateOfSupply: stateOfSupply || undefined,
        notes: notes.trim() || undefined,
        billImageStorageId: billImageId,
      };

      if (editPurchaseId) {
        await updatePurchase({
          purchaseId: editPurchaseId,
          supplierId: resolvedSupplierId,
          gstBasisPoints: percentToBasisPoints(values.gstPercent || "0") ?? 0,
          amountPaidPaise,
          paymentMode: amountPaidPaise > 0 ? values.paymentMode : undefined,
          billDate: dateInputToTimestamp(values.billDate),
          ...extras,
          items: resolvedItems,
        });
        router.push(`/purchases/invoices?updated=${editPurchaseId}`);
      } else {
        const result = await createPurchase({
          supplierId: resolvedSupplierId,
          gstBasisPoints: percentToBasisPoints(values.gstPercent || "0") ?? 0,
          amountPaidPaise,
          paymentMode: amountPaidPaise > 0 ? values.paymentMode : undefined,
          billDate: dateInputToTimestamp(values.billDate),
          ...extras,
          idempotencyKey,
          items: resolvedItems,
        });
        router.push(`/purchases/invoices?created=${result.purchaseId}`);
      }
    } catch (e) {
      setServerError(
        getUserErrorMessage(e, "Could not save purchase. You may need Purchase Manager access, or check item details."),
      );
    }
  }

  const loading =
    suppliers === undefined ||
    products === undefined ||
    boxes === undefined ||
    purities === undefined ||
    currentRates === undefined ||
    (editPurchaseId ? !prefilled : false);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{editPurchaseId ? "Edit Purchase" : "New Purchase"}</h1>
          <Button type="button" variant="outline" size="sm" onClick={() => window.open("/purchases/new", "_blank", "noopener")} title="Open another blank bill in a new tab; this one stays open">
            <Plus className="h-4 w-4" />
            New Bill Tab
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {editPurchaseId
            ? "Editing reverses the original stock and ledger effects, then reapplies the corrected ones."
            : "Gold, silver or ready-ornament inward from a supplier — items are placed directly into a box."}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Form {...form}>
          <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Supplier Details</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Select an existing supplier or add a new supplier manually.</p>
                </div>
                {!blockNewParties && <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsNewSupplier((prev) => !prev);
                    if (!isNewSupplier) {
                      form.setValue("supplierId", "");
                    } else {
                      form.setValue("manualSupplierName", "");
                      form.setValue("manualSupplierPhone", "");
                    }
                  }}
                >
                  {isNewSupplier ? "Select Existing Supplier" : "+ Manual / New Supplier"}
                </Button>}
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4 items-start">
                  {!isNewSupplier ? (
                    <FormField
                      control={form.control}
                      name="supplierId"
                      render={({ field }) => (
                        <FormItem className="max-w-sm flex-1">
                          <FormLabel>Select Supplier</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select supplier" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {suppliers?.map((s) => (
                                <SelectItem key={s._id} value={s._id}>
                                  {s.name} {s.phone ? `(${s.phone})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <>
                      <FormField
                        control={form.control}
                        name="manualSupplierName"
                        render={({ field }) => (
                          <FormItem className="max-w-sm flex-1">
                            <FormLabel>Supplier Name *</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g. Balaji Ornaments, Raj Jewellers" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="manualSupplierPhone"
                        render={({ field }) => (
                          <FormItem className="w-48">
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g. 9876543210" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                  <FormField
                    control={form.control}
                    name="billDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bill date</FormLabel>
                        <FormControl>
                          <Input type="date" className="w-44" max={todayDateInput()} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {!isNewSupplier && selectedSupplier && (
                    <div className="grid gap-2">
                      <span className="text-sm font-medium">Phone No.</span>
                      <Input readOnly value={selectedSupplier.phone ?? ""} placeholder="—" className="w-40 bg-muted/40" aria-label="Supplier phone" />
                    </div>
                  )}
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">Supplier Bill Number</span>
                    <Input value={supplierBillNumber} onChange={(e) => setSupplierBillNumber(e.target.value)} placeholder="No. on supplier's bill" className="w-44" aria-label="Supplier bill number" />
                  </div>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">State of supply</span>
                    <Select value={stateOfSupply} onValueChange={setStateOfSupply}>
                      <SelectTrigger className="w-48" aria-label="State of supply"><SelectValue placeholder={access?.organization?.state ?? "Select state"} /></SelectTrigger>
                      <SelectContent>{GST_STATES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">Receiving multiple pieces of the same design?</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Pick or type the product, box and quantity — each piece gets its own line to enter actual weight.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!blockNewItems && <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setQuickIsManualProduct((p) => !p)}
                    >
                      {quickIsManualProduct ? "Select Product from list" : "+ Type custom product"}
                    </Button>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setQuickIsManualBox((p) => !p)}
                    >
                      {quickIsManualBox ? "Select Box from list" : "+ Type box number"}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="grid min-w-[12rem] flex-1 gap-1.5">
                    <label className="text-xs font-medium">Product</label>
                    {quickIsManualProduct ? (
                      <Input
                        placeholder="e.g. Silver Chain, Gold Bangle"
                        value={quickManualProductName}
                        onChange={(e) => setQuickManualProductName(e.target.value)}
                      />
                    ) : (
                      <Select value={quickProductId} onValueChange={setQuickProductId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products?.map((p) => (
                            <SelectItem key={p._id} value={p._id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="grid min-w-[10rem] flex-1 gap-1.5">
                    <label className="text-xs font-medium">Destination box</label>
                    {quickIsManualBox ? (
                      <Input
                        placeholder="Box #, e.g. 101, 102"
                        value={quickManualBoxNumber}
                        onChange={(e) => setQuickManualBoxNumber(e.target.value)}
                      />
                    ) : (
                      <Select value={quickBoxId} onValueChange={setQuickBoxId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select box" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {boxes?.map((b) => (
                            <SelectItem key={b._id} value={b._id}>
                              Box {b.boxNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="grid w-24 gap-1.5">
                    <label className="text-xs font-medium">Quantity</label>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={quickQuantity}
                      onChange={(e) => setQuickQuantity(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={
                      (quickIsManualProduct ? !quickManualProductName.trim() : !quickProductId) ||
                      (quickIsManualBox ? !quickManualBoxNumber.trim() : !quickBoxId)
                    }
                    onClick={handleQuickAdd}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add {quickQuantity || "1"} piece{Number(quickQuantity) === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                <div>
                  <h2 className="font-semibold">Items in this bill <span className="text-muted-foreground">({fields.length})</span></h2>
                  <p className="mt-1 text-sm text-muted-foreground">Add one line for each product or ornament received.</p>
                </div>
                <Button type="button" variant="outline" onClick={() => append(emptyLine())}>
                  <Plus className="h-4 w-4" /> Add one-off item
                </Button>
              </div>
              {fields.map((field, index) => {
                const line = totals.lines[index];
                return (
                  <Card key={field.id}>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Item {index + 1}</CardTitle>
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {/* Product Column */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Product</span>
                            {!blockNewItems && <button
                              type="button"
                              className="text-[11px] text-primary hover:underline"
                              onClick={() => {
                                setManualProductFlags((prev) => ({
                                  ...prev,
                                  [index]: !prev[index],
                                }));
                              }}
                            >
                              {manualProductFlags[index] ? "Select list" : "+ Type manual"}
                            </button>}
                          </div>
                          {manualProductFlags[index] ? (
                            <FormField
                              control={form.control}
                              name={`items.${index}.manualProductName`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      placeholder="e.g. Silver Chain, Gold Ring"
                                      onChange={(e) => {
                                        field.onChange(e);
                                        if (!form.getValues(`items.${index}.label`)) {
                                          form.setValue(`items.${index}.label`, e.target.value);
                                        }
                                      }}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ) : (
                            <FormField
                              control={form.control}
                              name={`items.${index}.productId`}
                              render={({ field }) => (
                                <FormItem>
                                  <Select
                                    value={field.value}
                                    onValueChange={(productId) => {
                                      field.onChange(productId);
                                      const product = products?.find((item) => item._id === productId);
                                      if (!product) return;
                                      form.setValue(`items.${index}.label`, product.name, { shouldDirty: true });
                                      form.setValue(`items.${index}.metalPurityId`, product.metalPurityId ?? "", { shouldDirty: true });
                                      // Fill the rest from the item master: box, weights, purchase price, making.
                                      const opts = { shouldDirty: true };
                                      if (product.defaultBoxId && !form.getValues(`items.${index}.boxId`)) form.setValue(`items.${index}.boxId`, product.defaultBoxId, opts);
                                      if (product.grossWeightMg) form.setValue(`items.${index}.grossWeightGrams`, (product.grossWeightMg / 1000).toFixed(3), opts);
                                      if (product.stoneWeightMg !== undefined) form.setValue(`items.${index}.stoneWeightGrams`, (product.stoneWeightMg / 1000).toFixed(3), opts);
                                      if (product.purchasePricePaise) form.setValue(`items.${index}.unitPriceRupees`, (product.purchasePricePaise / 100).toFixed(2), opts);
                                      if (product.makingChargePaise) form.setValue(`items.${index}.makingChargeRupees`, (product.makingChargePaise / 100).toFixed(2), opts);
                                      // GST % from the item's tax rate, when the bill has none yet.
                                      const tax = product.taxConfigurationId ? taxConfigs?.find((t) => t._id === product.taxConfigurationId) : undefined;
                                      if (gstCompany && tax && !form.getValues("gstPercent")) {
                                        form.setValue("gstPercent", String((tax.cgstBasisPoints + tax.sgstBasisPoints || tax.igstBasisPoints) / 100), opts);
                                      }
                                      const latestRate = currentRates?.find((rate) => rate.purity._id === product.metalPurityId)?.latest?.ratePerGramPaise;
                                      if (latestRate) form.setValue(`items.${index}.ratePerGramRupees`, (latestRate / 100).toFixed(2), { shouldDirty: true });
                                    }}
                                  >
                                    <FormControl>
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select product" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {products?.map((p) => (
                                        <SelectItem key={p._id} value={p._id}>
                                          {p.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>

                        {/* Box column (both companies — each has its own boxes) */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Destination Box</span>
                            <button
                              type="button"
                              className="text-[11px] text-primary hover:underline"
                              onClick={() => {
                                setManualBoxFlags((prev) => ({
                                  ...prev,
                                  [index]: !prev[index],
                                }));
                              }}
                            >
                              {manualBoxFlags[index] ? "Select list" : "+ Type box #"}
                            </button>
                          </div>
                          {manualBoxFlags[index] ? (
                            <FormField
                              control={form.control}
                              name={`items.${index}.manualBoxNumber`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      placeholder="e.g. 101, 102"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ) : (
                            <FormField
                              control={form.control}
                              name={`items.${index}.boxId`}
                              render={({ field }) => (
                                <FormItem>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl>
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select box" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="max-h-64">
                                      {/* Gold lines only into gold boxes, silver into silver (by the line's purity). */}
                                      {boxes?.filter((b) => {
                                        const metal = purities?.find((p) => p._id === watchedItems?.[index]?.metalPurityId)?.metal;
                                        return b.isActive && (!metal || !b.metal || b.metal === metal);
                                      }).map((b) => (
                                        <SelectItem key={b._id} value={b._id}>
                                          {boxOptionLabel(b)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>

                        {/* Purity Column */}
                        <FormField
                          control={form.control}
                          name={`items.${index}.metalPurityId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Purity</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="None" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {purities?.map((p) => (
                                    <SelectItem key={p._id} value={p._id}>
                                      {p.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={form.control}
                        name={`items.${index}.label`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Item label</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g. Chain #1, 22K" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                        <FormField
                          control={form.control}
                          name={`items.${index}.piecesText`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Qty (pcs)</FormLabel>
                              <FormControl>
                                <Input {...field} inputMode="numeric" placeholder="1" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.grossWeightGrams`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Gross wt (g)</FormLabel>
                              <FormControl>
                                <Input {...field} inputMode="decimal" placeholder="0.000" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.stoneWeightGrams`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Less wt (g)</FormLabel>
                              <FormControl>
                                <Input {...field} inputMode="decimal" placeholder="0.000" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.ratePerGramRupees`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Rate / g (₹)</FormLabel>
                              <FormControl>
                                <Input {...field} inputMode="decimal" placeholder="0.00" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.unitPriceRupees`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Purchase price (₹/pc)</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} inputMode="decimal" placeholder="or by rate/g" title="Fixed price per piece — when set, it is used instead of weight × rate" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.makingChargeRupees`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Making (₹)</FormLabel>
                              <FormControl>
                                <Input {...field} inputMode="decimal" placeholder="0.00" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.stoneChargeRupees`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Stone chg (₹)</FormLabel>
                              <FormControl>
                                <Input {...field} inputMode="decimal" placeholder="0.00" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.discountRupees`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Discount (₹)</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} inputMode="decimal" placeholder="0.00" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {line && (
                        <p className="text-sm text-muted-foreground">
                          Net weight {(line.netWeightMg / 1000).toFixed(3)}g · Metal value{" "}
                          {formatPaise(line.metalValuePaise)} · Line total{" "}
                          <span className="font-medium text-foreground">{formatPaise(line.lineTotalPaise)}</span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <FormField
                      control={form.control}
                      name="gstPercent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>GST (%)</FormLabel>
                          <FormControl>
                            <Input {...field} inputMode="decimal" placeholder="0" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex flex-wrap gap-1 pt-1">
                      {[
                        { label: "0% Non-GST", val: "0" },
                        { label: "3% Jewellery", val: "3" },
                        { label: "5%", val: "5" },
                        { label: "18%", val: "18" },
                      ].map((item) => (
                        <button
                          key={item.val}
                          type="button"
                          onClick={() => form.setValue("gstPercent", item.val, { shouldDirty: true })}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                            watchedGst === item.val
                              ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                              : "bg-muted/60 text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <FormField
                    control={form.control}
                    name="amountPaidRupees"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount paid now (₹)</FormLabel>
                        <FormControl>
                          <Input {...field} inputMode="decimal" placeholder="0.00" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {Number(watchedPaid || "0") > 0 && (
                    <FormField
                      control={form.control}
                      name="paymentMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment mode</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select mode" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {PAYMENT_MODES.map((m) => (
                                <SelectItem key={m.value} value={m.value}>
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                {extraPayments.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium">Payment type {i + 2}</span>
                      <Select value={p.mode} onValueChange={(v) => setExtraPayments((all) => all.map((x, j) => (j === i ? { ...x, mode: v as PaymentModeValue } : x)))}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Input aria-label={`Payment ${i + 2} amount`} inputMode="decimal" placeholder="0.00" className="w-40" value={p.rupees} onChange={(e) => setExtraPayments((all) => all.map((x, j) => (j === i ? { ...x, rupees: e.target.value } : x)))} />
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove payment" onClick={() => setExtraPayments((all) => all.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => setExtraPayments((all) => [...all, { mode: "upi", rupees: "" }])}>+ Add Payment type</Button>
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => setShowNotes((v) => !v)}>{showNotes ? "Hide description" : "+ Add Description / Terms"}</Button>
                  <label className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">
                    {uploadingBill ? "Uploading…" : billImageName ? `Bill: ${billImageName} (change)` : "+ Upload Bill (photo / PDF)"}
                    <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={uploadingBill} onChange={(e) => uploadBill(e.target.files?.[0])} />
                  </label>
                  {billImageId && <Button type="button" variant="link" className="h-auto p-0 text-destructive" onClick={() => { setBillImageId(undefined); setBillImageName(""); }}>Remove bill</Button>}
                </div>
                {showNotes && (
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Description, terms & conditions, remarks…" aria-label="Description and terms" />
                )}

                <Separator />

                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatPaise(totals.subtotalPaise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST</span>
                    <span>{formatPaise(totals.taxPaise)}</span>
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Checkbox checked={roundOff} onCheckedChange={(c) => setRoundOff(c === true)} aria-label="Round off" />
                      Round Off
                    </span>
                    <span>{formatPaise(totals.roundOffPaise)}</span>
                  </label>
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatPaise(totals.totalPaise)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paid</span>
                    <span>{formatPaise(totals.amountPaidPaise)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Balance payable to supplier</span>
                    <span>{formatPaise(totals.balancePaise)}</span>
                  </div>
                </div>

                {serverError && <p className="text-sm text-destructive">{serverError}</p>}

                <Button type="submit" disabled={form.formState.isSubmitting} className="self-end">
                  {form.formState.isSubmitting ? "Saving…" : editPurchaseId ? "Save Changes" : "Save Purchase"}
                </Button>
              </CardContent>
            </Card>
          </form>
        </Form>
      )}
    </div>
  );
}
