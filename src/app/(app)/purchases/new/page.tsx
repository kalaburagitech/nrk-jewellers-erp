"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CirclePlus, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form } from "@/components/ui/form";
import { purchaseFormSchema, type PurchaseFormValues } from "@/lib/schemas/purchase";
import { basisPointsOf, computePurchaseLine, gramsToMg } from "@/lib/jewelry-calc";
import { formatPaise, percentToBasisPoints, rupeesToPaise } from "@/lib/money";
import type { Id } from "../../../../../convex/_generated/dataModel";

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
    grossWeightGrams: "",
    stoneWeightGrams: "",
    ratePerGramRupees: "",
    makingChargeRupees: "",
    stoneChargeRupees: "",
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
    const { purchase, items, payment } = existingPurchase;
    const gstPercent = purchase.subtotalPaise > 0 ? ((purchase.taxPaise / purchase.subtotalPaise) * 100).toFixed(2) : "0";
    form.reset({
      supplierId: purchase.supplierId,
      billDate: timestampToDateInput(purchase.createdAt),
      gstPercent,
      amountPaidRupees: (purchase.amountPaidPaise / 100).toFixed(2),
      paymentMode: payment?.mode as PurchaseFormValues["paymentMode"],
      items: items.map((item) => ({
        productId: item.productId,
        boxId: item.boxId ?? "",
        label: item.label,
        metalPurityId: item.metalPurityId ?? "",
        grossWeightGrams: (item.grossWeightMg / 1000).toFixed(3),
        stoneWeightGrams: (item.stoneWeightMg / 1000).toFixed(3),
        ratePerGramRupees: (item.ratePerGramPaise / 100).toFixed(2),
        makingChargeRupees: (item.makingChargePaise / 100).toFixed(2),
        stoneChargeRupees: (item.stoneChargePaise / 100).toFixed(2),
      })),
    });
    setPrefilled(true);
  }, [editPurchaseId, existingPurchase, prefilled, form]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  // Mark every line as "item stock" in a GST company so the box rule doesn't apply.
  const lineCount = fields.length;
  useEffect(() => {
    for (let i = 0; i < lineCount; i++) form.setValue(`items.${i}.toItemStock`, gstCompany);
  }, [gstCompany, lineCount, form]);

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
        boxId: quickBoxId || "",
        manualBoxNumber: quickIsManualBox ? quickManualBoxNumber.trim() : "",
        label: `${prodName} ${existingCount + i + 1}`,
        metalPurityId: product?.metalPurityId ?? "",
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
  const watchedGst = useWatch({ control: form.control, name: "gstPercent" });
  const watchedPaid = useWatch({ control: form.control, name: "amountPaidRupees" });
  const watchedSupplierId = useWatch({ control: form.control, name: "supplierId" });
  const watchedPaymentMode = useWatch({ control: form.control, name: "paymentMode" });

  const totals = useMemo(() => {
    const lines = (watchedItems ?? []).map((item) =>
      computePurchaseLine({
        grossWeightMg: gramsToMg(item.grossWeightGrams || "0"),
        stoneWeightMg: gramsToMg(item.stoneWeightGrams || "0"),
        ratePerGramPaise: rupeesToPaise(item.ratePerGramRupees || "0") ?? 0,
        makingChargePaise: rupeesToPaise(item.makingChargeRupees || "0") ?? 0,
        stoneChargePaise: rupeesToPaise(item.stoneChargeRupees || "0") ?? 0,
      }),
    );
    const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    const gstBasisPoints = percentToBasisPoints(watchedGst || "0") ?? 0;
    const taxPaise = basisPointsOf(subtotalPaise, gstBasisPoints);
    const totalPaise = subtotalPaise + taxPaise;
    const amountPaidPaise = Math.min(rupeesToPaise(watchedPaid || "0") ?? 0, totalPaise);
    return { lines, subtotalPaise, taxPaise, totalPaise, amountPaidPaise, balancePaise: totalPaise - amountPaidPaise };
  }, [watchedItems, watchedGst, watchedPaid]);

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
        label: string;
        metalPurityId?: Id<"metalPurities">;
        grossWeightMg: number;
        stoneWeightMg: number;
        ratePerGramPaise: number;
        makingChargePaise: number;
        stoneChargePaise: number;
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

        // Resolve Box (Daily Sales only; GST lines go into item stock)
        let resolvedBoxId: Id<"boxes"> | undefined;
        if (gstCompany) {
          resolvedBoxId = undefined;
        } else if (item.manualBoxNumber?.trim()) {
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
          ...(gstCompany ? { pieces: 1 } : {}),
          label,
          metalPurityId: item.metalPurityId ? (item.metalPurityId as Id<"metalPurities">) : undefined,
          grossWeightMg: gramsToMg(item.grossWeightGrams || "0"),
          stoneWeightMg: gramsToMg(item.stoneWeightGrams || "0"),
          ratePerGramPaise: rupeesToPaise(item.ratePerGramRupees || "0") ?? 0,
          makingChargePaise: rupeesToPaise(item.makingChargeRupees || "0") ?? 0,
          stoneChargePaise: rupeesToPaise(item.stoneChargeRupees || "0") ?? 0,
        });
      }

      const amountPaidPaise = rupeesToPaise(values.amountPaidRupees || "0") ?? 0;

      if (editPurchaseId) {
        await updatePurchase({
          purchaseId: editPurchaseId,
          supplierId: resolvedSupplierId,
          gstBasisPoints: percentToBasisPoints(values.gstPercent || "0") ?? 0,
          amountPaidPaise,
          paymentMode: amountPaidPaise > 0 ? values.paymentMode : undefined,
          billDate: dateInputToTimestamp(values.billDate),
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

  const itemErrors = form.formState.errors.items;
  const lineErrors = Array.isArray(itemErrors)
    ? itemErrors.flatMap((err, i) =>
        err
          ? Object.values(err as Record<string, { message?: string } | undefined>)
              .map((e) => e?.message)
              .filter(Boolean)
              .map((m) => `Row ${i + 1}: ${m}`)
          : [],
      )
    : [];
  const headerErrors = [
    form.formState.errors.supplierId?.message,
    form.formState.errors.billDate?.message,
    form.formState.errors.gstPercent?.message,
    form.formState.errors.amountPaidRupees?.message,
    itemErrors && !Array.isArray(itemErrors) ? (itemErrors as { message?: string }).message : undefined,
  ].filter(Boolean) as string[];
  const totalGrossMg = (watchedItems ?? []).reduce((sum, item) => sum + gramsToMg(item.grossWeightGrams || "0"), 0);
  const totalNetMg = totals.lines.reduce((sum, l) => sum + l.netWeightMg, 0);
  const cell = "h-10 w-full bg-transparent px-2 text-sm outline-none focus:bg-card focus:ring-1 focus:ring-primary";
  const th = "border-r border-border px-2 py-2.5 text-left text-xs font-semibold uppercase text-[#4b5263] dark:text-muted-foreground";

  return (
    <div className="-m-3 flex min-h-[calc(100svh-3.5rem)] flex-col bg-[#f1f2f5] sm:-m-4 lg:-m-5 dark:bg-background">
      <div className="flex items-center gap-2 border-b bg-[#e9ebef] px-3 pt-2 dark:bg-muted">
        <span className="flex items-center gap-6 rounded-t-md bg-card px-4 py-2 text-sm">
          {editPurchaseId ? "Edit Purchase" : "Purchase #1"}
          <button type="button" aria-label="Close purchase" onClick={() => router.push("/purchases/invoices")} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div className="flex items-center justify-between border-b bg-card px-5 py-3">
        <h1 className="text-2xl font-semibold">{editPurchaseId ? "Edit Purchase" : "Purchase"}</h1>
        <span className="text-sm font-medium">{access?.organization?.name}</span>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Form {...form}>
          <form className="flex flex-1 flex-col" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex flex-wrap items-start justify-between gap-6 px-5 py-6">
              <div className="flex flex-wrap items-start gap-4">
                {!isNewSupplier ? (
                  <label className="relative block">
                    <span className="pointer-events-none absolute -top-2 left-2.5 bg-[#f1f2f5] px-1 text-xs text-primary dark:bg-background">
                      Party <span className="text-destructive">*</span>
                    </span>
                    <select
                      aria-label="Party"
                      value={watchedSupplierId ?? ""}
                      onChange={(e) => {
                        if (e.target.value === "__new__") {
                          setIsNewSupplier(true);
                          form.setValue("supplierId", "");
                          return;
                        }
                        form.setValue("supplierId", e.target.value, { shouldValidate: true });
                      }}
                      className="h-11 w-64 rounded-md border-2 border-primary bg-card px-3 text-sm outline-none"
                    >
                      <option value="">Select party</option>
                      <option value="__new__">+ Add new party</option>
                      {suppliers?.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name}
                          {s.phone ? ` (${s.phone})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="relative block">
                      <span className="pointer-events-none absolute -top-2 left-2.5 bg-[#f1f2f5] px-1 text-xs text-primary dark:bg-background">
                        Party <span className="text-destructive">*</span>
                      </span>
                      <input
                        autoFocus
                        aria-label="New party name"
                        placeholder="Supplier name"
                        {...form.register("manualSupplierName")}
                        className="h-11 w-64 rounded-md border-2 border-primary bg-card px-3 text-sm outline-none"
                      />
                    </label>
                    <input aria-label="Phone number" placeholder="Phone No." {...form.register("manualSupplierPhone")} className="h-11 w-44 rounded-md border border-input bg-card px-3 text-sm outline-none" />
                    <button
                      type="button"
                      onClick={() => {
                        setIsNewSupplier(false);
                        form.setValue("manualSupplierName", "");
                        form.setValue("manualSupplierPhone", "");
                      }}
                      className="h-11 text-sm text-primary hover:underline"
                    >
                      Pick existing party
                    </button>
                  </>
                )}
              </div>
              <div className="grid grid-cols-[auto_12rem] items-center gap-x-4 gap-y-3 text-sm">
                <span className="text-right text-muted-foreground">Bill Number</span>
                <span className="border-b border-border pb-1 text-muted-foreground">Auto</span>
                <span className="text-right text-muted-foreground">Bill Date</span>
                <input type="date" aria-label="Bill date" max={todayDateInput()} {...form.register("billDate")} className="border-b border-border bg-transparent pb-1 outline-none" />
              </div>
            </div>

            <div className="overflow-x-auto bg-card">
              <table className="w-full min-w-[1100px] border-collapse">
                <thead className="border-y border-border bg-card">
                  <tr>
                    <th className={`${th} w-10`}>#</th>
                    <th className={`${th} w-48`}>Item</th>
                    <th className={th}>Item Name</th>
                    <th className={`${th} w-28`}>{gstCompany ? "Stock" : "Box"}</th>
                    <th className={`${th} w-24`}>Purity</th>
                    <th className={`${th} w-24`}>Gross Wt(g)</th>
                    <th className={`${th} w-24`}>Stone Wt(g)</th>
                    <th className={`${th} w-24`}>Net Wt(g)</th>
                    <th className={`${th} w-28`}>Rate/g (₹)</th>
                    <th className={`${th} w-24`}>Making(₹)</th>
                    <th className={`${th} w-24`}>Stone Chg(₹)</th>
                    <th className={`${th} w-32 text-right`}>Amount</th>
                    <th className="w-10 px-2">
                      <button type="button" aria-label="Add row" title="Add row" onClick={() => append(emptyLine())} className="text-primary">
                        <CirclePlus className="h-5 w-5" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => {
                    const line = totals.lines[index];
                    const manualProduct = manualProductFlags[index];
                    const manualBox = manualBoxFlags[index];
                    return (
                      <tr key={field.id} className="border-b border-border odd:bg-[#f7f8fa] dark:odd:bg-muted/40">
                        <td className="border-r border-border px-2 text-center text-sm text-muted-foreground">{index + 1}</td>
                        <td className="border-r border-border">
                          {manualProduct ? (
                            <div className="flex items-center">
                              <input
                                aria-label={`Row ${index + 1} new item name`}
                                placeholder="New item name"
                                {...form.register(`items.${index}.manualProductName`, {
                                  onChange: (e) => {
                                    if (!form.getValues(`items.${index}.label`)) form.setValue(`items.${index}.label`, e.target.value);
                                  },
                                })}
                                className={cell}
                              />
                              <button type="button" aria-label="Pick from item list" title="Pick from list" onClick={() => setManualProductFlags((p) => ({ ...p, [index]: false }))} className="px-1 text-muted-foreground">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <select
                              aria-label={`Row ${index + 1} item`}
                              value={watchedItems?.[index]?.productId ?? ""}
                              onChange={(e) => {
                                const productId = e.target.value;
                                if (productId === "__new__") {
                                  setManualProductFlags((p) => ({ ...p, [index]: true }));
                                  form.setValue(`items.${index}.productId`, "");
                                  return;
                                }
                                form.setValue(`items.${index}.productId`, productId, { shouldValidate: true });
                                const product = products?.find((item) => item._id === productId);
                                if (!product) return;
                                form.setValue(`items.${index}.label`, product.name, { shouldDirty: true });
                                form.setValue(`items.${index}.metalPurityId`, product.metalPurityId ?? "", { shouldDirty: true });
                                const latestRate = currentRates?.find((rate) => rate.purity._id === product.metalPurityId)?.latest?.ratePerGramPaise;
                                if (latestRate) form.setValue(`items.${index}.ratePerGramRupees`, (latestRate / 100).toFixed(2), { shouldDirty: true });
                                // Item defaults saved on the Add Item screen.
                                if (product.defaultGrossWeightMg !== undefined && !form.getValues(`items.${index}.grossWeightGrams`)) {
                                  form.setValue(`items.${index}.grossWeightGrams`, (product.defaultGrossWeightMg / 1000).toFixed(3), { shouldDirty: true });
                                  const stone = product.defaultNetWeightMg !== undefined ? product.defaultGrossWeightMg - product.defaultNetWeightMg : 0;
                                  if (stone > 0) form.setValue(`items.${index}.stoneWeightGrams`, (stone / 1000).toFixed(3), { shouldDirty: true });
                                }
                                if (product.defaultMakingChargePaise !== undefined && !form.getValues(`items.${index}.makingChargeRupees`)) {
                                  form.setValue(`items.${index}.makingChargeRupees`, (product.defaultMakingChargePaise / 100).toFixed(2), { shouldDirty: true });
                                }
                              }}
                              className={cell}
                            >
                              <option value="">Select item</option>
                              <option value="__new__">+ Type new item</option>
                              {products?.map((p) => (
                                <option key={p._id} value={p._id}>{p.name}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="border-r border-border">
                          <input aria-label={`Row ${index + 1} item name`} placeholder="e.g. Chain #1" {...form.register(`items.${index}.label`)} className={cell} />
                        </td>
                        <td className="border-r border-border">
                          {gstCompany ? (
                            <span className="px-2 text-xs text-muted-foreground">Item stock</span>
                          ) : manualBox ? (
                            <div className="flex items-center">
                              <input aria-label={`Row ${index + 1} box number`} type="number" placeholder="Box #" {...form.register(`items.${index}.manualBoxNumber`)} className={cell} />
                              <button type="button" aria-label="Pick box from list" onClick={() => setManualBoxFlags((p) => ({ ...p, [index]: false }))} className="px-1 text-muted-foreground">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <select
                              aria-label={`Row ${index + 1} box`}
                              value={watchedItems?.[index]?.boxId ?? ""}
                              onChange={(e) => {
                                if (e.target.value === "__new__") {
                                  setManualBoxFlags((p) => ({ ...p, [index]: true }));
                                  form.setValue(`items.${index}.boxId`, "");
                                  return;
                                }
                                form.setValue(`items.${index}.boxId`, e.target.value, { shouldValidate: true });
                              }}
                              className={cell}
                            >
                              <option value="">Box</option>
                              <option value="__new__">+ Type box #</option>
                              {boxes?.map((b) => (
                                <option key={b._id} value={b._id}>Box {b.boxNumber}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="border-r border-border">
                          <select aria-label={`Row ${index + 1} purity`} {...form.register(`items.${index}.metalPurityId`)} className={cell}>
                            <option value="">None</option>
                            {purities?.map((p) => (
                              <option key={p._id} value={p._id}>{p.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="border-r border-border"><input aria-label={`Row ${index + 1} gross weight`} inputMode="decimal" placeholder="0.000" {...form.register(`items.${index}.grossWeightGrams`)} className={`${cell} text-right`} /></td>
                        <td className="border-r border-border"><input aria-label={`Row ${index + 1} stone weight`} inputMode="decimal" placeholder="0.000" {...form.register(`items.${index}.stoneWeightGrams`)} className={`${cell} text-right`} /></td>
                        <td className="border-r border-border px-2 text-right text-sm tabular-nums">{line ? (line.netWeightMg / 1000).toFixed(3) : "0.000"}</td>
                        <td className="border-r border-border"><input aria-label={`Row ${index + 1} rate per gram`} inputMode="decimal" placeholder="0.00" {...form.register(`items.${index}.ratePerGramRupees`)} className={`${cell} text-right`} /></td>
                        <td className="border-r border-border"><input aria-label={`Row ${index + 1} making charge`} inputMode="decimal" placeholder="0.00" {...form.register(`items.${index}.makingChargeRupees`)} className={`${cell} text-right`} /></td>
                        <td className="border-r border-border"><input aria-label={`Row ${index + 1} stone charge`} inputMode="decimal" placeholder="0.00" {...form.register(`items.${index}.stoneChargeRupees`)} className={`${cell} text-right`} /></td>
                        <td className="border-r border-border px-2 text-right text-sm font-medium tabular-nums">{line ? (line.lineTotalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}</td>
                        <td className="px-1 text-center">
                          {fields.length > 1 && (
                            <button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => remove(index)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-b border-border">
                    <td />
                    <td className="py-2 pl-1">
                      <button type="button" onClick={() => append(emptyLine())} className="rounded border border-primary px-3 py-1.5 text-sm font-semibold uppercase text-primary hover:bg-purchase-soft">
                        Add Row
                      </button>
                    </td>
                    <td colSpan={3} className="pr-3 text-right text-sm font-semibold uppercase">Total</td>
                    <td className="px-2 text-right text-sm font-semibold tabular-nums">{(totalGrossMg / 1000).toFixed(3)}</td>
                    <td />
                    <td className="px-2 text-right text-sm font-semibold tabular-nums">{(totalNetMg / 1000).toFixed(3)}</td>
                    <td colSpan={3} />
                    <td className="px-2 text-right text-sm font-semibold tabular-nums">{(totals.subtotalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            <details className="mx-5 mt-4 rounded-md border bg-card px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-primary">Receiving many pieces of the same design? Add them in one go</summary>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="grid min-w-[12rem] flex-1 gap-1.5">
                  <span className="flex items-center justify-between text-xs font-medium">
                    Item
                    <button type="button" className="text-primary hover:underline" onClick={() => setQuickIsManualProduct((p) => !p)}>
                      {quickIsManualProduct ? "Pick from list" : "+ Type new item"}
                    </button>
                  </span>
                  {quickIsManualProduct ? (
                    <Input aria-label="New item name" placeholder="e.g. Silver Chain" value={quickManualProductName} onChange={(e) => setQuickManualProductName(e.target.value)} />
                  ) : (
                    <select aria-label="Item" value={quickProductId} onChange={(e) => setQuickProductId(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
                      <option value="">Select item</option>
                      {products?.map((p) => (
                        <option key={p._id} value={p._id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {!gstCompany && (
                  <div className="grid min-w-[10rem] flex-1 gap-1.5">
                    <span className="flex items-center justify-between text-xs font-medium">
                      Box
                      <button type="button" className="text-primary hover:underline" onClick={() => setQuickIsManualBox((p) => !p)}>
                        {quickIsManualBox ? "Pick from list" : "+ Type box #"}
                      </button>
                    </span>
                    {quickIsManualBox ? (
                      <Input aria-label="Box number" placeholder="e.g. 101" value={quickManualBoxNumber} onChange={(e) => setQuickManualBoxNumber(e.target.value)} />
                    ) : (
                      <select aria-label="Box" value={quickBoxId} onChange={(e) => setQuickBoxId(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
                        <option value="">Select box</option>
                        {boxes?.map((b) => (
                          <option key={b._id} value={b._id}>Box {b.boxNumber}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <div className="grid w-24 gap-1.5">
                  <span className="text-xs font-medium">Pieces</span>
                  <Input aria-label="Number of pieces" type="number" min="1" max="50" value={quickQuantity} onChange={(e) => setQuickQuantity(e.target.value)} />
                </div>
                <Button
                  type="button"
                  disabled={
                    (quickIsManualProduct ? !quickManualProductName.trim() : !quickProductId) ||
                    (!gstCompany && (quickIsManualBox ? !quickManualBoxNumber.trim() : !quickBoxId))
                  }
                  onClick={handleQuickAdd}
                >
                  <Plus className="h-4 w-4" /> Add {quickQuantity || "1"} row{Number(quickQuantity) === 1 ? "" : "s"}
                </Button>
              </div>
            </details>

            <div className="flex flex-wrap items-start justify-between gap-6 px-5 py-6">
              <div className="flex flex-col gap-3">
                <label className="relative block w-56">
                  <span className="pointer-events-none absolute -top-2 left-2.5 bg-[#f1f2f5] px-1 text-xs text-muted-foreground dark:bg-background">Payment Type</span>
                  <select
                    aria-label="Payment type"
                    value={watchedPaymentMode ?? ""}
                    onChange={(e) => form.setValue("paymentMode", (e.target.value || undefined) as PurchaseFormValues["paymentMode"])}
                    className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none"
                  >
                    <option value="">Select</option>
                    {PAYMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label className="relative block w-56">
                  <span className="pointer-events-none absolute -top-2 left-2.5 bg-[#f1f2f5] px-1 text-xs text-muted-foreground dark:bg-background">Amount Paid (₹)</span>
                  <input aria-label="Amount paid" inputMode="decimal" placeholder="0.00" {...form.register("amountPaidRupees")} className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none" />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue("amountPaidRupees", (totals.totalPaise / 100).toFixed(2), { shouldDirty: true });
                    if (!form.getValues("paymentMode")) form.setValue("paymentMode", "cash");
                  }}
                  className="w-fit text-sm text-primary hover:underline"
                >
                  + Paid in full
                </button>
              </div>

              <div className="flex min-w-72 flex-col gap-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">GST %</span>
                  <div className="flex items-center gap-1.5">
                    {["0", "3", "5", "18"].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => form.setValue("gstPercent", val, { shouldDirty: true })}
                        className={`rounded border px-2 py-0.5 text-xs font-medium ${watchedGst === val ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground"}`}
                      >
                        {val}%
                      </button>
                    ))}
                    <input aria-label="GST percent" inputMode="decimal" {...form.register("gstPercent")} className="h-8 w-16 rounded border border-input bg-card px-2 text-right outline-none" />
                  </div>
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatPaise(totals.subtotalPaise)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span className="tabular-nums">{formatPaise(totals.taxPaise)}</span></div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-lg font-medium">Total</span>
                  <span className="min-w-48 rounded-md border border-input bg-card px-3 py-2 text-right text-lg font-semibold tabular-nums">{formatPaise(totals.totalPaise)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground"><span>Balance payable</span><span className="tabular-nums">{formatPaise(totals.balancePaise)}</span></div>
              </div>
            </div>

            {(serverError || headerErrors.length > 0 || lineErrors.length > 0) && (
              <div role="alert" className="mx-5 mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {[serverError, ...headerErrors, ...lineErrors].filter(Boolean).map((m) => (
                  <p key={m}>{m}</p>
                ))}
              </div>
            )}

            <div className="sticky bottom-0 mt-auto flex items-center justify-end gap-3 border-t bg-card px-5 py-3">
              <Button type="button" variant="outline" onClick={() => router.push("/purchases/invoices")} className="h-11 px-6">
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="h-11 bg-primary px-10 text-base text-white">
                {form.formState.isSubmitting ? "Saving…" : editPurchaseId ? "Save Changes" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}
