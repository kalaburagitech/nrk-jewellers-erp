"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { RecordSelectionToolbar } from "@/components/record-selection-toolbar";
import { useRecordSelection } from "@/hooks/use-record-selection";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Id } from "../../convex/_generated/dataModel";
import { formLabel, formRow, itemHead, itemRow, itemTable, panel, panelHead, tdCls, thCls } from "@/lib/bill-styles";

export function PurchaseReturnFormDialog() {
  const suppliers = useQuery(api.suppliers.list);
  const createPurchaseReturn = useMutation(api.purchases.createPurchaseReturn);

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState<Id<"suppliers"> | "">("");
  const [purchaseId, setPurchaseId] = useState<Id<"purchases"> | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoices = useQuery(
    api.purchases.listReturnableInvoices,
    supplierId ? { supplierId } : "skip",
  );
  const items = useQuery(
    api.purchases.listReturnableItems,
    purchaseId ? { purchaseId } : "skip",
  );

  const selection = useRecordSelection(
    items?.map((item) => item._id) ?? [],
    `${purchaseId}`,
    true,
  );
  const selectedItemIds = new Set(selection.ids as Id<"purchaseItems">[]);

  function reset() {
    setSupplierId("");
    setPurchaseId("");
    selection.clear();
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!purchaseId || selectedItemIds.size === 0) {
      setError("Select the purchase and at least one item to return");
      return;
    }
    setSubmitting(true);
    try {
      await createPurchaseReturn({
        originalPurchaseId: purchaseId,
        purchaseItemIds: [...selectedItemIds],
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
          New Purchase Return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[96vw] max-w-4xl overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Send items back to a supplier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Details, same panel style as New Purchase */}
          <section className={panel}>
            <h2 className={panelHead}>Details</h2>
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <div className={formRow}>
                <Label className={formLabel}>Supplier</Label>
                <Select
                  value={supplierId}
                  onValueChange={(v) => {
                    setSupplierId(v as Id<"suppliers">);
                    setPurchaseId("");
                    selection.clear();
                  }}
                >
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
              {supplierId && (
                <div className={formRow}>
                  <Label className={formLabel}>Invoice</Label>
                  <Select
                    value={purchaseId}
                    onValueChange={(v) => {
                      setPurchaseId(v as Id<"purchases">);
                      selection.clear();
                    }}
                  >
                    <SelectTrigger className="h-8 w-full text-sm">
                      <SelectValue placeholder={invoices?.length === 0 ? "No invoices found" : "Select invoice"} />
                    </SelectTrigger>
                    <SelectContent>
                      {invoices?.map((p) => (
                        <SelectItem key={p._id} value={p._id}>
                          {p.invoiceNumber} — {formatPaise(p.totalPaise)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </section>

          {purchaseId && (
            <section className={panel}>
              <h2 className={panelHead}>Items to return</h2>
              <div className="p-2">
                <RecordSelectionToolbar selection={selection} disabled={submitting} />
              </div>
              {items === undefined ? (
                <p className="p-3 text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Nothing on this invoice is still in stock to return.</p>
              ) : (
                <div className="overflow-x-auto border-t border-input">
                  <table className={itemTable}>
                    <thead className={itemHead}>
                      <tr>
                        <th className={`${thCls} w-[6%]`}><span className="sr-only">Select</span></th>
                        <th className={`${thCls} w-[54%]`}>Item</th>
                        <th className={`${thCls} w-[18%]`}>Net Wt (g)</th>
                        <th className={`${thCls} w-[22%]`}>Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const picked = selectedItemIds.has(item._id);
                        return (
                          <tr key={item._id} className={`${itemRow} cursor-pointer ${picked ? "bg-muted/40" : ""}`} onClick={() => !submitting && selection.toggle(item._id)}>
                            <td className={`${tdCls} pt-2 text-center`} onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={picked} aria-label={`Select ${item.label}`} disabled={submitting} onCheckedChange={() => selection.toggle(item._id)} />
                            </td>
                            <td className={`${tdCls} py-2`}>{item.label}</td>
                            <td className={`${tdCls} py-2 text-right font-mono tabular-nums`}>{mgToGramsDisplay(item.netWeightMg)}</td>
                            <td className={`${tdCls} py-2 text-right font-mono font-semibold tabular-nums`}>{formatPaise(item.lineTotalPaise)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={submitting || selection.count === 0}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
