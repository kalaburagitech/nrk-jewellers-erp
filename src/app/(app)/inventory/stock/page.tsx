"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Boxes, Minus, PackageSearch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { useAccessInfo } from "@/components/access-context";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { getUserErrorMessage } from "@/lib/user-error";

export default function StockPage() {
  const overview = useQuery(api.itemStock.overview);
  const { isLocked } = usePrivacyLock();
  const [tab, setTab] = useState<string | null>(null);

  if (overview === undefined) return <p className="text-sm text-muted-foreground">Loading stock…</p>;

  const active = overview.activeOrganizationId;
  // Privacy lock on: box (Daily Sales) stock and other companies stay hidden.
  const daily = isLocked ? [] : overview.daily;
  const gst = isLocked ? overview.gst.filter((c) => c.organizationId === active) : overview.gst;
  const showDaily = !isLocked;
  const activeIsGst = overview.gst.some((c) => c.organizationId === active);
  const currentTab = tab ?? (activeIsGst || !showDaily ? "gst" : "daily");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        <p className="text-sm text-muted-foreground">
          Daily Sales stock is kept in boxes. GST stock is kept item-wise (weight and pieces) and is used by GST bills.
        </p>
      </div>
      <Tabs value={currentTab} onValueChange={setTab}>
        <TabsList className={showDaily ? "grid w-full grid-cols-2 sm:w-96" : "grid w-full grid-cols-1 sm:w-48"}>
          {showDaily && <TabsTrigger value="daily"><Boxes className="h-4 w-4" />Daily Sales</TabsTrigger>}
          <TabsTrigger value="gst"><PackageSearch className="h-4 w-4" />GST Purpose</TabsTrigger>
        </TabsList>
        {showDaily && (
          <TabsContent value="daily" className="mt-4 flex flex-col gap-4">
            {daily.length === 0 && <p className="text-sm text-muted-foreground">No Daily Sales company.</p>}
            {daily.map((company) => <DailyCompanyCard key={company.organizationId} company={company} />)}
          </TabsContent>
        )}
        <TabsContent value="gst" className="mt-4 flex flex-col gap-4">
          {gst.length === 0 && <p className="text-sm text-muted-foreground">No GST company yet. Create one under Settings → Companies.</p>}
          {gst.map((company) => (
            company.organizationId === active
              ? <ActiveGstStock key={company.organizationId} name={company.name} />
              : <GstCompanyCard key={company.organizationId} company={company} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

type DailyCompany = { organizationId: string; name: string; boxes: Array<{ boxId: string; boxNumber: number; label?: string; pieces: number; netWeightMg: number }> };

function DailyCompanyCard({ company }: { company: DailyCompany }) {
  const pieces = company.boxes.reduce((s, b) => s + b.pieces, 0);
  const weight = company.boxes.reduce((s, b) => s + b.netWeightMg, 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{company.name}</CardTitle>
        <span className="text-sm text-muted-foreground">{pieces} pcs · {mgToGramsDisplay(weight)} g net</span>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Box</TableHead><TableHead className="text-right">Pieces</TableHead><TableHead className="text-right">Net weight (g)</TableHead></TableRow></TableHeader>
          <TableBody>
            {company.boxes.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">No boxes yet.</TableCell></TableRow>}
            {company.boxes.map((b) => (
              <TableRow key={b.boxId}>
                <TableCell>Box {b.boxNumber}{b.label ? ` · ${b.label}` : ""}</TableCell>
                <TableCell className="text-right">{b.pieces}</TableCell>
                <TableCell className="text-right">{mgToGramsDisplay(b.netWeightMg)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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

function ActiveGstStock({ name }: { name: string }) {
  const items = useQuery(api.itemStock.list);
  const { isViewOnly } = useAccessInfo();
  const [adjusting, setAdjusting] = useState<{ productId: string; direction: "in" | "out" } | null>(null);
  const totalWeight = (items ?? []).reduce((s, i) => s + i.weightMg, 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{name} <span className="text-xs font-normal text-muted-foreground">(current company)</span></CardTitle>
          <p className="text-xs text-muted-foreground">{mgToGramsDisplay(totalWeight)} g in stock. Purchases add stock; GST bills deduct it.</p>
        </div>
        {!isViewOnly && <Button size="sm" onClick={() => setAdjusting({ productId: "", direction: "in" })}><Plus className="h-4 w-4" />Add stock</Button>}
      </CardHeader>
      <CardContent>
        {items === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <GstTable items={items.filter((i) => i.weightMg > 0 || i.pieces > 0)} onAdjust={isViewOnly ? undefined : (productId, direction) => setAdjusting({ productId, direction })} />
        )}
      </CardContent>
      {adjusting && items && <AdjustDialog items={items} initial={adjusting} onClose={() => setAdjusting(null)} />}
    </Card>
  );
}

function AdjustDialog({ items, initial, onClose }: { items: Array<{ productId: string; name: string; weightMg: number; pieces: number }>; initial: { productId: string; direction: "in" | "out" }; onClose: () => void }) {
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
