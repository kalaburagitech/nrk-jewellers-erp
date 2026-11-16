"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { getUserErrorMessage } from "@/lib/user-error";

/** Add or remove GST item stock by hand — used on the Stock screen and on Stock Adjustments. */
export function GstStockAdjustDialog({ items, initial, onClose }: { items: Array<{ productId: string; name: string; weightMg: number; pieces: number }>; initial: { productId: string; direction: "in" | "out" }; onClose: () => void }) {
  const adjust = useMutation(api.itemStock.adjust);
  const [productId, setProductId] = useState(initial.productId);
  const [direction, setDirection] = useState(initial.direction);
  const [grams, setGrams] = useState("");
  const [pieces, setPieces] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const pcs = pieces.trim() === "" ? 0 : Number(pieces);
    if (!productId) return setError("Choose an item.");
    if (!Number.isInteger(pcs) || pcs < 0) return setError("Pieces must be a whole number.");
    setSaving(true);
    setError(null);
    try {
      await adjust({ productId: productId as Id<"products">, direction, weightMg: gramsToMg(grams || "0"), pieces: pcs, reason });
      onClose();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not change stock."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{direction === "in" ? "Add GST stock" : "Remove GST stock"}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Item</Label>
            <Select value={productId || undefined} onValueChange={setProductId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose item" /></SelectTrigger>
              <SelectContent>{items.map((i) => <SelectItem key={i.productId} value={i.productId}>{i.name} ({mgToGramsDisplay(i.weightMg)} g, {i.pieces} pcs)</SelectItem>)}</SelectContent>
            </Select>
            {items.length === 0 && <p className="text-xs text-muted-foreground">Add items first under Items → Item List.</p>}
          </div>
          <div className="grid gap-2">
            <Label>Change</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="in">Add (opening stock / received)</SelectItem><SelectItem value="out">Remove (damage / correction)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label htmlFor="adj-grams">Weight (g)</Label><Input id="adj-grams" value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" placeholder="0.000" /></div>
            <div className="grid gap-2"><Label htmlFor="adj-pcs">Pieces</Label><Input id="adj-pcs" value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" placeholder="0" /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="adj-reason">Reason</Label><Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opening stock" /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
