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
    boxId: "",
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
  const purities = useQuery(api.metalPurities.list);
  const createPurchase = useMutation(api.purchases.create);
  const updatePurchase = useMutation(api.purchases.update);

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [serverError, setServerError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      supplierId: "",
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
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedGst = useWatch({ control: form.control, name: "gstPercent" });
  const watchedPaid = useWatch({ control: form.control, name: "amountPaidRupees" });

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
    const amountPaidPaise = rupeesToPaise(values.amountPaidRupees || "0") ?? 0;
    const items = values.items.map((item) => ({
      productId: item.productId as Id<"products">,
      boxId: item.boxId as Id<"boxes">,
      label: item.label,
      metalPurityId: item.metalPurityId ? (item.metalPurityId as Id<"metalPurities">) : undefined,
      grossWeightMg: gramsToMg(item.grossWeightGrams),
      stoneWeightMg: gramsToMg(item.stoneWeightGrams || "0"),
      ratePerGramPaise: rupeesToPaise(item.ratePerGramRupees) ?? 0,
      makingChargePaise: rupeesToPaise(item.makingChargeRupees || "0") ?? 0,
      stoneChargePaise: rupeesToPaise(item.stoneChargeRupees || "0") ?? 0,
    }));
    try {
      if (editPurchaseId) {
        await updatePurchase({
          purchaseId: editPurchaseId,
          supplierId: values.supplierId as Id<"suppliers">,
          taxPaise: totals.taxPaise,
          amountPaidPaise,
          paymentMode: amountPaidPaise > 0 ? values.paymentMode : undefined,
          billDate: dateInputToTimestamp(values.billDate),
          items,
        });
        router.push(`/purchases/invoices?updated=${editPurchaseId}`);
      } else {
        const result = await createPurchase({
          supplierId: values.supplierId as Id<"suppliers">,
          taxPaise: totals.taxPaise,
          amountPaidPaise,
          paymentMode: amountPaidPaise > 0 ? values.paymentMode : undefined,
          billDate: dateInputToTimestamp(values.billDate),
          idempotencyKey,
          items,
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
    (editPurchaseId ? !prefilled : false);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{editPurchaseId ? "Edit Purchase" : "New Purchase"}</h1>
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
              <CardHeader>
                <CardTitle className="text-base">Supplier</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <FormField
                    control={form.control}
                    name="supplierId"
                    render={({ field }) => (
                      <FormItem className="max-w-sm flex-1">
                        <FormLabel>Supplier</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select supplier" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {suppliers?.map((s) => (
                              <SelectItem key={s._id} value={s._id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4">
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
                        <FormField
                          control={form.control}
                          name={`items.${index}.productId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Product</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
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
                        <FormField
                          control={form.control}
                          name={`items.${index}.boxId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Destination box</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select box" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="max-h-64">
                                  {boxes?.map((b) => (
                                    <SelectItem key={b._id} value={b._id}>
                                      Box {b.boxNumber}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
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
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
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
                              <FormLabel>Stone wt (g)</FormLabel>
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
              <Button type="button" variant="outline" onClick={() => append(emptyLine())} className="self-start">
                <Plus className="h-4 w-4" />
                Add Item
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatPaise(totals.totalPaise)}</span>
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
