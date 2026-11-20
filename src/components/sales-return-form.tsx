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
    // Defaults to the box the item was sold from.
    const boxAssignments = [...selectedItemIds].map((saleItemId) => ({
      saleItemId,
      boxId: (returnBoxByItem[saleItemId] ?? items?.find((item) => item._id === saleItemId)?.previousBoxId) as Id<"boxes"> | undefined,
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
      <DialogContent className="max-h-[90vh] w-[96vw] max-w-5xl overflow-y-auto sm:max-w-5xl">
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
                <Select
                  value={customerId}
                  onValueChange={(v) => {
                    setCustomerId(v as Id<"customers">);
                    setSaleId("");
                    selection.clear();
                  }}
                >
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
              {customerId && (
                <div className={formRow}>
                  <Label className={formLabel}>Invoice</Label>
                  <Select
                    value={saleId}
                    onValueChange={(v) => {
                      setSaleId(v as Id<"sales">);
                      setReturnBoxByItem({});
                      selection.clear();
                    }}
                  >
                    <SelectTrigger className="h-8 w-full text-sm">
                      <SelectValue placeholder={invoices?.length === 0 ? "No invoices found" : "Select invoice"} />
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
            </div>
          </section>

          {saleId && (
            <section className={panel}>
              <h2 className={panelHead}>Items to return</h2>
              <div className="p-2">
                <RecordSelectionToolbar selection={selection} disabled={submitting} />
              </div>
              {items === undefined ? (
                <p className="p-3 text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Every item on this invoice has already been returned.</p>
              ) : (
                <div className="overflow-x-auto border-t border-input">
                  <table className={itemTable}>
                    <thead className={itemHead}>
                      <tr>
                        <th className={`${thCls} w-[5%]`}><span className="sr-only">Select</span></th>
                        <th className={`${thCls} w-[30%]`}>Item</th>
                        <th className={`${thCls} w-[12%]`}>Gross Wt (g)</th>
                        <th className={`${thCls} w-[12%]`}>Net Wt (g)</th>
                        <th className={`${thCls} w-[13%]`}>Amount (₹)</th>
                        <th className={`${thCls} w-[28%]`}>Return to Box</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const picked = selectedItemIds.has(item._id);
                        return (
                          <tr key={item._id} className={`${itemRow} ${picked ? "bg-muted/40" : ""}`}>
                            <td className={`${tdCls} pt-2 text-center`}>
                              <Checkbox checked={picked} aria-label={`Select ${item.label}`} disabled={submitting} onCheckedChange={() => selection.toggle(item._id)} />
                            </td>
                            <td className={`${tdCls} pt-2`}>{item.label}</td>
                            <td className={`${tdCls} pt-2 text-right font-mono tabular-nums`}>{mgToGramsDisplay(item.grossWeightMg)}</td>
                            <td className={`${tdCls} pt-2 text-right font-mono tabular-nums`}>{mgToGramsDisplay(item.netWeightMg)}</td>
                            <td className={`${tdCls} pt-2 text-right font-mono font-semibold tabular-nums`}>{formatPaise(item.lineTotalPaise)}</td>
                            <td className={tdCls}>
                              {picked ? (
                                <Select
                                  value={returnBoxByItem[item._id] ?? item.previousBoxId ?? ""}
                                  onValueChange={(value) => setReturnBoxByItem((previous) => ({ ...previous, [item._id]: value }))}
                                >
                                  <SelectTrigger aria-label={`Return ${item.label} to box`} className="h-8 w-full min-w-0 text-xs">
                                    <SelectValue placeholder="Assign to a box" />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-64">
                                    {boxes?.filter((box) => box.isActive && (!item.metal || !box.metal || box.metal === item.metal)).map((box) => (
                                      <SelectItem key={box._id} value={box._id}>
                                        Box {box.boxNumber}{box.label ? ` · ${box.label}` : ""}
                                        {item.previousBoxId === box._id ? " · previous box" : ""}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="block pt-1.5 text-center text-xs text-muted-foreground">—</span>
                              )}
                            </td>
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
