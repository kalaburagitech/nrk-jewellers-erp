"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HSN_SUGGESTIONS } from "@/components/item-form-dialog";
import { toast } from "@/components/toaster";
import { formatPaise, paiseToRupeesInput, percentToBasisPoints, rupeesToPaise } from "@/lib/money";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";

type Metal = "gold" | "silver";
type MakingMode = "fixed" | "per_gram" | "percent";
type BoxRow = Doc<"boxes"> & { weightMg: number; pieces: number };
/** An item inside a box, as boxes.list returns it (purchase price only for cost roles). */
export type BoxEntryRow = Omit<Doc<"boxEntries">, "purchasePricePaise"> & {
  purchasePricePaise?: number;
  productName: string;
  sku?: string;
  categoryName?: string;
};

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const NONE = "";

function percentText(bp?: number) {
  return bp ? String(bp / 100) : "";
}
function moneyText(paise?: number) {
  return paise ? paiseToRupeesInput(paise) : "";
}

/** Text fields of the item-in-box form, from an existing row or blank. */
function formFrom(entry?: BoxEntryRow) {
  const mode: MakingMode = entry?.makingChargeMode ?? "fixed";
  return {
    productId: entry?.productId ?? "",
    hsnCode: entry?.hsnCode ?? "",
    metalPurityId: entry?.metalPurityId ?? "",
    description: entry?.description ?? "",
    stockGroupId: entry?.stockGroupId ?? "",
    gross: "",
    net: "",
    pieces: "",
    wastage: percentText(entry?.wastageBasisPoints),
    makingMode: mode,
    making: mode === "percent" ? percentText(entry?.makingChargeValue) : moneyText(entry?.makingChargeValue),
    salePrice: moneyText(entry?.salePricePaise),
    purchasePrice: moneyText(entry?.purchasePricePaise),
    discountMode: (entry?.saleDiscountMode ?? "percent") as "percent" | "amount",
    discount: entry?.saleDiscountMode === "amount" ? moneyText(entry?.saleDiscountValue) : percentText(entry?.saleDiscountValue),
    taxConfigurationId: entry?.taxConfigurationId ?? "",
  };
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Add an item into a box (with its opening gross weight, net weight and
 * pieces), or edit the details of one already in it. Everything the bill
 * needs is entered here: HSN, purity, wastage, making, prices, discount,
 * tax, stock group and description. Category comes from the item.
 */
export function BoxEntryForm({ box, entry, onDone }: { box: BoxRow; entry?: BoxEntryRow; onDone: () => void }) {
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalPurities.list);
  const groups = useQuery(api.stockGroups.list);
  const categories = useQuery(api.stockCategories.list);
  const taxes = useQuery(api.taxConfigurations.list);
  const pricing = useQuery(api.products.myPricingAccess);
  const showCost = pricing?.canViewCost ?? false;
  const add = useMutation(api.boxEntries.add);
  const update = useMutation(api.boxEntries.update);
  const [f, setF] = useState(() => formFrom(entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const isEdit = !!entry;

  const product = products?.find((p) => p._id === f.productId);
  const categoryName = product?.stockCategoryId ? categories?.find((c) => c._id === product.stockCategoryId)?.name : undefined;
  const purityOptions = (purities ?? []).filter((p) => p.isActive && (!box.metal || p.metal === box.metal));
  const takenProducts = new Set(((box as BoxRow & { entries?: BoxEntryRow[] }).entries ?? []).map((e) => e.productId as string));

  /** Item picked: its stock group, HSN, purity and saved prices fill the blanks. */
  function pickProduct(productId: string) {
    const p = products?.find((x) => x._id === productId);
    setF((prev) => ({
      ...prev,
      productId,
      stockGroupId: prev.stockGroupId || p?.stockGroupId || "",
      hsnCode: prev.hsnCode || p?.hsnCode || "",
      metalPurityId: prev.metalPurityId || (p?.metalPurityId && purityOptions.some((o) => o._id === p.metalPurityId) ? p.metalPurityId : ""),
      salePrice: prev.salePrice || moneyText(p?.salePricePaise),
      purchasePrice: prev.purchasePrice || moneyText(p?.purchasePricePaise),
      wastage: prev.wastage || percentText(p?.wastageBasisPoints),
      making: prev.making || moneyText(p?.makingChargePaise),
      taxConfigurationId: prev.taxConfigurationId || p?.taxConfigurationId || "",
    }));
  }

  function money(text: string, field: string) {
    if (!text.trim()) return undefined;
    const paise = rupeesToPaise(text);
    if (paise === null) throw new Error(`${field}: enter a valid amount.`);
    return paise;
  }
  function percent(text: string, field: string) {
    if (!text.trim()) return undefined;
    const bp = percentToBasisPoints(text);
    if (bp === null) throw new Error(`${field}: enter a percentage between 0 and 100.`);
    return bp;
  }

  async function save() {
    setError("");
    try {
      if (!f.productId) throw new Error("Choose the item to put in this box.");
      const details = {
        hsnCode: f.hsnCode.trim() || undefined,
        metalPurityId: (f.metalPurityId || undefined) as Id<"metalPurities"> | undefined,
        description: f.description.trim() || undefined,
        stockGroupId: (f.stockGroupId || undefined) as Id<"stockGroups"> | undefined,
        wastageBasisPoints: percent(f.wastage, "Wastage"),
        makingChargeMode: f.makingMode,
        makingChargeValue: f.makingMode === "percent" ? percent(f.making, "Making") : money(f.making, "Making"),
        salePricePaise: money(f.salePrice, "Sale price"),
        purchasePricePaise: showCost ? money(f.purchasePrice, "Purchase price") : undefined,
        saleDiscountMode: f.discountMode,
        saleDiscountValue: f.discountMode === "percent" ? percent(f.discount, "Discount") : money(f.discount, "Discount"),
        taxConfigurationId: (f.taxConfigurationId || undefined) as Id<"taxConfigurations"> | undefined,
      };
      setBusy(true);
      if (isEdit) {
        await update({ entryId: entry._id, ...details });
        toast.success(`${entry.productName} updated in Box ${box.boxNumber}`);
      } else {
        const gross = f.gross.trim() ? gramsToMg(f.gross) : 0;
        const net = f.net.trim() ? gramsToMg(f.net) : gross;
        const pieces = f.pieces.trim() ? Number(f.pieces) : 0;
        if (!Number.isFinite(gross) || gross < 0 || !Number.isFinite(net) || net < 0) throw new Error("Enter valid gross and net weights in grams.");
        if (net > gross) throw new Error("Net weight cannot be more than the gross weight.");
        if (!Number.isInteger(pieces) || pieces < 0) throw new Error("Pieces must be a whole number.");
        await add({ boxId: box._id, productId: f.productId as Id<"products">, ...details, grossWeightMg: gross, netWeightMg: net, pieces });
        toast.success(`${product?.name ?? "Item"} added to Box ${box.boxNumber}`);
      }
      onDone();
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save this item."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-x-3 gap-y-2.5 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-3 lg:col-span-4">
        {isEdit ? `Edit ${entry.productName} in Box ${box.boxNumber}` : `Add item to Box ${box.boxNumber}`}
      </p>
      <Field label="Item *" className="sm:col-span-2">
        {isEdit ? (
          <Input value={entry.productName} disabled />
        ) : (
          <select aria-label="Item" className={selectClass} value={f.productId} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">Choose item</option>
            {products?.filter((p) => p.isActive && p.itemType !== "service" && !takenProducts.has(p._id)).map((p) => (
              <option key={p._id} value={p._id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Category (from item)">
        <Input value={(isEdit ? entry.categoryName : categoryName) ?? "—"} disabled />
      </Field>
      <Field label="Stock group">
        <select aria-label="Stock group" className={selectClass} value={f.stockGroupId} onChange={(e) => set("stockGroupId", e.target.value)}>
          <option value={NONE}>None</option>
          {groups?.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
        </select>
      </Field>
      <Field label="HSN code">
        <Input aria-label="HSN code" list="box-hsn-codes" value={f.hsnCode} maxLength={12} placeholder="e.g. 7113" onChange={(e) => set("hsnCode", e.target.value)} />
        <datalist id="box-hsn-codes">{HSN_SUGGESTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</datalist>
      </Field>
      <Field label="Purity">
        <select aria-label="Purity" className={selectClass} value={f.metalPurityId} onChange={(e) => set("metalPurityId", e.target.value)}>
          <option value={NONE}>—</option>
          {purityOptions.map((p) => <option key={p._id} value={p._id}>{p.label} ({p.metal === "gold" ? "Gold" : "Silver"})</option>)}
        </select>
      </Field>
      {!isEdit && (
        <>
          <Field label="Gross wt (g)"><Input aria-label="Gross weight" inputMode="decimal" placeholder="0.000" value={f.gross} onChange={(e) => setF((prev) => ({ ...prev, gross: e.target.value, net: prev.net === "" || prev.net === prev.gross ? e.target.value : prev.net }))} /></Field>
          <Field label="Net wt (g)"><Input aria-label="Net weight" inputMode="decimal" placeholder="0.000" value={f.net} onChange={(e) => set("net", e.target.value)} /></Field>
          <Field label="Pieces"><Input aria-label="Pieces" inputMode="numeric" placeholder="0" value={f.pieces} onChange={(e) => set("pieces", e.target.value)} /></Field>
        </>
      )}
      <Field label="Wastage (%)"><Input aria-label="Wastage percent" inputMode="decimal" placeholder="0" value={f.wastage} onChange={(e) => set("wastage", e.target.value)} /></Field>
      <Field label="Making charge">
        <div className="flex gap-1">
          <select aria-label="Making charge type" className="h-9 rounded-md border bg-background px-1 text-sm" value={f.makingMode} onChange={(e) => set("makingMode", e.target.value as MakingMode)}>
            <option value="fixed">₹</option>
            <option value="per_gram">₹/g</option>
            <option value="percent">%</option>
          </select>
          <Input aria-label="Making charge" inputMode="decimal" placeholder="0" value={f.making} onChange={(e) => set("making", e.target.value)} />
        </div>
      </Field>
      <Field label="Sale price (₹/pc)"><Input aria-label="Sale price" inputMode="decimal" placeholder="blank = by rate/g" value={f.salePrice} onChange={(e) => set("salePrice", e.target.value)} /></Field>
      {showCost && <Field label="Purchase price (₹/pc)"><Input aria-label="Purchase price" inputMode="decimal" placeholder="0.00" value={f.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} /></Field>}
      <Field label="Discount">
        <div className="flex gap-1">
          <Input aria-label="Discount" inputMode="decimal" placeholder="0" value={f.discount} onChange={(e) => set("discount", e.target.value)} />
          <select aria-label="Discount type" className="h-9 rounded-md border bg-background px-1 text-sm" value={f.discountMode} onChange={(e) => set("discountMode", e.target.value as "percent" | "amount")}>
            <option value="percent">%</option>
            <option value="amount">₹</option>
          </select>
        </div>
      </Field>
      <Field label="Tax">
        <select aria-label="Tax" className={selectClass} value={f.taxConfigurationId} onChange={(e) => set("taxConfigurationId", e.target.value)}>
          <option value={NONE}>None</option>
          {taxes?.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Description" className="sm:col-span-3 lg:col-span-4">
        <Input aria-label="Description" maxLength={300} placeholder="Design, stones, notes…" value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      {!isEdit && <p className="text-xs text-muted-foreground sm:col-span-3 lg:col-span-4">Gross weight, net weight and pieces are the opening stock of this item in the box. Later changes come from purchases, sales, adjustments and transfers.</p>}
      {error && <p role="alert" className="text-sm text-destructive sm:col-span-3 lg:col-span-4">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-3 lg:col-span-4">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : isEdit ? "Save" : "Add to box"}</Button>
      </div>
    </form>
  );
}

/** The list of items inside a box, with add / edit / remove. */
export function BoxItemsSection({ box, entries }: { box: BoxRow; entries: BoxEntryRow[] }) {
  const purities = useQuery(api.metalPurities.list);
  const remove = useMutation(api.boxEntries.remove);
  const [editing, setEditing] = useState<string | "new" | null>(entries.length === 0 ? "new" : null);
  const assignedWeight = entries.reduce((sum, e) => sum + e.weightMg, 0);
  const assignedPieces = entries.reduce((sum, e) => sum + e.pieces, 0);
  const freeWeight = box.weightMg - assignedWeight;
  const freePieces = box.pieces - assignedPieces;
  const purityLabel = (id?: string) => purities?.find((p) => p._id === id)?.label ?? "—";

  async function removeEntry(entry: BoxEntryRow) {
    try {
      await remove({ entryId: entry._id });
      toast.success(`${entry.productName} removed from Box ${box.boxNumber}`);
    } catch (e) {
      toast.error(getUserErrorMessage(e, "Could not remove this item."));
    }
  }

  const editingEntry = editing && editing !== "new" ? entries.find((e) => e._id === editing) : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items in this box ({entries.length})</p>
        {editing === null && box.isActive && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" />Add item</Button>
        )}
      </div>
      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-xs [&_tbody_tr:hover]:bg-muted/30">
            <thead className="bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">ITEM</th>
                <th className="px-2 py-1.5">CATEGORY</th>
                <th className="px-2 py-1.5">PURITY</th>
                <th className="px-2 py-1.5">HSN</th>
                <th className="px-2 py-1.5 text-right">PCS</th>
                <th className="px-2 py-1.5 text-right">GROSS (g)</th>
                <th className="px-2 py-1.5 text-right">NET (g)</th>
                <th className="px-2 py-1.5 text-right">SALE PRICE</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e._id}>
                  <td className="px-2 py-1.5 font-medium">{e.productName}{e.sku && <span className="ml-1 text-[10px] text-muted-foreground">({e.sku})</span>}</td>
                  <td className="px-2 py-1.5">{e.categoryName ?? "—"}</td>
                  <td className="px-2 py-1.5">{purityLabel(e.metalPurityId)}</td>
                  <td className="px-2 py-1.5">{e.hsnCode ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.pieces}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{mgToGramsDisplay(e.weightMg)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-emerald-600">{mgToGramsDisplay(e.netWeightMg)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.salePricePaise ? `${formatPaise(e.salePricePaise)}/pc` : "by rate/g"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${e.productName}`} onClick={() => setEditing(e._id)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Remove ${e.productName}`} disabled={e.weightMg !== 0 || e.pieces !== 0} title={e.weightMg !== 0 || e.pieces !== 0 ? "Only an item with no stock left can be removed" : "Remove from box"} onClick={() => removeEntry(e)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
              {(freeWeight !== 0 || freePieces !== 0) && (
                <tr className="text-muted-foreground">
                  <td className="px-2 py-1.5 italic" colSpan={4}>Not assigned to an item (older stock)</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{freePieces}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{mgToGramsDisplay(freeWeight)}</td>
                  <td colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {entries.length === 0 && editing === null && <p className="text-sm text-muted-foreground">No items in this box yet.</p>}
      {editing === "new" && <BoxEntryForm key="new" box={box} onDone={() => setEditing(null)} />}
      {editingEntry && <BoxEntryForm key={editingEntry._id} box={box} entry={editingEntry} onDone={() => setEditing(null)} />}
    </div>
  );
}

export type { Metal };
