"use client";

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
          New Purchase Return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send items back to a supplier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Supplier</Label>
            <Select
              value={supplierId}
              onValueChange={(v) => {
                setSupplierId(v as Id<"suppliers">);
                setPurchaseId("");
                selection.clear();
              }}
            >
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

          {supplierId && (
            <div className="grid gap-2">
              <Label>Original purchase invoice</Label>
              <Select
                value={purchaseId}
                onValueChange={(v) => {
                  setPurchaseId(v as Id<"purchases">);
                  selection.clear();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      invoices?.length === 0
                        ? "No invoices found"
                        : "Select invoice"
                    }
                  />
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

          {purchaseId && (
            <div className="flex flex-col gap-2">
              <Label>Items to return</Label>
              <RecordSelectionToolbar
                selection={selection}
                disabled={submitting}
              />
              {items === undefined ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing on this invoice is still in stock to return.
                </p>
              ) : (
                items.map((item) => (
                  <label
                    key={item._id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedItemIds.has(item._id)}
                        aria-label={`Select ${item.label}`}
                        disabled={submitting}
                        onCheckedChange={() => selection.toggle(item._id)}
                      />
                      <span>
                        {item.label} · {mgToGramsDisplay(item.netWeightMg)}g
                      </span>
                    </div>
                    <span className="font-medium">
                      {formatPaise(item.lineTotalPaise)}
                    </span>
                  </label>
                ))
              )}
            </div>
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
