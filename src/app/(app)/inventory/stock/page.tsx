"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { Boxes, Minus, PackageSearch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getUserErrorMessage } from "@/lib/user-error";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { useAccessInfo } from "@/components/access-context";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { GstStockAdjustDialog } from "@/components/gst-stock-adjust-dialog";

/**
 * GST Item Stock. Daily Sales stock is not shown here — it stays private under
 * Box Management. A GST company keeps its pieces in its own boxes; older GST
 * stock that isn't in a box yet is "loose" and can be put into a box here.
 */
export default function StockPage() {
  const overview = useQuery(api.itemStock.overview);
  const { isLocked } = usePrivacyLock();

  if (overview === undefined) return <p className="text-sm text-muted-foreground">Loading stock…</p>;

  const active = overview.activeOrganizationId;
  // Privacy lock on: other companies stay hidden.
  const gst = isLocked ? overview.gst.filter((c) => c.organizationId === active) : overview.gst;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><PackageSearch className="h-6 w-6 text-primary" />GST Item Stock</h1>
        <p className="text-sm text-muted-foreground">
          GST stock per item: pieces in the GST company&apos;s boxes plus any loose stock not yet put into a box. Purchases add stock; GST bills deduct it.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {gst.length === 0 && <p className="text-sm text-muted-foreground">No GST company yet. Create one under Settings → Companies.</p>}
        {gst.map((company) => (
          company.organizationId === active
            ? <ActiveGstStock key={company.organizationId} name={company.name} />
            : <GstCompanyCard key={company.organizationId} company={company} />
        ))}
      </div>
    </div>
  );
}

type GstCompany = { organizationId: string; name: string; items: Array<{ productId: string; name: string; weightMg: number; pieces: number }> };

function GstTable({ items, onAdjust }: { items: Array<{ productId: string; name: string; weightMg: number; pieces: number }>; onAdjust?: (productId: string, direction: "in" | "out") => void }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Pieces</TableHead><TableHead className="text-right">Weight (g)</TableHead>{onAdjust && <TableHead className="text-right">Change</TableHead>}</TableRow></TableHeader>
      <TableBody>
        {items.length === 0 && <TableRow><TableCell colSpan={onAdjust ? 4 : 3} className="text-muted-foreground">No items in GST stock.</TableCell></TableRow>}
        {items.map((item) => (
          <TableRow key={item.productId}>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell className="text-right">{item.pieces}</TableCell>
            <TableCell className="text-right">{mgToGramsDisplay(item.weightMg)}</TableCell>
            {onAdjust && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => onAdjust(item.productId, "in")} aria-label={`Add stock to ${item.name}`}><Plus className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="outline" onClick={() => onAdjust(item.productId, "out")} aria-label={`Remove stock from ${item.name}`}><Minus className="h-3.5 w-3.5" /></Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function GstCompanyCard({ company }: { company: GstCompany }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{company.name}</CardTitle><p className="text-xs text-muted-foreground">Switch to this company to change its stock.</p></CardHeader>
      <CardContent><GstTable items={company.items} /></CardContent>
    </Card>
  );
}

type StockRow = { productId: string; name: string; weightMg: number; pieces: number; looseWeightMg: number; loosePieces: number; boxPieces: number };

function ActiveGstStock({ name }: { name: string }) {
  const items = useQuery(api.itemStock.list);
  const { isViewOnly } = useAccessInfo();
  const [adjusting, setAdjusting] = useState<{ productId: string; direction: "in" | "out" } | null>(null);
  const [moving, setMoving] = useState<StockRow | null>(null);
  const rows = (items ?? []).filter((i) => i.weightMg !== 0 || i.pieces !== 0);
  const totalWeight = rows.reduce((s, i) => s + i.weightMg, 0);
  const loose = rows.filter((i) => i.looseWeightMg > 0 || i.loosePieces > 0);
  // The add/remove dialog changes loose stock only, so give it loose balances.
  const looseItems = (items ?? []).map((i) => ({ productId: i.productId, name: i.name, weightMg: i.looseWeightMg, pieces: i.loosePieces }));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{name} <span className="text-xs font-normal text-muted-foreground">(current company)</span></CardTitle>
          <p className="text-xs text-muted-foreground">
            {mgToGramsDisplay(totalWeight)} g gross in stock{loose.length > 0 ? ` · ${loose.length} item(s) have loose stock to put into boxes` : ""}.
          </p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href="/boxes"><Boxes className="h-4 w-4" />Box Management</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {items === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">In boxes (pcs)</TableHead>
                  <TableHead className="text-right">Loose (pcs)</TableHead>
                  <TableHead className="text-right">Loose (g)</TableHead>
                  <TableHead className="text-right">Total pcs</TableHead>
                  <TableHead className="text-right">Total gross (g)</TableHead>
                  {!isViewOnly && <TableHead className="text-right">Loose stock</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No GST stock yet. Purchases put pieces into boxes.</TableCell></TableRow>}
                {rows.map((item) => (
                  <TableRow key={item.productId}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-right">{item.boxPieces}</TableCell>
                    <TableCell className="text-right">{item.loosePieces}</TableCell>
                    <TableCell className="text-right">{mgToGramsDisplay(item.looseWeightMg)}</TableCell>
                    <TableCell className="text-right font-medium">{item.pieces}</TableCell>
                    <TableCell className="text-right font-medium">{mgToGramsDisplay(item.weightMg)}</TableCell>
                    {!isViewOnly && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {item.looseWeightMg > 0 && item.loosePieces > 0 && (
                            <Button size="sm" onClick={() => setMoving(item)}><Boxes className="h-3.5 w-3.5" />Put into box</Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setAdjusting({ productId: item.productId, direction: "in" })} aria-label={`Add loose stock to ${item.name}`}><Plus className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="outline" onClick={() => setAdjusting({ productId: item.productId, direction: "out" })} aria-label={`Remove loose stock from ${item.name}`}><Minus className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {adjusting && items && <GstStockAdjustDialog items={looseItems} initial={adjusting} onClose={() => setAdjusting(null)} />}
      {moving && <PutIntoBoxDialog item={moving} onClose={() => setMoving(null)} />}
    </Card>
  );
}

/** Moves one piece of loose GST stock into a box (label + weights), so it can be billed from the box. */
function PutIntoBoxDialog({ item, onClose }: { item: StockRow; onClose: () => void }) {
  const boxes = useQuery(api.boxes.list);
  const moveToBox = useMutation(api.itemStock.moveToBox);
  const perPieceMg = item.loosePieces > 0 ? Math.floor(item.looseWeightMg / item.loosePieces) : item.looseWeightMg;
  const [boxId, setBoxId] = useState("");
  const [label, setLabel] = useState(item.name);
  const [gross, setGross] = useState((perPieceMg / 1000).toFixed(3));
  const [stone, setStone] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moved, setMoved] = useState(0);
  const activeBoxes = (boxes ?? []).filter((b) => b.isActive);

  async function save(keepOpen: boolean) {
    setError(null);
    const grossWeightMg = gramsToMg(gross || "0");
    const stoneWeightMg = gramsToMg(stone || "0");
    if (!boxId) return setError("Choose a box.");
    if (grossWeightMg <= 0) return setError("Enter the gross weight of this piece.");
    if (stoneWeightMg > grossWeightMg) return setError("Stone weight cannot be more than gross weight.");
    setSaving(true);
    try {
      await moveToBox({ productId: item.productId as Id<"products">, boxId: boxId as Id<"boxes">, label, grossWeightMg, stoneWeightMg });
      setMoved((m) => m + 1);
      if (!keepOpen) onClose();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not put the piece into the box."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Put {item.name} into a box</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Loose stock: {Math.max(0, item.loosePieces - moved)} pcs. Each save moves one piece into the box; the total GST stock does not change.
        </p>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Box</Label>
            <Select value={boxId || undefined} onValueChange={setBoxId}>
              <SelectTrigger><SelectValue placeholder={activeBoxes.length ? "Choose a box" : "No boxes yet — add one under Box Management"} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {activeBoxes.map((b) => <SelectItem key={b._id} value={b._id}>Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Piece name</Label><Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Gross weight (g)</Label><Input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Stone weight (g)</Label><Input inputMode="decimal" value={stone} onChange={(e) => setStone(e.target.value)} /></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {moved > 0 && <p className="text-sm text-emerald-600">{moved} piece(s) moved into the box.</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => save(true)}>Save &amp; next piece</Button>
          <Button disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
