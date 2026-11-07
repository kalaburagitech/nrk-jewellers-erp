"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
export function DeleteDocumentButton({
  table,
  id,
  name,
  compact = false,
}: {
  table: "sales" | "purchases";
  id: string;
  name: string;
  compact?: boolean;
}) {
  const access = useQuery(api.organizations.getMyAccess);
  const sales = useMutation(api.sales.cancel);
  const purchases = useMutation(api.purchases.cancel);
  const [busy, setBusy] = useState(false);
  if (!["owner", "admin"].includes(access?.membership?.role ?? "")) return null;
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      className="text-destructive"
      disabled={busy}
      aria-label={`Delete ${name}`}
      title={`Soft delete ${name}`}
      onClick={async (e) => {
        e.stopPropagation();
        const reason = window.prompt(
          `Soft delete ${name} and reverse its stock and balance effects? Enter a reason:`,
        );
        if (!reason?.trim()) return;
        setBusy(true);
        try {
          if (table === "sales")
            await sales({ saleId: id as Id<"sales">, reason });
          else await purchases({ purchaseId: id as Id<"purchases">, reason });
        } catch (e) {
          window.alert(e instanceof Error ? e.message : "Unable to delete");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
      {!compact && "Delete"}
    </Button>
  );
}
