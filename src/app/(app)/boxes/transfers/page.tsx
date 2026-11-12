"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ArrowRight, PackageSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

export default function BoxTransfersPage() {
  const boxes = useQuery(api.boxes.list);
  const transferItem = useMutation(api.boxes.transferItem);

  const [boxNumberInput, setBoxNumberInput] = useState("");
  const [targetBoxByItem, setTargetBoxByItem] = useState<Record<string, string>>({});
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceBox = useMemo(
    () => boxes?.find((b) => String(b.boxNumber) === boxNumberInput.trim()),
    [boxes, boxNumberInput],
  );
  const items = useQuery(api.boxes.getItems, sourceBox ? { boxId: sourceBox._id } : "skip");

  async function handleTransfer(boxItem: Doc<"boxItems">) {
    const toBoxId = targetBoxByItem[boxItem._id];
    if (!toBoxId) {
      setError("Select a destination box first.");
      return;
    }
    setError(null);
    setTransferringId(boxItem._id);
    try {
      await transferItem({ boxItemId: boxItem._id, toBoxId: toBoxId as Id<"boxes"> });
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not move this item. Check your access and try again."));
    } finally {
      setTransferringId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Box Transfers</h1>
        <p className="text-sm text-muted-foreground">Move an item from one box to another.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find source box</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="relative max-w-xs">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Enter box number"
              value={boxNumberInput}
              onChange={(e) => setBoxNumberInput(e.target.value)}
            />
          </div>
          {boxNumberInput && !sourceBox && <p className="text-sm text-muted-foreground">No box with that number.</p>}
          {sourceBox && items === undefined && <p className="text-sm text-muted-foreground">Loading…</p>}
          {sourceBox && items && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <PackageSearch className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Box {sourceBox.boxNumber} is empty.</p>
            </div>
          )}
          {sourceBox && items && items.length > 0 && (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <div
                  key={item._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{mgToGramsDisplay(item.netWeightMg)}g net</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={targetBoxByItem[item._id] ?? ""}
                      onValueChange={(v) => setTargetBoxByItem((prev) => ({ ...prev, [item._id]: v }))}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="To box…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {boxes
                          ?.filter((b) => b._id !== sourceBox._id && b.isActive)
                          .map((b) => (
                            <SelectItem key={b._id} value={b._id}>
                              Box {b.boxNumber}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={transferringId === item._id}
                      onClick={() => handleTransfer(item)}
                    >
                      <ArrowRight className="h-4 w-4" />
                      {transferringId === item._id ? "Moving…" : "Move"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
