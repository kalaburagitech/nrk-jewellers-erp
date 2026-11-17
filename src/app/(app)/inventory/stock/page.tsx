"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Minus, PackageSearch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { useAccessInfo } from "@/components/access-context";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { getUserErrorMessage } from "@/lib/user-error";

/**
 * GST item stock (part of the GST module). Daily Sales box stock is no longer
 * shown here — it stays under Box Management / Box Reports, and no stock or
 * sales records were removed.
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
          GST stock is kept item-wise — gross, stone and net weight and pieces — and is used by GST bills. Box stock is under Box Management.
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

type GstItem = {
  productId: string;
  name: string;
  weightMg: number;
  grossWeightMg?: number;
  stoneWeightMg?: number;
  netWeightMg?: number;
  pieces: number;
};

type GstCompany = { organizationId: string; name: string; items: Array<GstItem> };

function GstTable({
  items,
  onAdjust,
}: {
  items: Array<GstItem>;
  onAdjust?: (productId: string, direction: "in" | "out") => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Pieces</TableHead>
          <TableHead className="text-right">Gross Wt (g)</TableHead>
          <TableHead className="text-right">Stone Wt (g)</TableHead>
          <TableHead className="text-right">Net Wt (g)</TableHead>
          {onAdjust && <TableHead className="text-right">Change</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 && (
          <TableRow>
            <TableCell colSpan={onAdjust ? 6 : 5} className="text-muted-foreground">
              No items in GST stock.
            </TableCell>
          </TableRow>
        )}
        {items.map((item) => (
          <TableRow key={item.productId}>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell className="text-right tabular-nums">{item.pieces}</TableCell>
            <TableCell className="text-right tabular-nums font-mono">
              {mgToGramsDisplay(item.grossWeightMg ?? item.weightMg)}
            </TableCell>
            <TableCell className="text-right tabular-nums font-mono text-muted-foreground">
              {mgToGramsDisplay(item.stoneWeightMg ?? 0)}
            </TableCell>
            <TableCell className="text-right tabular-nums font-mono font-medium text-emerald-600">
              {mgToGramsDisplay(item.netWeightMg ?? item.weightMg)}
            </TableCell>
            {onAdjust && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAdjust(item.productId, "in")}
                    aria-label={`Add stock to ${item.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAdjust(item.productId, "out")}
                    aria-label={`Remove stock from ${item.name}`}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
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
      <CardHeader>
        <CardTitle className="text-base">{company.name}</CardTitle>
        <p className="text-xs text-muted-foreground">Switch to this company to change its stock.</p>
      </CardHeader>
      <CardContent>
        <GstTable items={company.items} />
      </CardContent>
    </Card>
  );
}

function ActiveGstStock({ name }: { name: string }) {
  const items = useQuery(api.itemStock.list);
  const { isViewOnly } = useAccessInfo();
  const [adjusting, setAdjusting] = useState<{ productId: string; direction: "in" | "out" } | null>(null);

  const totalGross = (items ?? []).reduce((s, i) => s + (i.grossWeightMg ?? i.weightMg), 0);
  const totalStone = (items ?? []).reduce((s, i) => s + (i.stoneWeightMg ?? 0), 0);
  const totalNet = (items ?? []).reduce((s, i) => s + (i.netWeightMg ?? i.weightMg), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">
            {name} <span className="text-xs font-normal text-muted-foreground">(current company)</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Gross: {mgToGramsDisplay(totalGross)}g · Stone: {mgToGramsDisplay(totalStone)}g · Net: {mgToGramsDisplay(totalNet)}g in stock. Purchases inward stock; GST bills deduct each balance.
          </p>
        </div>
        {!isViewOnly && (
          <Button size="sm" onClick={() => setAdjusting({ productId: "", direction: "in" })}>
            <Plus className="h-4 w-4" />
            Add stock
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <GstTable
            items={items.filter((i) => (i.grossWeightMg ?? i.weightMg) > 0 || (i.netWeightMg ?? i.weightMg) > 0 || i.pieces > 0)}
            onAdjust={isViewOnly ? undefined : (productId, direction) => setAdjusting({ productId, direction })}
          />
        )}
      </CardContent>
      {adjusting && items && <AdjustDialog items={items} initial={adjusting} onClose={() => setAdjusting(null)} />}
    </Card>
  );
}

function AdjustDialog({
  items,
  initial,
  onClose,
}: {
  items: Array<GstItem>;
  initial: { productId: string; direction: "in" | "out" };
  onClose: () => void;
}) {
  const adjust = useMutation(api.itemStock.adjust);
  const [productId, setProductId] = useState(initial.productId);
  const [direction, setDirection] = useState(initial.direction);
  const [grossGrams, setGrossGrams] = useState("");
  const [stoneGrams, setStoneGrams] = useState("");
  const [netGrams, setNetGrams] = useState("");
  const [autoCalcNet, setAutoCalcNet] = useState(true);
  const [pieces, setPieces] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleGrossChange(val: string) {
    setGrossGrams(val);
    if (autoCalcNet) {
      const g = parseFloat(val) || 0;
      const s = parseFloat(stoneGrams) || 0;
      setNetGrams(Math.max(0, g - s).toFixed(3));
    }
  }

  function handleStoneChange(val: string) {
    setStoneGrams(val);
    if (autoCalcNet) {
      const g = parseFloat(grossGrams) || 0;
      const s = parseFloat(val) || 0;
      setNetGrams(Math.max(0, g - s).toFixed(3));
    }
  }

  function handleNetChange(val: string) {
    setAutoCalcNet(false);
    setNetGrams(val);
  }

  async function save() {
    const pcs = pieces.trim() === "" ? 0 : Number(pieces);
    if (!productId) return setError("Choose an item.");
    if (!Number.isInteger(pcs) || pcs < 0) return setError("Pieces must be a whole number.");

    const grossMg = gramsToMg(grossGrams || "0");
    const stoneMg = gramsToMg(stoneGrams || "0");
    const netMg = gramsToMg(netGrams || "0");

    if (grossMg < 0 || stoneMg < 0 || netMg < 0) {
      return setError("Weights cannot be negative.");
    }
    if (stoneMg > grossMg) {
      return setError("Stone weight cannot exceed gross weight.");
    }
    if (grossMg < netMg) {
      return setError("Gross weight cannot be less than net weight.");
    }

    setSaving(true);
    setError(null);
    try {
      await adjust({
        productId: productId as Id<"products">,
        direction,
        weightMg: netMg,
        grossWeightMg: grossMg,
        stoneWeightMg: stoneMg,
        netWeightMg: netMg,
        pieces: pcs,
        reason,
      });
      onClose();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not change stock."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{direction === "in" ? "Add GST Stock" : "Remove GST Stock"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Item</Label>
            <Select value={productId || undefined} onValueChange={setProductId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose item" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.productId} value={i.productId}>
                    {i.name} (Gross: {mgToGramsDisplay(i.grossWeightMg ?? i.weightMg)}g · Net: {mgToGramsDisplay(i.netWeightMg ?? i.weightMg)}g, {i.pieces} pcs)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground">Add items first under Items → Item List.</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Change</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Add (opening stock / inward)</SelectItem>
                <SelectItem value="out">Remove (damage / correction)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="adj-gross" className="text-xs">Gross Wt (g)</Label>
              <Input
                id="adj-gross"
                value={grossGrams}
                onChange={(e) => handleGrossChange(e.target.value)}
                inputMode="decimal"
                placeholder="0.000"
                className="text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adj-stone" className="text-xs">Stone Wt (g)</Label>
              <Input
                id="adj-stone"
                value={stoneGrams}
                onChange={(e) => handleStoneChange(e.target.value)}
                inputMode="decimal"
                placeholder="0.000"
                className="text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adj-net" className="text-xs">Net Wt (g)</Label>
              <Input
                id="adj-net"
                value={netGrams}
                onChange={(e) => handleNetChange(e.target.value)}
                inputMode="decimal"
                placeholder="0.000"
                className="text-xs font-semibold"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="adj-pcs">Pieces</Label>
              <Input
                id="adj-pcs"
                value={pieces}
                onChange={(e) => setPieces(e.target.value)}
                inputMode="numeric"
                placeholder="0"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adj-reason">Reason</Label>
              <Input
                id="adj-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Opening stock"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
