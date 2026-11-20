"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Pause, Receipt, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";
import { getUserErrorMessage } from "@/lib/user-error";

export type HeldKind = "sale" | "purchase";

/** Where a held bill of each kind is reopened. */
export const heldBillHref = (kind: HeldKind, id: string) =>
  `${kind === "purchase" ? "/purchases/new" : "/sales/new"}?held=${id}`;

/** One labelled field of a bill item card (New Bill and New Purchase). */
export function LineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Inline "Delete? Yes / No" so a held bill is never removed by one stray click. */
export function HeldDeleteConfirm({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold">
      <span className="text-destructive">Delete?</span>
      <button type="button" className="rounded bg-destructive px-1.5 text-white hover:bg-destructive/90" onClick={onYes}>Yes</button>
      <button type="button" className="rounded border px-1.5 text-muted-foreground hover:text-foreground" onClick={onNo}>No</button>
    </span>
  );
}

/**
 * The yellow tabs of held bills beside the bill on screen. Clicking one opens
 * it; its × (then Yes) deletes it. The bill on screen is left out of the list.
 */
export function HeldBillTabs({
  kind,
  currentId,
  disabled,
  onOpen,
  onDeleted,
  onError,
}: {
  kind: HeldKind;
  currentId: string | null;
  disabled?: boolean;
  onOpen: (id: Id<"heldBills">) => void;
  onDeleted: (name: string) => void;
  onError: (message: string) => void;
}) {
  const heldBills = useQuery(api.heldBills.list, { kind });
  const removeHeld = useMutation(api.heldBills.remove);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function remove(id: Id<"heldBills">, name: string) {
    setConfirmId(null);
    try {
      await removeHeld({ heldBillId: id });
      onDeleted(name);
    } catch (e) {
      onError(getUserErrorMessage(e, "Could not delete the held bill."));
    }
  }

  return (
    <>
      {heldBills?.filter((h) => h._id !== currentId).map((h) => (
        <div
          key={h._id}
          className="flex items-center gap-1.5 rounded-t-lg border-t border-l border-r border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => onOpen(h._id)}
            title={`On hold since ${new Date(h.updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} - click to open and finish this bill`}
            className="flex items-center gap-1.5 hover:underline"
          >
            <Pause className="h-3 w-3" />
            <span className="max-w-32 truncate">{h.customerName}</span>
            <span className="font-mono tabular-nums">{formatPaise(h.totalPaise)}</span>
          </button>
          {confirmId === h._id ? (
            <HeldDeleteConfirm onYes={() => void remove(h._id, h.customerName)} onNo={() => setConfirmId(null)} />
          ) : (
            <button
              type="button"
              className="ml-0.5 text-amber-700/70 hover:text-destructive"
              onClick={() => setConfirmId(h._id)}
              title="Delete this held bill"
              aria-label={`Delete held bill for ${h.customerName}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/** Invoice list section: held bills waiting to be finished, with Open and Delete. */
export function HeldBillsCard({ kind }: { kind: HeldKind }) {
  const heldBills = useQuery(api.heldBills.list, { kind });
  const members = useQuery(api.memberships.listMembers);
  const removeHeld = useMutation(api.heldBills.remove);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!heldBills || heldBills.length === 0) return null;
  const memberName = new Map(members?.map((m) => [m.userId as string, m.name]) ?? []);
  const party = kind === "purchase" ? "Supplier" : "Customer";
  return (
    <Card className="border-amber-300 bg-amber-50/40 shadow-xs dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-5 py-3 dark:border-amber-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
          <Pause className="h-4 w-4" /> On hold - waiting to be {kind === "purchase" ? "saved" : "billed"} ({heldBills.length})
        </h3>
        <span className="text-xs text-muted-foreground">
          No {kind === "purchase" ? "purchase number" : "invoice number"}, stock or payment is booked until you open it and save it.
        </span>
      </div>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{party}</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Held at</TableHead>
              <TableHead>Held by</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {heldBills.map((h) => (
              <TableRow key={h._id}>
                <TableCell className="font-medium">{h.customerName}</TableCell>
                <TableCell className="text-right tabular-nums">{h.itemCount}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatPaise(h.totalPaise)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(h.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{memberName.get(h.createdByUserId) ?? "-"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button asChild size="sm" className="h-8 bg-[#1a73e8] text-white hover:bg-[#1557b0]">
                      <Link href={heldBillHref(kind, h._id)}>
                        <Receipt className="h-3.5 w-3.5" /> {kind === "purchase" ? "Open & save purchase" : "Open & generate bill"}
                      </Link>
                    </Button>
                    {confirmId === h._id ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="font-semibold text-destructive">Delete this bill?</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-8"
                          onClick={async () => {
                            setError(null);
                            setConfirmId(null);
                            try {
                              await removeHeld({ heldBillId: h._id });
                            } catch (e) {
                              setError(getUserErrorMessage(e, "Could not delete the held bill."));
                            }
                          }}
                        >
                          Yes, delete
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setConfirmId(null)}>
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        aria-label={`Delete held bill for ${h.customerName}`}
                        title="Delete this held bill"
                        onClick={() => setConfirmId(h._id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error && <p className="px-5 py-2 text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
