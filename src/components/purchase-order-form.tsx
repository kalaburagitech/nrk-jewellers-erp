"use client";
import { getUserErrorMessage } from "@/lib/user-error";

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
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Id } from "../../convex/_generated/dataModel";
import { formLabel, formRow, itemHead, itemRow, itemTable, panel, panelHead, tblInput, tdCls, thCls } from "@/lib/bill-styles";

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
type DraftState = {
  key: string;
  supplierId: Id<"suppliers"> | "";
  lines: DraftLine[];
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

export function PurchaseOrderFormDialog({
  purchaseId,
  onClose,
}: {
  purchaseId?: Id<"purchases">;
  onClose?: () => void;
}) {
  const suppliers = useQuery(api.suppliers.list);
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalRates.getCurrent);
  const purchaseData = useQuery(api.purchases.getForEdit, purchaseId ? { purchaseId } : "skip");
  const createPurchaseOrder = useMutation(api.purchases.createPurchaseOrder);
  const updatePurchaseOrder = useMutation(api.purchases.updatePurchaseOrder);

  const [open, setOpen] = useState(Boolean(purchaseId));
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftKey = purchaseId ?? "new";
  const initialDraft: DraftState = {
    key: draftKey,
    supplierId: purchaseData?.purchase.supplierId ?? "",
    lines: purchaseData ? purchaseData.items.map((item) => ({
      productId: item.productId,
      metalPurityId: item.metalPurityId ?? "",
      label: item.label,
      grossWeightGrams: mgToGramsDisplay(item.grossWeightMg),
      stoneWeightGrams: mgToGramsDisplay(item.stoneWeightMg),
      ratePerGramRupees: (item.ratePerGramPaise / 100).toFixed(2),
      makingChargeRupees: (item.makingChargePaise / 100).toFixed(2),
      stoneChargeRupees: (item.stoneChargePaise / 100).toFixed(2),
    })) : [emptyLine()],
  };
  const form = draft?.key === draftKey ? draft : initialDraft;

  function updateDraft(patch: Partial<Omit<DraftState, "key">>) {
    setDraft((previous) => ({
      ...(previous?.key === draftKey ? previous : initialDraft),
      ...patch,
      key: draftKey,
    }));
  }

  function reset() {
    setDraft({ key: draftKey, supplierId: "", lines: [emptyLine()] });
    setError(null);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    updateDraft({ lines: form.lines.map((line, i) => i === index ? { ...line, ...patch } : line) });
  }

  async function handleSubmit() {
    setError(null);
    if (!form.supplierId) {
      setError("Select a supplier");
      return;
    }
    const items = [];
    for (const line of form.lines) {
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
      if (purchaseId) {
        await updatePurchaseOrder({ purchaseId, supplierId: form.supplierId, items });
        onClose?.();
      } else {
        await createPurchaseOrder({ supplierId: form.supplierId, items, idempotencyKey: crypto.randomUUID() });
        reset();
        setOpen(false);
      }
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={purchaseId ? true : open}
      onOpenChange={(next) => {
        if (purchaseId) {
          if (!next) onClose?.();
          return;
        }
        setOpen(next);
        if (!next) reset();
      }}
    >
      {!purchaseId && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4" />
            New Purchase Order
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] w-[96vw] max-w-6xl overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{purchaseId ? "Edit purchase order" : "Create a purchase order"}</DialogTitle>
        </DialogHeader>
        {purchaseId && purchaseData === undefined ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading purchase order…</p>
        ) : <div className="flex flex-col gap-3">
          {/* Details, same panel style as New Purchase */}
          <section className={panel}>
            <h2 className={panelHead}>Details</h2>
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <div className={formRow}>
                <Label className={formLabel}>Supplier</Label>
                <Select value={form.supplierId} onValueChange={(v) => updateDraft({ supplierId: v as Id<"suppliers"> })}>
                  <SelectTrigger className="h-8 w-full text-sm">
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
            </div>
          </section>

          {/* Items: one row each, same table as New Purchase */}
          <section className={panel}>
            <div className="overflow-x-auto">
              <table className={itemTable}>
                <thead className={itemHead}>
                  <tr>
                    <th className={`${thCls} w-[4%]`}>Sl.</th>
                    <th className={`${thCls} w-[17%]`}>Item</th>
                    <th className={`${thCls} w-[17%]`}>Description</th>
                    <th className={`${thCls} w-[10%]`}>Purity</th>
                    <th className={`${thCls} w-[9%]`}>Gross Wt<br />(g)</th>
                    <th className={`${thCls} w-[8%]`}>Stone Wt<br />(g)</th>
                    <th className={`${thCls} w-[10%]`}>Rate<br />(₹/g)</th>
                    <th className={`${thCls} w-[10%]`}>Making<br />(₹)</th>
                    <th className={`${thCls} w-[10%]`}>Stone chg.<br />(₹)</th>
                    <th className={`${thCls} w-[5%]`}><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, i) => (
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
                        <Input aria-label={`Row ${i + 1} description`} placeholder="Description" value={line.label} onChange={(e) => updateLine(i, { label: e.target.value })} className={`${tblInput} w-full`} />
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
                        <Input aria-label={`Row ${i + 1} making charge`} value={line.makingChargeRupees} onChange={(e) => updateLine(i, { makingChargeRupees: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right`} />
                      </td>
                      <td className={tdCls}>
                        <Input aria-label={`Row ${i + 1} stone charge`} value={line.stoneChargeRupees} onChange={(e) => updateLine(i, { stoneChargeRupees: e.target.value })} inputMode="decimal" className={`${tblInput} w-full text-right`} />
                      </td>
                      <td className={`${tdCls} text-center`}>
                        {form.lines.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove row ${i + 1}`} onClick={() => updateDraft({ lines: form.lines.filter((_, idx) => idx !== i) })}>
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
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => updateDraft({ lines: [...form.lines, emptyLine()] })}>
                <Plus className="h-3.5 w-3.5" />
                Add Row
              </Button>
            </div>
          </section>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>}
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || Boolean(purchaseId && !purchaseData)}>
            {submitting ? "Saving…" : purchaseId ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
