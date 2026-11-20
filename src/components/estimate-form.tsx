"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { formLabel, formRow, itemHead, itemRow, itemTable, panel, panelHead, tblInput, tdCls, thCls } from "@/lib/bill-styles";
import type { Id } from "../../convex/_generated/dataModel";

type DraftLine = {
  productId: Id<"products"> | "";
  metalPurityId: Id<"metalPurities"> | "";
  grossWeightGrams: string;
  stoneWeightGrams: string;
  ratePerGramRupees: string;
  wastagePercent: string;
  makingChargeRupees: string;
  stoneChargeRupees: string;
  taxConfigurationId: Id<"taxConfigurations"> | "";
};

function emptyLine(): DraftLine {
  return {
    productId: "",
    metalPurityId: "",
    grossWeightGrams: "",
    stoneWeightGrams: "0",
    ratePerGramRupees: "",
    wastagePercent: "0",
    makingChargeRupees: "0",
    stoneChargeRupees: "0",
    taxConfigurationId: "",
  };
}

export function EstimateFormDialog({
  documentType,
  triggerLabel,
  title,
}: {
  documentType: "quotation" | "proforma_invoice" | "sales_order" | "delivery_challan";
  triggerLabel: string;
  title: string;
}) {
  const customers = useQuery(api.customers.list);
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalRates.getCurrent);
  const taxConfigs = useQuery(api.taxConfigurations.list);
  const createEstimate = useMutation(api.sales.createEstimate);

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<Id<"customers"> | "">("");
  const [isGst, setIsGst] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCustomerId("");
    setIsGst(false);
    setLines([emptyLine()]);
    setError(null);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleSubmit() {
    setError(null);
    if (!customerId) {
      setError("Select a customer");
      return;
    }
    const items = [];
    for (const line of lines) {
      if (!line.productId) {
        setError("Select a product for every line");
        return;
      }
      const ratePerGramPaise = Math.round(Number(line.ratePerGramRupees) * 100);
      if (!ratePerGramPaise || ratePerGramPaise <= 0) {
        setError("Rate per gram must be greater than zero on every line");
        return;
      }
      items.push({
        productId: line.productId,
        metalPurityId: line.metalPurityId || undefined,
        grossWeightMg: gramsToMg(line.grossWeightGrams),
        stoneWeightMg: gramsToMg(line.stoneWeightGrams || "0"),
        ratePerGramPaise,
        wastageBasisPoints: Math.round(Number(line.wastagePercent || "0") * 100),
        makingChargePaise: Math.round(Number(line.makingChargeRupees || "0") * 100),
        stoneChargePaise: Math.round(Number(line.stoneChargeRupees || "0") * 100),
        taxConfigurationId: line.taxConfigurationId || undefined,
      });
    }

    setSubmitting(true);
    try {
      await createEstimate({
        documentType,
        customerId,
        isGst,
        items,
        discountMode: "none",
        discountValue: 0,
        idempotencyKey: crypto.randomUUID(),
      });
      reset();
      setOpen(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save."));
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
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[96vw] max-w-6xl overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Details, same panel style as New Bill */}
          <section className={panel}>
            <h2 className={panelHead}>Details</h2>
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <div className={formRow}>
                <Label className={formLabel}>Customer</Label>
                <Select value={customerId} onValueChange={(v) => setCustomerId(v as Id<"customers">)}>
                  <SelectTrigger className="h-8 w-full text-sm">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers?.map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isGst} onCheckedChange={setIsGst} id="estimate-gst" />
                <Label htmlFor="estimate-gst" className="text-sm">GST bill</Label>
              </div>
            </div>
          </section>

          {/* Items: one row each, same table as New Bill */}
          <section className={panel}>
            <div className="overflow-x-auto">
              <table className={itemTable}>
                <thead className={itemHead}>
                  <tr>
                    <th className={`${thCls} w-[4%]`}>Sl.</th>
                    <th className={`${thCls} w-[20%]`}>Item</th>
                    <th className={`${thCls} w-[10%]`}>Purity</th>
                    <th className={`${thCls} w-[9%]`}>Gross Wt<br />(g)</th>
                    <th className={`${thCls} w-[8%]`}>Stone Wt<br />(g)</th>
                    <th className={`${thCls} w-[9%]`}>Rate<br />(₹/g)</th>
                    <th className={`${thCls} w-[7%]`}>Wastage<br />%</th>
                    <th className={`${thCls} w-[9%]`}>Making<br />(₹)</th>
                    <th className={`${thCls} w-[9%]`}>Stone chg.<br />(₹)</th>
                    {isGst && <th className={`${thCls} w-[12%]`}>GST</th>}
                    <th className={`${thCls} w-[4%]`}><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className={itemRow}>
                      <td className={`${tdCls} pt-2.5 text-center font-semibold`}>{i + 1}</td>
                      <td className={tdCls}>
                        <Select value={line.productId} onValueChange={(v) => updateLine(i, { productId: v as Id<"products"> })}>
                          <SelectTrigger aria-label={`Row ${i + 1} item`} className="h-8 w-full min-w-0 text-sm">
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {products?.map((p) => (
                              <SelectItem key={p._id} value={p._id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={tdCls}>
                        <Select value={line.metalPurityId} onValueChange={(v) => updateLine(i, { metalPurityId: v as Id<"metalPurities"> })}>
                          <SelectTrigger aria-label={`Row ${i + 1} purity`} className="h-8 w-full min-w-0 text-sm">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {purities?.map(({ purity }) => (
                              <SelectItem key={purity._id} value={purity._id}>
                                {purity.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} gross weight`} placeholder="0.000" value={line.grossWeightGrams} onChange={(e) => updateLine(i, { grossWeightGrams: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right font-mono`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} stone weight`} value={line.stoneWeightGrams} onChange={(e) => updateLine(i, { stoneWeightGrams: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right font-mono`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} rate per gram`} placeholder="0.00" value={line.ratePerGramRupees} onChange={(e) => updateLine(i, { ratePerGramRupees: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right font-mono`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} wastage percent`} value={line.wastagePercent} onChange={(e) => updateLine(i, { wastagePercent: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} making charge`} value={line.makingChargeRupees} onChange={(e) => updateLine(i, { makingChargeRupees: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} stone charge`} value={line.stoneChargeRupees} onChange={(e) => updateLine(i, { stoneChargeRupees: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right`} />
                      </td>
                      {isGst && (
                        <td className={tdCls}>
                          <Select value={line.taxConfigurationId} onValueChange={(v) => updateLine(i, { taxConfigurationId: v as Id<"taxConfigurations"> })}>
                            <SelectTrigger aria-label={`Row ${i + 1} GST`} className="h-8 w-full min-w-0 text-xs">
                              <SelectValue placeholder="Select tax" />
                            </SelectTrigger>
                            <SelectContent>
                              {taxConfigs?.map((t) => (
                                <SelectItem key={t._id} value={t._id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      )}
                      <td className={`${tdCls} text-center`}>
                        {lines.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove row ${i + 1}`} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-input bg-muted/30 px-3 py-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                <Plus className="h-3.5 w-3.5" />
                Add Row
              </Button>
            </div>
          </section>

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
