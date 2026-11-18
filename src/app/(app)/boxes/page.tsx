"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteRecordButton } from "@/components/delete-record-button";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Check, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Id } from "../../../../convex/_generated/dataModel";
import { gramsToMg, mgToGramsDisplay } from "@/lib/jewelry-calc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BoxScreensGate } from "@/components/privacy-lock-gate";

function BoxItemRow({ item }: { item: { _id: Id<"boxItems">; label: string; netWeightMg: number } }) {
  const renameItem = useMutation(api.boxes.renameItem);
  const writeOff = useMutation(api.stockAdjustments.writeOff);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("Removed from box");
  const [draft, setDraft] = useState(item.label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await renameItem({ boxItemId: item._id, label: draft });
      setEditing(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not rename this item"));
    } finally {
      setSaving(false);
    }
  }

  // Removal is an audited write-off (stock movement + log), not a silent delete.
  async function remove() {
    setSaving(true);
    setError("");
    try {
      await writeOff({ boxItemId: item._id, reason: deleteReason.trim() || "Removed from box" });
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not remove this item"));
      setSaving(false);
    }
  }

  if (confirmingDelete) {
    return (
      <li className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-medium">Remove {item.label} ({(item.netWeightMg / 1000).toFixed(3)}g) from this box?</p>
        <Input aria-label="Reason for removing" value={deleteReason} maxLength={200} onChange={(e) => setDeleteReason(e.target.value)} className="h-8" />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setConfirmingDelete(false); setError(""); }}>Cancel</Button>
          <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={remove}><Trash2 className="h-3.5 w-3.5" />{saving ? "Removing…" : "Remove"}</Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </li>
    );
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="h-8"
          />
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={saving} onClick={save} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setEditing(false);
              setDraft(item.label);
              setError("");
            }}
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
      <span>
        {item.label} — {(item.netWeightMg / 1000).toFixed(3)}g net
      </span>
      <span className="flex shrink-0 items-center gap-1">
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEditing(true)} aria-label={`Rename ${item.label}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmingDelete(true)} aria-label={`Remove ${item.label}`} title="Remove from box">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      </span>
    </li>
  );
}

/** Edit a box's number and label — works for empty boxes too. */
function BoxEditForm({ box }: { box: { _id: Id<"boxes">; boxNumber: number; label?: string } }) {
  const updateBox = useMutation(api.boxes.update);
  const [number, setNumber] = useState(String(box.boxNumber));
  const [label, setLabel] = useState(box.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = number.trim() !== String(box.boxNumber) || label.trim() !== (box.label ?? "");

  async function save() {
    setError("");
    setSaved(false);
    const parsed = Number(number);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError("Enter a positive whole box number.");
      return;
    }
    setBusy(true);
    try {
      await updateBox({ boxId: box._id, boxNumber: parsed, label: label.trim() || undefined });
      setSaved(true);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not update the box."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit box</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="edit-box-number" className="text-xs text-muted-foreground">Box no.</label>
          <Input id="edit-box-number" type="number" min="1" step="1" value={number} onChange={(e) => { setNumber(e.target.value); setSaved(false); }} className="w-24" />
        </div>
        <div className="grid min-w-40 flex-1 gap-1">
          <label htmlFor="edit-box-label" className="text-xs text-muted-foreground">Label</label>
          <Input id="edit-box-label" value={label} maxLength={60} placeholder="e.g. Chains" onChange={(e) => { setLabel(e.target.value); setSaved(false); }} />
        </div>
        <Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {saved && !dirty && <p role="status" className="text-xs text-success">Box updated.</p>}
    </form>
  );
}

const NEW_PRODUCT = "__new__";

/** Put one piece straight into a box (empty or not) without recording a purchase. */
function AddBoxItemForm({ boxId }: { boxId: Id<"boxes"> }) {
  const products = useQuery(api.products.list);
  const quickAddItem = useMutation(api.boxes.quickAddItem);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [label, setLabel] = useState("");
  const [gross, setGross] = useState("");
  const [stone, setStone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  const grossMg = gramsToMg(gross || "0");
  const stoneMg = gramsToMg(stone || "0");
  const netMg = Math.max(0, grossMg - stoneMg);

  async function add() {
    setError("");
    setAdded("");
    if (!label.trim()) return setError("Enter the item name, e.g. Ring.");
    if (!productId) return setError("Choose a product, or pick “New product”.");
    if (productId === NEW_PRODUCT && !newProductName.trim()) return setError("Enter the new product name.");
    if (!(Number(gross) > 0)) return setError("Enter the gross weight in grams.");
    if (stone && !(Number(stone) >= 0)) return setError("Stone weight must be 0 or more.");
    if (stoneMg > grossMg) return setError("Stone weight can’t be more than gross weight.");
    setBusy(true);
    try {
      await quickAddItem({
        boxId,
        productId: productId === NEW_PRODUCT ? undefined : (productId as Id<"products">),
        newProductName: productId === NEW_PRODUCT ? newProductName.trim() : undefined,
        label: label.trim(),
        grossWeightMg: grossMg,
        stoneWeightMg: stoneMg,
      });
      setAdded(`${label.trim()} added.`);
      // Keep the product selected for quickly adding several pieces of the same kind.
      setLabel("");
      setGross("");
      setStone("");
      if (productId === NEW_PRODUCT) {
        setProductId("");
        setNewProductName("");
      }
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not add the item."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />Add item to this box
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add item</p>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Close add item" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Product</label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger aria-label="Product"><SelectValue placeholder={products === undefined ? "Loading…" : "Choose product"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_PRODUCT}>+ New product…</SelectItem>
              {products?.map((product) => <SelectItem key={product._id} value={product._id}>{product.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {productId === NEW_PRODUCT ? (
          <div className="grid gap-1">
            <label htmlFor="new-product-name" className="text-xs text-muted-foreground">New product name</label>
            <Input id="new-product-name" value={newProductName} maxLength={80} placeholder="e.g. Gold ring" onChange={(e) => setNewProductName(e.target.value)} />
          </div>
        ) : <span className="hidden sm:block" />}
        <div className="grid gap-1 sm:col-span-2">
          <label htmlFor="new-item-label" className="text-xs text-muted-foreground">Item name / label</label>
          <Input id="new-item-label" value={label} maxLength={80} placeholder="e.g. Ring" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="new-item-gross" className="text-xs text-muted-foreground">Gross weight (g)</label>
          <Input id="new-item-gross" inputMode="decimal" placeholder="0.000" value={gross} onChange={(e) => setGross(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="new-item-stone" className="text-xs text-muted-foreground">Stone weight (g)</label>
          <Input id="new-item-stone" inputMode="decimal" placeholder="0.000" value={stone} onChange={(e) => setStone(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Net: <strong className="text-foreground">{mgToGramsDisplay(netMg)}g</strong></span>
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add to box"}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {added && <p role="status" className="text-xs text-success">{added}</p>}
    </form>
  );
}

function BoxDetailDialog({
  box,
  onClose,
}: {
  box: { _id: Id<"boxes">; boxNumber: number; label?: string };
  onClose: () => void;
}) {
  const items = useQuery(api.boxes.getItems, { boxId: box._id });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Box {box.boxNumber}{box.label ? ` · ${box.label}` : ""}</DialogTitle>
        </DialogHeader>
        <BoxEditForm key={`${box.boxNumber}-${box.label ?? ""}`} box={box} />
        <AddBoxItemForm boxId={box._id} />
        {items === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Package className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This box is empty. Use “Add item to this box” above, or record a purchase.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <BoxItemRow key={item._id} item={item} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function BoxOverviewPage() {
  const boxes = useQuery(api.boxes.list);
  const boxReport = useQuery(api.reports.getBoxReport);
  const reportByBoxId = useMemo(() => new Map((boxReport ?? []).map((row) => [row.boxId, row])), [boxReport]);
  const createNext = useMutation(api.boxes.createNext);
  const [search, setSearch] = useState("");
  const itemMatches = useQuery(api.boxes.searchItems, search.trim().length >= 2 ? { term: search } : "skip");
  const [selectedBox, setSelectedBox] = useState<Id<"boxes"> | null>(null);
  const [boxNumber, setBoxNumber] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    if (!boxes) return undefined;
    const q = search.trim();
    if (!q) return boxes;
    return boxes.filter(
      (b) =>
        String(b.boxNumber).includes(q) ||
        b.label?.toLowerCase().includes(q.toLowerCase()),
    );
  }, [boxes, search]);

  // Live record, so the dialog title and edit form follow saved changes.
  const selectedBoxRecord = selectedBox ? boxes?.find((b) => b._id === selectedBox) : undefined;

  const selection = useRecordSelection(
    filtered?.map((box) => box._id) ?? [],
    `boxes:${search}`,
  );

  async function handleCreate() {
    setCreating(true);
    try {
      setError("");
      if (!boxNumber.trim()) throw new Error("Enter a box number");
      await createNext({ boxNumber: Number(boxNumber), label });
      setBoxNumber("");
      setLabel("");
    } catch (e) {
      setError(getUserErrorMessage(e, "Unable to create box"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <BoxScreensGate>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Box Overview
          </h1>
          <p className="text-sm text-muted-foreground">
            {boxes?.length ?? 0} boxes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Box number"
            type="number"
            min="1"
            step="1"
            value={boxNumber}
            onChange={(e) => setBoxNumber(e.target.value)}
            placeholder="Box no."
            className="w-28"
          />
          <Input
            aria-label="Box label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-44"
          />
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="h-4 w-4" />
            {creating ? "Creating…" : "Create Box"}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search box number, or an item like 'ring'"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {itemMatches && itemMatches.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">
            Items matching &quot;{search}&quot; — {itemMatches.length} found
          </p>
          <div className="flex flex-col gap-1">
            {itemMatches.map((item) => (
              <button
                type="button"
                key={item.boxItemId}
                onClick={() => item.boxId && setSelectedBox(item.boxId)}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span>
                  {item.label} <span className="text-muted-foreground">· {item.productName}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  Box {item.boxNumber ?? "—"} · {(item.netWeightMg / 1000).toFixed(3)}g
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <BulkRecordActions selection={selection} table="boxes" />
      {filtered === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No boxes match your search.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map((box) => (
            <Card
              key={box._id}
              className={`relative gap-2 py-5 text-center transition-all hover:shadow-md ${selection.has(box._id) ? "ring-2 ring-primary bg-primary/5" : ""}`}
            >
              <CardContent className="flex flex-col items-center gap-1 px-2">
                <Checkbox
                  className="absolute left-3 top-3"
                  aria-label={`Select Box ${box.boxNumber}`}
                  checked={selection.has(box._id)}
                  onCheckedChange={() => selection.toggle(box._id)}
                />
                <button
                  type="button"
                  onClick={() => setSelectedBox(box._id)}
                  className="flex w-full flex-col items-center gap-2 rounded-lg py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`View Box ${box.boxNumber}`}
                >
                  <Package className="h-5 w-5 text-primary" />
                  <p className="text-lg font-semibold">{box.boxNumber}</p>
                  {box.label && (
                    <p className="truncate text-xs text-muted-foreground">
                      {box.label}
                    </p>
                  )}
                  <Badge variant="secondary" className="text-xs font-normal">
                    {(reportByBoxId.get(box._id)?.itemCount ?? box.itemCount)
                      ? `${reportByBoxId.get(box._id)?.itemCount ?? box.itemCount} item${(reportByBoxId.get(box._id)?.itemCount ?? box.itemCount) === 1 ? "" : "s"}`
                      : "Empty"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {mgToGramsDisplay(reportByBoxId.get(box._id)?.currentPhysicalWeightMg ?? 0)}g net
                  </span>
                </button>
                <div className="flex flex-wrap items-center justify-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => setSelectedBox(box._id)}
                    aria-label={`Edit Box ${box.boxNumber}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <DeleteRecordButton
                    table="boxes"
                    id={box._id}
                    name={`Box ${box.boxNumber}`}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedBoxRecord && (
        <BoxDetailDialog
          box={selectedBoxRecord}
          onClose={() => setSelectedBox(null)}
        />
      )}
      </div>
    </BoxScreensGate>
  );
}
