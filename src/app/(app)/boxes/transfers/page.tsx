"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { boxOptionLabel } from "@/lib/box-label";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { BoxScreensGate } from "@/components/privacy-lock-gate";

export default function BoxTransfersPage() {
  const boxes = useQuery(api.boxes.list);
  const transferStock = useMutation(api.boxes.transferStock);

  const [fromBoxId, setFromBoxId] = useState("");
  const [toBoxId, setToBoxId] = useState("");
  const [weight, setWeight] = useState("");
  const [pieces, setPieces] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState("");

  const activeBoxes = useMemo(() => boxes?.filter((b) => b.isActive) ?? [], [boxes]);
  const fromBox = activeBoxes.find((b) => b._id === fromBoxId);
  const toBox = activeBoxes.find((b) => b._id === toBoxId);
  // Only boxes of the same metal (or with no metal set) can receive the stock.
  const targets = activeBoxes.filter((b) => b._id !== fromBoxId && (!fromBox?.metal || !b.metal || b.metal === fromBox.metal));
  const weightMg = gramsToMg(weight || "0");
  const pieceCount = Number(pieces || 0);

  async function handleTransfer() {
    setError(null);
    setDone("");
    if (!fromBox || !toBox) return setError("Choose the box to move from and the box to move into.");
    if (!(Number(weight || 0) >= 0) || !Number.isInteger(pieceCount) || pieceCount < 0) return setError("Enter a weight and whole pieces of 0 or more.");
    if (!weightMg && !pieceCount) return setError("Enter the weight or pieces to move.");
    if (weightMg > fromBox.weightMg || pieceCount > fromBox.pieces) return setError(`Box ${fromBox.boxNumber} only has ${mgToGramsDisplay(fromBox.weightMg)} g, ${fromBox.pieces} pcs.`);
    setSaving(true);
    try {
      await transferStock({ fromBoxId: fromBox._id as Id<"boxes">, toBoxId: toBox._id as Id<"boxes">, weightMg, pieces: pieceCount, note: note.trim() || undefined });
      setDone(`Moved ${mgToGramsDisplay(weightMg)} g, ${pieceCount} pcs from Box ${fromBox.boxNumber} to Box ${toBox.boxNumber}.`);
      setWeight("");
      setPieces("");
      setNote("");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not transfer stock. Check your access and try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BoxScreensGate>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Box Transfers</h1>
          <p className="text-sm text-muted-foreground">Move weight and pieces from one box to another box of the same metal. Both boxes are logged in the Stock Journal.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transfer stock</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <div className="grid gap-2">
                <Label htmlFor="from-box">From box</Label>
                <select id="from-box" className="h-10 rounded-md border bg-background px-3 text-sm" value={fromBoxId} onChange={(e) => { setFromBoxId(e.target.value); setToBoxId(""); setDone(""); }}>
                  <option value="">Choose a box</option>
                  {activeBoxes.map((b) => <option key={b._id} value={b._id}>{boxOptionLabel(b)}</option>)}
                </select>
              </div>
              <ArrowRight className="hidden h-5 w-5 self-center text-muted-foreground sm:block" />
              <div className="grid gap-2">
                <Label htmlFor="to-box">To box</Label>
                <select id="to-box" className="h-10 rounded-md border bg-background px-3 text-sm" value={toBoxId} disabled={!fromBox} onChange={(e) => { setToBoxId(e.target.value); setDone(""); }}>
                  <option value="">{fromBox ? "Choose a box" : "Choose the from box first"}</option>
                  {targets.map((b) => <option key={b._id} value={b._id}>{boxOptionLabel(b)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="transfer-weight">Weight to move (grams)</Label>
                <Input id="transfer-weight" type="number" min="0" step="0.001" placeholder="e.g. 100" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="transfer-pieces">Pieces to move</Label>
                <Input id="transfer-pieces" type="number" min="0" step="1" placeholder="e.g. 10" value={pieces} onChange={(e) => setPieces(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transfer-note">Remark (optional)</Label>
              <Input id="transfer-note" maxLength={200} placeholder="e.g. Rearranged display" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {fromBox && toBox && (
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Box {fromBox.boxNumber} after</p><p className="font-semibold tabular-nums">{mgToGramsDisplay(fromBox.weightMg - weightMg)} g · {fromBox.pieces - pieceCount} pcs</p></div>
                <div><p className="text-xs text-muted-foreground">Box {toBox.boxNumber} after</p><p className="font-semibold tabular-nums">{mgToGramsDisplay(toBox.weightMg + weightMg)} g · {toBox.pieces + pieceCount} pcs</p></div>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {done && <p role="status" className="text-sm text-success">{done}</p>}
            <div>
              <Button onClick={handleTransfer} disabled={saving || !fromBox || !toBox}>
                <ArrowRight className="h-4 w-4" />
                {saving ? "Moving…" : "Transfer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </BoxScreensGate>
  );
}
