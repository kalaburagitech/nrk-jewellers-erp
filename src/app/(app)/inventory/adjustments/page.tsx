"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { boxOptionLabel } from "@/lib/box-label";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { PrivacyLockGate } from "@/components/privacy-lock-gate";
import { GstStockAdjustDialog } from "@/components/gst-stock-adjust-dialog";
import { useAccessInfo } from "@/components/access-context";


type AdjustmentMeta = { label?: string; boxNumber?: number; addWeightMg?: number; deductWeightMg?: number; addPieces?: number; deductPieces?: number; direction?: "in" | "out"; weightMg?: number; pieces?: number };

/** Human-readable summary of one adjustment log entry. */
function describeAdjustment(log: Doc<"auditLogs">, productName: (id: string) => string | undefined) {
  const meta = (log.metadata ?? {}) as AdjustmentMeta;
  if (log.action === "item_stock.adjust") {
    const sign = meta.direction === "out" ? "−" : "+";
    const parts = [
      meta.weightMg ? `${sign}${mgToGramsDisplay(meta.weightMg)}g` : "",
      meta.pieces ? `${sign}${meta.pieces} pcs` : "",
    ].filter(Boolean);
    return `${productName(log.entityId) ?? "Item"}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
  }
  if (log.action !== "stock.adjust_box") return meta.label ?? "Item";
  const parts = [
    meta.addWeightMg ? `+${mgToGramsDisplay(meta.addWeightMg)}g` : "",
    meta.deductWeightMg ? `−${mgToGramsDisplay(meta.deductWeightMg)}g` : "",
    meta.addPieces ? `+${meta.addPieces} pcs` : "",
    meta.deductPieces ? `−${meta.deductPieces} pcs` : "",
  ].filter(Boolean);
  return `Box ${meta.boxNumber ?? "?"}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
}

function RecentAdjustments() {
  const recent = useQuery(api.stockAdjustments.listRecent);
  const products = useQuery(api.products.list);
  const productName = (id: string) => products?.find((p) => p._id === id)?.name;
  return (
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
                <p>{describeAdjustment(log, productName)}</p>
                <p className="text-xs text-muted-foreground">{(log.metadata as { reason?: string })?.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={log.action === "stock.write_off" ? "destructive" : "secondary"}>
                  {log.action === "stock.write_off" ? "Write-off" : log.action === "stock.adjust_box" ? "Box adjustment" : log.action === "item_stock.adjust" ? "GST stock" : "Weight correction"}
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
  );
}

/**
 * GST company: loose item stock (not in a box yet). Box stock is adjusted
 * exactly like Daily Sales, in the box section above this one.
 */
function GstStockAdjustments() {
  const items = useQuery(api.itemStock.list);
  const { isViewOnly } = useAccessInfo();
  const [adjusting, setAdjusting] = useState<{ productId: string; direction: "in" | "out" } | null>(null);
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Loose GST item stock (not in a box)</CardTitle>
            <p className="text-xs text-muted-foreground">Older GST stock kept item-wise. Put it into boxes under Items → GST Item Stock.</p>
          </div>
          {!isViewOnly && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setAdjusting({ productId: "", direction: "in" })}>Add stock</Button>
              <Button size="sm" variant="outline" onClick={() => setAdjusting({ productId: "", direction: "out" })}>Remove stock</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet. Add items under Items → Item List.</p>
          ) : (
            items.filter((item) => item.looseWeightMg !== 0 || item.loosePieces !== 0).map((item) => (
              <div key={item.productId} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{mgToGramsDisplay(item.looseWeightMg)} g · {item.loosePieces} pcs loose</p>
                </div>
                {!isViewOnly && (
                  <Button size="sm" variant="outline" onClick={() => setAdjusting({ productId: item.productId, direction: "out" })}>
                    Adjust
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      {adjusting && items && <GstStockAdjustDialog items={items} initial={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}

export default function StockAdjustmentsPage() {
  const access = useQuery(api.organizations.getMyAccess);
  const companyType = access?.organization?.companyType;
  if (access === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  // Both companies adjust box stock the same way; the GST company's boxes aren't private.
  if (companyType === "gst_gold" || companyType === "gst_silver") return <BoxStockAdjustments gst />;
  return (
    <PrivacyLockGate>
      <BoxStockAdjustments />
    </PrivacyLockGate>
  );
}

function BoxStockAdjustments({ gst = false }: { gst?: boolean }) {
  const boxes = useQuery(api.boxes.list);
  const adjustBox = useMutation(api.stockAdjustments.adjustBox);
  const [boxId, setBoxId] = useState("");
  const [addWeight, setAddWeight] = useState("");
  const [deductWeight, setDeductWeight] = useState("");
  const [addPieces, setAddPieces] = useState("");
  const [deductPieces, setDeductPieces] = useState("");
  const [boxReason, setBoxReason] = useState("");
  const [itemId, setItemId] = useState("");
  const products = useQuery(api.products.list);
  const [boxError, setBoxError] = useState("");
  const [saved, setSaved] = useState("");
  const [savingBox, setSavingBox] = useState(false);

  const sourceBox = useMemo(() => boxes?.find((b) => b._id === boxId), [boxes, boxId]);
  const totals = useMemo(() => ({
    weightMg: boxes?.reduce((sum, b) => sum + b.weightMg, 0) ?? 0,
    pieces: boxes?.reduce((sum, b) => sum + b.pieces, 0) ?? 0,
  }), [boxes]);
  const addMg = gramsToMg(addWeight || "0");
  const deductMg = gramsToMg(deductWeight || "0");
  const pieceDelta = Number(addPieces || 0) - Number(deductPieces || 0);

  async function submitBoxAdjustment() {
    setBoxError("");
    setSaved("");
    if (!sourceBox) { setBoxError("Choose a box first."); return; }
    for (const [label, raw, whole] of [["Add weight", addWeight, false], ["Deduct weight", deductWeight, false], ["Add pieces", addPieces, true], ["Deduct pieces", deductPieces, true]] as const) {
      const n = Number(raw || 0);
      if (!Number.isFinite(n) || n < 0 || (whole && !Number.isInteger(n))) { setBoxError(`${label}: enter ${whole ? "a whole number" : "a weight"} of 0 or more.`); return; }
    }
    if (!boxReason.trim()) { setBoxError("A reason is required for the stock history."); return; }
    setSavingBox(true);
    try {
      await adjustBox({ boxId: sourceBox._id, addWeightMg: addMg, deductWeightMg: deductMg, addPieces: Number(addPieces || 0), deductPieces: Number(deductPieces || 0), reason: boxReason, productId: itemId ? (itemId as Id<"products">) : undefined });
      setAddWeight(""); setDeductWeight(""); setAddPieces(""); setDeductPieces(""); setBoxReason(""); setItemId("");
      setSaved(`Box ${sourceBox.boxNumber} updated.`);
    } catch (error) { setBoxError(getUserErrorMessage(error, "Could not adjust stock.")); }
    finally { setSavingBox(false); }
  }

  return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock Adjustments</h1>
          <p className="text-sm text-muted-foreground">
            Correct stock differences after a physical count — add or deduct weight and pieces. Every change is logged with its reason in the Stock Journal.
          </p>
        </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Inventory overview</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs uppercase text-muted-foreground">Total boxes</p><p className="text-2xl font-semibold">{boxes?.length ?? "—"}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Total weight</p><p className="text-2xl font-semibold">{boxes ? mgToGramsDisplay(totals.weightMg) : "—"} g</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Total pieces</p><p className="text-2xl font-semibold">{boxes ? totals.pieces : "—"}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Adjust stock for a box</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="adjust-box">Box</Label><select id="adjust-box" className="h-10 rounded-md border bg-background px-3 text-sm" value={boxId} onChange={e => { setBoxId(e.target.value); setSaved(""); }}><option value="">Choose a box</option>{boxes?.map(box => <option key={box._id} value={box._id}>{boxOptionLabel(box)}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="add-weight">Add weight (grams)</Label><Input id="add-weight" type="number" min="0" step="0.001" value={addWeight} onChange={e => setAddWeight(e.target.value)} placeholder="e.g. 50" /></div>
            <div className="grid gap-2"><Label htmlFor="deduct-weight">Deduct weight (grams)</Label><Input id="deduct-weight" type="number" min="0" step="0.001" value={deductWeight} onChange={e => setDeductWeight(e.target.value)} placeholder="e.g. 20" /></div>
            <div className="grid gap-2"><Label htmlFor="add-pieces">Add pieces</Label><Input id="add-pieces" type="number" min="0" step="1" value={addPieces} onChange={e => setAddPieces(e.target.value)} placeholder="e.g. 2" /></div>
            <div className="grid gap-2"><Label htmlFor="deduct-pieces">Deduct pieces</Label><Input id="deduct-pieces" type="number" min="0" step="1" value={deductPieces} onChange={e => setDeductPieces(e.target.value)} placeholder="e.g. 1" /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="adjust-item">Item (optional)</Label><select id="adjust-item" className="h-10 rounded-md border bg-background px-3 text-sm" value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Not for one item</option>{products?.filter(p => p.isActive && p.itemType !== "service").map(p => <option key={p._id} value={p._id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}</select><p className="text-xs text-muted-foreground">Choose the item when the stock belongs to one item, so it also counts in item-wise{gst ? " GST" : ""} stock.</p></div>
          <div className="grid gap-2"><Label htmlFor="adjust-reason">Reason</Label><Input id="adjust-reason" value={boxReason} maxLength={200} onChange={e => setBoxReason(e.target.value)} placeholder="Required for the stock audit trail" /></div>
          {sourceBox && (
            <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Now in Box {sourceBox.boxNumber}</p><p className="font-semibold tabular-nums">{mgToGramsDisplay(sourceBox.weightMg)} g · {sourceBox.pieces} pcs</p></div>
              <div><p className="text-xs text-muted-foreground">Change</p><p className="font-semibold tabular-nums">{addMg - deductMg >= 0 ? "+" : "−"}{mgToGramsDisplay(Math.abs(addMg - deductMg))} g · {pieceDelta >= 0 ? "+" : "−"}{Math.abs(pieceDelta)} pcs</p></div>
              <div><p className="text-xs text-muted-foreground">After adjustment</p><p className={`font-semibold tabular-nums ${sourceBox.weightMg + addMg - deductMg < 0 || sourceBox.pieces + pieceDelta < 0 ? "text-destructive" : "text-success"}`}>{mgToGramsDisplay(sourceBox.weightMg + addMg - deductMg)} g · {sourceBox.pieces + pieceDelta} pcs</p></div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Use add and deduct values together for a combined correction. Weight is the gross weight kept in the box.</p>
          {boxError && <p role="alert" className="text-sm text-destructive">{boxError}</p>}
          {saved && <p role="status" className="text-sm text-success">{saved}</p>}
          <div><Button onClick={submitBoxAdjustment} disabled={savingBox || !sourceBox}>{savingBox ? "Saving…" : "Adjust Stock"}</Button></div>
        </CardContent>
      </Card>

      {gst && <GstStockAdjustments />}

      <RecentAdjustments />
      </div>
  );
}
