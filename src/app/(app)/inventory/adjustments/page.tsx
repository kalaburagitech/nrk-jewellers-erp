"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { AlertTriangle, Boxes, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Doc } from "../../../../../convex/_generated/dataModel";

function AdjustDialog({ item, onClose }: { item: Doc<"boxItems">; onClose: () => void }) {
  const correctWeight = useMutation(api.stockAdjustments.correctWeight);
  const writeOff = useMutation(api.stockAdjustments.writeOff);

  const [newWeightGrams, setNewWeightGrams] = useState((item.netWeightMg / 1000).toFixed(3));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCorrect() {
    setError(null);
    const newNetWeightMg = Math.round(Number(newWeightGrams) * 1000);
    if (!Number.isFinite(newNetWeightMg) || newNetWeightMg < 0) {
      setError("Enter a valid weight.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await correctWeight({ boxItemId: item._id, newNetWeightMg, reason });
      onClose();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWriteOff() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await writeOff({ boxItemId: item._id, reason });
      onClose();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust &quot;{item.label}&quot;</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Corrected net weight (g)</Label>
            <Input
              inputMode="decimal"
              value={newWeightGrams}
              onChange={(e) => setNewWeightGrams(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Current: {mgToGramsDisplay(item.netWeightMg)}g</p>
          </div>
          <div className="grid gap-2">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. physical audit discrepancy" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="destructive" onClick={handleWriteOff} disabled={submitting}>
            <AlertTriangle className="h-4 w-4" />
            Write Off (lost/damaged)
          </Button>
          <Button onClick={handleCorrect} disabled={submitting}>
            {submitting ? "Saving…" : "Save Weight Correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StockAdjustmentsPage() {
  const boxes = useQuery(api.boxes.list);
  const overview = useQuery(api.boxes.getInventoryOverview);
  const adjustBox = useMutation(api.stockAdjustments.adjustBox);
  const recent = useQuery(api.stockAdjustments.listRecent);
  const [boxNumberInput, setBoxNumberInput] = useState("");
  const [addWeight, setAddWeight] = useState("");
  const [deductWeight, setDeductWeight] = useState("");
  const [addPieces, setAddPieces] = useState("");
  const [deductPieces, setDeductPieces] = useState("");
  const [boxReason, setBoxReason] = useState("");
  const [boxError, setBoxError] = useState("");
  const [savingBox, setSavingBox] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Doc<"boxItems"> | null>(null);

  const sourceBox = useMemo(() => boxes?.find((b) => String(b._id) === boxNumberInput), [boxes, boxNumberInput]);
  const items = useQuery(api.boxes.getItems, sourceBox ? { boxId: sourceBox._id } : "skip");

  async function submitBoxAdjustment() {
    setBoxError("");
    if (!sourceBox) { setBoxError("Choose a box first."); return; }
    if (!boxReason.trim()) { setBoxError("A reason is required for the stock history."); return; }
    setSavingBox(true);
    try {
      await adjustBox({ boxId: sourceBox._id, addWeightMg: Math.round(Number(addWeight || 0) * 1000), deductWeightMg: Math.round(Number(deductWeight || 0) * 1000), addPieces: Number(addPieces || 0), deductPieces: Number(deductPieces || 0), reason: boxReason });
      setAddWeight(""); setDeductWeight(""); setAddPieces(""); setDeductPieces(""); setBoxReason("");
    } catch (error) { setBoxError(getUserErrorMessage(error, "Could not adjust stock.")); }
    finally { setSavingBox(false); }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stock Adjustments</h1>
        <p className="text-sm text-muted-foreground">
          Correct a weight after a physical audit, or write off a lost/damaged item — both are logged with a reason.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Inventory overview</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs uppercase text-muted-foreground">Total boxes</p><p className="text-2xl font-semibold">{overview?.totalBoxes ?? "—"}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Total weight</p><p className="text-2xl font-semibold">{overview ? mgToGramsDisplay(overview.totalWeightMg) : "—"} g</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Total quantity</p><p className="text-2xl font-semibold">{overview?.totalQuantity ?? "—"}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Adjust stock for a box</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2"><Label>Box</Label><select className="h-10 rounded-md border bg-background px-3 text-sm" value={boxNumberInput} onChange={e => setBoxNumberInput(e.target.value)}><option value="">Choose a box</option>{boxes?.map(box => <option key={box._id} value={box._id}>Box {box.boxNumber}{box.label ? ` — ${box.label}` : ""}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label>Add weight (grams)</Label><Input type="number" min="0" step="0.001" value={addWeight} onChange={e => setAddWeight(e.target.value)} placeholder="e.g. 50" /></div>
            <div className="grid gap-2"><Label>Deduct weight (grams)</Label><Input type="number" min="0" step="0.001" value={deductWeight} onChange={e => setDeductWeight(e.target.value)} placeholder="e.g. 20" /></div>
            <div className="grid gap-2"><Label>Add pieces</Label><Input type="number" min="0" step="1" value={addPieces} onChange={e => setAddPieces(e.target.value)} placeholder="e.g. 2" /></div>
            <div className="grid gap-2"><Label>Deduct pieces</Label><Input type="number" min="0" step="1" value={deductPieces} onChange={e => setDeductPieces(e.target.value)} placeholder="e.g. 1" /></div>
          </div>
          <div className="grid gap-2"><Label>Reason</Label><Input value={boxReason} onChange={e => setBoxReason(e.target.value)} placeholder="Required for the stock audit trail" /></div>
          <p className="text-xs text-muted-foreground">Use add and deduct values together for a combined correction. Piece additions use the item type already in the box.</p>
          {boxError && <p role="alert" className="text-sm text-destructive">{boxError}</p>}
          <div><Button onClick={submitBoxAdjustment} disabled={savingBox || !sourceBox}>{savingBox ? "Saving…" : "Adjust Stock"}</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find item</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="relative max-w-xs">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Choose a box above"
              value={boxNumberInput}
              readOnly
            />
          </div>
          {boxNumberInput && !sourceBox && <p className="text-sm text-muted-foreground">No box with that number.</p>}
          {sourceBox && items && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Boxes className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Box {sourceBox.boxNumber} is empty.</p>
            </div>
          )}
          {sourceBox && items && items.length > 0 && (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <div key={item._id} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{mgToGramsDisplay(item.netWeightMg)}g net</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setSelectedItem(item)}>
                    Adjust
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent adjustments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {recent === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No adjustments recorded yet.</p>
          ) : (
            recent.map((log) => (
              <div key={log._id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <div>
                  <p>{(log.metadata as { label?: string })?.label ?? "Item"}</p>
                  <p className="text-xs text-muted-foreground">{(log.metadata as { reason?: string })?.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={log.action === "stock.write_off" ? "destructive" : "secondary"}>
                    {log.action === "stock.write_off" ? "Write-off" : "Weight correction"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleDateString("en-IN")}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {selectedItem && <AdjustDialog item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
}
