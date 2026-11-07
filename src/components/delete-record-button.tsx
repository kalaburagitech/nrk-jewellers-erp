"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
export function DeleteRecordButton({
  table,
  id,
  name,
}: {
  table: string;
  id: string;
  name: string;
}) {
  const access = useQuery(api.organizations.getMyAccess);
  const remove = useMutation(api.dataManagement.remove);
  const [busy, setBusy] = useState(false);
  if (!["owner", "admin"].includes(access?.membership?.role ?? "")) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={busy}
      aria-label={`Delete ${name}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (
          !window.confirm(
            `Delete ${name}? Records used by transactions cannot be deleted.`,
          )
        )
          return;
        setBusy(true);
        try {
          await remove({ table, id });
        } catch (e) {
          window.alert(e instanceof Error ? e.message : "Unable to delete");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
      Delete
    </Button>
  );
}
