"use client";
import { getUserErrorMessage } from "@/lib/user-error";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RecordSelection } from "@/hooks/use-record-selection";
import { RecordSelectionToolbar } from "@/components/record-selection-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RotateCcw, Trash2 } from "lucide-react";
export function BulkRecordActions({
  selection,
  table,
  restore = false,
}: {
  selection: RecordSelection;
  table: string;
  restore?: boolean;
}) {
  const access = useQuery(api.organizations.getMyAccess);
  const remove = useMutation(api.dataManagement.remove);
  const recover = useMutation(api.dataManagement.restoreRecord);
  const cancelGirvi = useMutation(api.girvi.cancel);
  const deleteExpense = useMutation(api.expenses.remove);
  const cancelSale = useMutation(api.sales.cancel);
  const cancelPurchase = useMutation(api.purchases.cancel);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Delete asks once, on the page: Yes / No, with an optional reason (no browser pop-ups).
  const [confirming, setConfirming] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const allowed = ["owner", "admin"].includes(access?.membership?.role ?? "");
  async function run() {
    const ids = [...selection.ids];
    if (!ids.length) return;
    const reason = restore ? undefined : reasonText.trim() || "Deleted from list";
    setConfirming(false);
    setReasonText("");
    setBusy(true);
    setMessage("");
    const failed: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      try {
        if (restore) await recover({ table, id });
        else if (table === "sales")
          await cancelSale({
            saleId: id as Id<"sales">,
            reason: reason!.trim(),
          });
        else if (table === "purchases")
          await cancelPurchase({
            purchaseId: id as Id<"purchases">,
            reason: reason!.trim(),
          });
        else if (table === "girviLoans")
          await cancelGirvi({
            id: id as Id<"girviLoans">,
            reason: reason!.trim(),
          });
        else if (table === "expenses")
          await deleteExpense({
            id: id as Id<"expenses">,
            reason: reason!.trim(),
          });
        else await remove({ table, id });
      } catch (error) {
        failed.push(id);
        const msg = getUserErrorMessage(error, "Operation failed");
        if (!errors.includes(msg)) errors.push(msg);
      }
    }
    selection.replace(failed);
    setBusy(false);
    setMessage(
      `${ids.length - failed.length} ${restore ? "restored" : "soft deleted"}.${failed.length ? ` ${failed.length} could not be changed. ${errors.slice(0, 2).join(" ")}` : ""}`,
    );
  }
  return (
    <div className="space-y-2">
      <RecordSelectionToolbar selection={selection} disabled={busy}>
        {allowed && (
          <Button
            size="sm"
            variant={restore ? "outline" : "destructive"}
            disabled={busy || selection.count === 0}
            onClick={() => setConfirming(true)}
          >
            {restore ? <RotateCcw /> : <Trash2 />}
            {busy ? "Working…" : `${restore ? "Restore" : "Delete"} selected`}
          </Button>
        )}
      </RecordSelectionToolbar>
      {confirming && selection.count > 0 && (
        <div role="alertdialog" aria-label="Confirm" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">
            {restore ? `Restore ${selection.count} selected?` : `Delete ${selection.count} selected? Records linked to other entries are kept.`}
          </span>
          {!restore && (
            <Input
              aria-label="Reason (optional)"
              placeholder="Reason (optional)"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              className="h-8 w-56 text-xs"
            />
          )}
          <Button size="sm" variant={restore ? "default" : "destructive"} disabled={busy} onClick={() => void run()}>
            Yes, {restore ? "restore" : "delete"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
            No
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="rounded-lg border bg-card p-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
