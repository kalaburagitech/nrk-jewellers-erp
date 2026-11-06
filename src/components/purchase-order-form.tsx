"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gramsToMg } from "@/lib/jewelry-calc";
import type { Id } from "../../convex/_generated/dataModel";

type DraftLine = {
  productId: Id<"products"> | "";
  metalPurityId: Id<"metalPurities"> | "";
  label: string;
  grossWeightGrams: string;
  stoneWeightGrams: string;
  ratePerGramRupees: string;
  makingChargeRupees: string;
  stoneChargeRupees: string;
};

function emptyLine(): DraftLine {
  return {
    productId: "",
    metalPurityId: "",
    label: "",
    grossWeightGrams: "",
    stoneWeightGrams: "0",
    ratePerGramRupees: "",
    makingChargeRupees: "0",
    stoneChargeRupees: "0",
  };
}

export function PurchaseOrderFormDialog() {
  const suppliers = useQuery(api.suppliers.list);
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalRates.getCurrent);
  const createPurchaseOrder = useMutation(api.purchases.createPurchaseOrder);

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState<Id<"suppliers"> | "">("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSupplierId("");
    setLines([emptyLine()]);
    setError(null);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleSubmit() {
    setError(null);
    if (!supplierId) {
      setError("Select a supplier");
      return;
    }
    const items = [];
    for (const line of lines) {
      if (!line.productId || !line.label.trim()) {
        setError("Select a product and enter a description for every line");
        return;
      }
      const ratePerGramPaise = Math.round(Number(line.ratePerGramRupees) * 100);
      if (!ratePerGramPaise || ratePerGramPaise <= 0) {
        setError("Rate per gram must be greater than zero on every line");
        return;
      }
      items.push({
        productId: line.productId,
        label: line.label.trim(),
        metalPurityId: line.metalPurityId || undefined,
        grossWeightMg: gramsToMg(line.grossWeightGrams),
        stoneWeightMg: gramsToMg(line.stoneWeightGrams || "0"),
        ratePerGramPaise,
        makingChargePaise: Math.round(Number(line.makingChargeRupees || "0") * 100),
        stoneChargePaise: Math.round(Number(line.stoneChargeRupees || "0") * 100),
      });
    }

    setSubmitting(true);
    try {
      await createPurchaseOrder({ supplierId, items, idempotencyKey: crypto.randomUUID() });
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Purchase Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a purchase order</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={(v) => setSupplierId(v as Id<"suppliers">)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers?.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 rounded-md border border-border p-3">
                <div className="col-span-6 grid gap-1">
                  <Label className="text-xs">Product</Label>
                  <Select
                    value={line.productId}
                    onValueChange={(v) => updateLine(i, { productId: v as Id<"products"> })}
                  >
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
                </div>
                <div className="col-span-6 grid gap-1">
                  <Label className="text-xs">Description</Label>
                  <Input value={line.label} onChange={(e) => updateLine(i, { label: e.target.value })} />
                </div>
                <div className="col-span-4 grid gap-1">
                  <Label className="text-xs">Metal purity</Label>
                  <Select
                    value={line.metalPurityId}
                    onValueChange={(v) => updateLine(i, { metalPurityId: v as Id<"metalPurities"> })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {purities?.map(({ purity }) => (
                        <SelectItem key={purity._id} value={purity._id}>
                          {purity.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4 grid gap-1">
                  <Label className="text-xs">Gross wt (g)</Label>
                  <Input
                    value={line.grossWeightGrams}
                    onChange={(e) => updateLine(i, { grossWeightGrams: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="col-span-4 grid gap-1">
                  <Label className="text-xs">Stone wt (g)</Label>
                  <Input
                    value={line.stoneWeightGrams}
                    onChange={(e) => updateLine(i, { stoneWeightGrams: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="col-span-4 grid gap-1">
                  <Label className="text-xs">Rate/g (₹)</Label>
                  <Input
                    value={line.ratePerGramRupees}
                    onChange={(e) => updateLine(i, { ratePerGramRupees: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="col-span-4 grid gap-1">
                  <Label className="text-xs">Making (₹)</Label>
                  <Input
                    value={line.makingChargeRupees}
                    onChange={(e) => updateLine(i, { makingChargeRupees: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="col-span-4 grid gap-1">
                  <Label className="text-xs">Stone charge (₹)</Label>
                  <Input
                    value={line.stoneChargeRupees}
                    onChange={(e) => updateLine(i, { stoneChargeRupees: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="col-span-12 flex justify-end">
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="self-start" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              <Plus className="h-4 w-4" />
              Add line
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
