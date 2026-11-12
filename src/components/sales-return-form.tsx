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

export function SalesReturnFormDialog({
  documentType,
  triggerLabel,
  title,
}: {
  documentType: "sales_return" | "credit_note";
  triggerLabel: string;
  title: string;
}) {
  const customers = useQuery(api.customers.list);
  const boxes = useQuery(api.boxes.list);
  const createReturn = useMutation(api.sales.createReturn);

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<Id<"customers"> | "">("");
  const [saleId, setSaleId] = useState<Id<"sales"> | "">("");
  const [returnBoxByItem, setReturnBoxByItem] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoices = useQuery(
    api.sales.listReturnableInvoices,
    customerId ? { customerId } : "skip",
  );
  const items = useQuery(
    api.sales.listReturnableItems,
    saleId ? { saleId } : "skip",
  );

  const selection = useRecordSelection(
    items?.map((item) => item._id) ?? [],
    `${saleId}`,
    true,
  );
  const selectedItemIds = new Set(selection.ids as Id<"saleItems">[]);

  function reset() {
    setCustomerId("");
    setSaleId("");
    setReturnBoxByItem({});
    selection.clear();
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!saleId || selectedItemIds.size === 0) {
      setError("Select the invoice and at least one item to return");
      return;
    }
    const boxAssignments = [...selectedItemIds].map((saleItemId) => ({
      saleItemId,
      boxId: returnBoxByItem[saleItemId] as Id<"boxes"> | undefined,
    }));
    if (boxAssignments.some((assignment) => !assignment.boxId)) {
      setError("Choose the physical box for every selected returned item.");
      return;
    }
    setSubmitting(true);
    try {
      await createReturn({
        documentType,
        originalSaleId: saleId,
        saleItemIds: [...selectedItemIds],
        boxAssignments: boxAssignments as { saleItemId: Id<"saleItems">; boxId: Id<"boxes"> }[],
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
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Customer</Label>
            <Select
              value={customerId}
              onValueChange={(v) => {
                setCustomerId(v as Id<"customers">);
                setSaleId("");
                selection.clear();
              }}
            >
              <SelectTrigger className="w-full">
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

          {customerId && (
            <div className="grid gap-2">
              <Label>Original invoice</Label>
              <Select
                value={saleId}
                onValueChange={(v) => {
                  setSaleId(v as Id<"sales">);
                  setReturnBoxByItem({});
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
                  {invoices?.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.invoiceNumber} — {formatPaise(s.totalPaise)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {saleId && (
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
                  Every item on this invoice has already been returned.
                </p>
              ) : (
                items.map((item) => (
                  <div
                    key={item._id}
                    className={`grid gap-3 rounded-xl border border-border px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_220px] ${selectedItemIds.has(item._id) ? "border-primary/40 bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={selectedItemIds.has(item._id)}
                          aria-label={`Select ${item.label}`}
                          disabled={submitting}
                          onCheckedChange={() => selection.toggle(item._id)}
                        />
                        <span>{item.label} · {mgToGramsDisplay(item.netWeightMg)}g</span>
                      </div>
                      <span className="shrink-0 font-medium">{formatPaise(item.lineTotalPaise)}</span>
                    </div>
                    {selectedItemIds.has(item._id) && (
                      <Select
                        value={returnBoxByItem[item._id] ?? ""}
                        onValueChange={(value) =>
                          setReturnBoxByItem((previous) => ({ ...previous, [item._id]: value }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Assign returned item to a box" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {boxes?.filter((box) => box.isActive).map((box) => (
                            <SelectItem key={box._id} value={box._id}>
                              Box {box.boxNumber}{box.label ? ` · ${box.label}` : ""}
                              {item.previousBoxId === box._id ? " · previous box" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
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
