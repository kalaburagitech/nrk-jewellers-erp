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
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { PrivacyLockGate } from "@/components/privacy-lock-gate";
import { GstStockAdjustDialog } from "@/components/gst-stock-adjust-dialog";
import { useAccessInfo } from "@/components/access-context";

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
  const overview = useQuery(api.boxes.getInventoryOverview);
  const adjustBox = useMutation(api.stockAdjustments.adjustBox);
  const [boxNumberInput, setBoxNumberInput] = useState("");
  const [addWeight, setAddWeight] = useState("");
  const [deductWeight, setDeductWeight] = useState("");
  const [addPieces, setAddPieces] = useState("");
  const [deductPieces, setDeductPieces] = useState("");
  const [boxReason, setBoxReason] = useState("");
  const [boxError, setBoxError] = useState("");
  const [savingBox, setSavingBox] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Doc<"boxItems"> | null>(null);
  const products = useQuery(api.products.list);
  const [productId, setProductId] = useState("");
  const [itemLabel, setItemLabel] = useState("");

  const sourceBox = useMemo(() => boxes?.find((b) => String(b._id) === boxNumberInput), [boxes, boxNumberInput]);
  const items = useQuery(api.boxes.getItems, sourceBox ? { boxId: sourceBox._id } : "skip");
  // An empty box has no piece to copy the item type from, so ask for it when adding pieces.
  const boxIsEmpty = Boolean(sourceBox && items && items.length === 0);
  const needsProduct = boxIsEmpty && Number(addPieces || 0) > 0;

  async function submitBoxAdjustment() {
    setBoxError("");
    if (!sourceBox) { setBoxError("Choose a box first."); return; }
    if (!boxReason.trim()) { setBoxError("A reason is required for the stock history."); return; }
    if (boxIsEmpty && Number(addWeight || 0) > 0 && !(Number(addPieces || 0) > 0)) { setBoxError("This box is empty — enter how many pieces you are adding with this weight."); return; }
    if (needsProduct && !productId) { setBoxError("Choose the product for the pieces you are adding."); return; }
    setSavingBox(true);
    try {
      await adjustBox({ boxId: sourceBox._id, addWeightMg: Math.round(Number(addWeight || 0) * 1000), deductWeightMg: Math.round(Number(deductWeight || 0) * 1000), addPieces: Number(addPieces || 0), deductPieces: Number(deductPieces || 0), reason: boxReason,
        ...(needsProduct ? { productId: productId as Id<"products">, itemLabel: itemLabel.trim() || undefined } : {}) });
      setAddWeight(""); setDeductWeight(""); setAddPieces(""); setDeductPieces(""); setBoxReason(""); setProductId(""); setItemLabel("");
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
          {boxIsEmpty && (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              This box is empty. To put stock in it, enter <strong>Add pieces</strong> and <strong>Add weight</strong>, then choose the product below.
            </p>
          )}
          {needsProduct && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="adjust-product">Product</Label><select id="adjust-product" className="h-10 rounded-md border bg-background px-3 text-sm" value={productId} onChange={e => setProductId(e.target.value)}><option value="">Choose product</option>{products?.map(product => <option key={product._id} value={product._id}>{product.name}</option>)}</select></div>
              <div className="grid gap-2"><Label htmlFor="adjust-item-label">Item name (optional)</Label><Input id="adjust-item-label" value={itemLabel} maxLength={80} onChange={e => setItemLabel(e.target.value)} placeholder="Defaults to the product name" /></div>
            </div>
          )}
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
              aria-label="Selected box"
              placeholder="Choose a box above"
              value={sourceBox ? `Box ${sourceBox.boxNumber}${sourceBox.label ? ` — ${sourceBox.label}` : ""}` : ""}
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

      {gst && <GstStockAdjustments />}

      <RecentAdjustments />

      {selectedItem && <AdjustDialog item={selectedItem} onClose={() => setSelectedItem(null)} />}
      </div>
  );
}
