"use client";

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
  const createReturn = useMutation(api.sales.createReturn);

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<Id<"customers"> | "">("");
  const [saleId, setSaleId] = useState<Id<"sales"> | "">("");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<Id<"saleItems">>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoices = useQuery(api.sales.listReturnableInvoices, customerId ? { customerId } : "skip");
  const items = useQuery(api.sales.listReturnableItems, saleId ? { saleId } : "skip");

  function reset() {
    setCustomerId("");
    setSaleId("");
    setSelectedItemIds(new Set());
    setError(null);
  }

  function toggleItem(id: Id<"saleItems">) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    if (!saleId || selectedItemIds.size === 0) {
      setError("Select the invoice and at least one item to return");
      return;
    }
    setSubmitting(true);
    try {
      await createReturn({
        documentType,
        originalSaleId: saleId,
        saleItemIds: [...selectedItemIds],
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
                setSelectedItemIds(new Set());
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
                  setSelectedItemIds(new Set());
                }}
              >
                <SelectTrigger className="w-full">
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

          {saleId && (
            <div className="flex flex-col gap-2">
              <Label>Items to return</Label>
              {items === undefined ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every item on this invoice has already been returned.</p>
              ) : (
                items.map((item) => (
                  <label
                    key={item._id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox checked={selectedItemIds.has(item._id)} onCheckedChange={() => toggleItem(item._id)} />
                      <span>
                        {item.label} · {mgToGramsDisplay(item.netWeightMg)}g
                      </span>
                    </div>
                    <span className="font-medium">{formatPaise(item.lineTotalPaise)}</span>
                  </label>
                ))
              )}
            </div>
          )}

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
