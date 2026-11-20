"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteRecordButton } from "@/components/delete-record-button";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useBoxes } from "@/hooks/use-boxes";
import { api } from "../../../../convex/_generated/api";
import { Package, Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { METAL_LABEL } from "@/lib/box-label";
import { toast } from "@/components/toaster";
import { BoxItemsSection, type BoxEntryRow } from "@/components/box-items";

type Metal = "gold" | "silver";

const BOX_CATEGORIES = ["Ring Box", "Chain Box", "Necklace Box", "Bangle Box", "Bracelet Box", "Earring Box", "Pendant Box", "General Jewellery Box"];
const BOX_TYPES = ["Display Tray", "Counter Box", "Locker", "Storage Box", "Showcase"];

/** Box category (preset list, keeps any saved value) and box type (free text with suggestions). */
function CategoryTypeFields({ idPrefix, category, boxType, onCategory, onBoxType }: { idPrefix: string; category: string; boxType: string; onCategory: (v: string) => void; onBoxType: (v: string) => void }) {
  return (
    <>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-category`}>Box category</Label>
        <select id={`${idPrefix}-category`} className="h-9 rounded-md border bg-background px-3 text-sm" value={category} onChange={(e) => onCategory(e.target.value)}>
          <option value="">Not set</option>
          {[...new Set([...BOX_CATEGORIES, ...(category ? [category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-type`}>Box type</Label>
        <Input id={`${idPrefix}-type`} list="box-types" maxLength={40} placeholder="e.g. Display Tray" value={boxType} onChange={(e) => onBoxType(e.target.value)} />
        <datalist id="box-types">{BOX_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
    </>
  );
}
type BoxRow = Doc<"boxes"> & { weightMg: number; pieces: number; entries: BoxEntryRow[] };

const SOURCE_LABEL: Record<string, string> = {
  box_opening: "Opening stock",
  purchases: "Purchase",
  sales: "Sale",
  stock_adjustments: "Adjustment",
  box_transfers: "Box transfer",
};

function MetalSelect({ id, value, onChange }: { id: string; value: Metal | ""; onChange: (value: Metal | "") => void }) {
  return (
    <select id={id} className="h-9 rounded-md border bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value as Metal | "")}>
      <option value="">Choose metal</option>
      <option value="gold">Gold</option>
      <option value="silver">Silver</option>
    </select>
  );
}

function StatTile({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-xs">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}</p>
    </div>
  );
}

/** Box serial number (unique), metal, name, category, location and description. Its items and their stock are added next. */
function CreateBoxForm({ onCreated }: { onCreated: (boxId: Id<"boxes">) => void }) {
  const createNext = useMutation(api.boxes.createNext);
  const [boxNumber, setBoxNumber] = useState("");
  const [metal, setMetal] = useState<Metal | "">("");
  const [location, setLocation] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [boxType, setBoxType] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setError("");
    setDone("");
    const number = Number(boxNumber);
    if (!boxNumber.trim() || !Number.isInteger(number) || number < 1) return setError("Enter the box serial number (a whole number).");
    if (!metal) return setError("Choose whether this box holds Gold or Silver.");
    setCreating(true);
    try {
      const boxId = await createNext({
        boxNumber: number,
        metal,
        label: label.trim() || undefined,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        category: category || undefined,
        boxType: boxType.trim() || undefined,
      });
      setDone(`Box ${number} created — now add the items that go in it.`);
      toast.success(`Box ${number} added`);
      setBoxNumber(""); setLabel(""); setDescription(""); setBoxType("");
      onCreated(boxId);
    } catch (e) {
      setError(getUserErrorMessage(e, "Unable to create box"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card size="sm" className="shadow-xs">
      <CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide"><Plus className="h-4 w-4 text-primary" />Create new box</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}>
          <div className="grid gap-1"><Label htmlFor="new-box-number">Box serial number *</Label><Input id="new-box-number" type="number" min="1" step="1" placeholder="101" value={boxNumber} onChange={(e) => setBoxNumber(e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="new-box-metal">Metal *</Label><MetalSelect id="new-box-metal" value={metal} onChange={setMetal} /></div>
          <div className="grid gap-1"><Label htmlFor="new-box-label">Box name</Label><Input id="new-box-label" maxLength={60} placeholder="e.g. Silver Chains" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <CategoryTypeFields idPrefix="new-box" category={category} boxType={boxType} onCategory={setCategory} onBoxType={setBoxType} />
          <div className="grid gap-1"><Label htmlFor="new-box-location">Godown / location</Label><Input id="new-box-location" maxLength={60} placeholder="Main Shop" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          <div className="grid gap-1 sm:col-span-2"><Label htmlFor="new-box-description">Box description</Label><Input id="new-box-description" maxLength={200} placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Each box number is unique. After creating the box, add the items inside it — each item with its HSN, purity, gross and net weight, pieces, wastage, making, prices, discount and tax. One box can hold several items (e.g. necklaces and a few small rings).</p>
          <Button type="submit" disabled={creating} className="sm:col-span-2"><Plus className="h-4 w-4" />{creating ? "Creating…" : "Create Box"}</Button>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          {done && <p role="status" className="text-sm text-success sm:col-span-2">{done}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

/** Edit a box's number, name, metal, location, description and active state. Stock changes go through Stock Adjustments. */
function BoxEditForm({ box }: { box: BoxRow }) {
  const updateBox = useMutation(api.boxes.update);
  const [number, setNumber] = useState(String(box.boxNumber));
  const [label, setLabel] = useState(box.label ?? "");
  const [metal, setMetal] = useState<Metal | "">(box.metal ?? "");
  const [location, setLocation] = useState(box.location ?? "");
  const [description, setDescription] = useState(box.description ?? "");
  const [category, setCategory] = useState(box.category ?? "");
  const [boxType, setBoxType] = useState(box.boxType ?? "");
  const [isActive, setIsActive] = useState(box.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setError("");
    setSaved(false);
    const parsed = Number(number);
    if (!Number.isInteger(parsed) || parsed < 1) return setError("Enter a positive whole box number.");
    setBusy(true);
    try {
      await updateBox({ boxId: box._id, boxNumber: parsed, label: label.trim() || undefined, metal: metal || undefined, location: location.trim(), description: description.trim(), category, boxType: boxType.trim(), isActive });
      setSaved(true);
      toast.success(`Box ${parsed} updated`);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not update the box."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Box details</p>
      <div className="grid gap-1"><Label htmlFor="edit-box-number">Box no.</Label><Input id="edit-box-number" type="number" min="1" step="1" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
      <div className="grid gap-1"><Label htmlFor="edit-box-metal">Metal</Label><MetalSelect id="edit-box-metal" value={metal} onChange={setMetal} /></div>
      <div className="grid gap-1"><Label htmlFor="edit-box-label">Box name</Label><Input id="edit-box-label" value={label} maxLength={60} placeholder="e.g. Chains" onChange={(e) => setLabel(e.target.value)} /></div>
      <CategoryTypeFields idPrefix="edit-box" category={category} boxType={boxType} onCategory={setCategory} onBoxType={setBoxType} />
      <div className="grid gap-1"><Label htmlFor="edit-box-location">Godown / location</Label><Input id="edit-box-location" value={location} maxLength={60} onChange={(e) => setLocation(e.target.value)} /></div>
      <div className="grid gap-1 sm:col-span-2"><Label htmlFor="edit-box-description">Description</Label><Input id="edit-box-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />Active box (can be billed from)</label>
      <Button type="submit" disabled={busy} className="sm:justify-self-end">{busy ? "Saving…" : "Save"}</Button>
      {error && <p role="alert" className="text-xs text-destructive sm:col-span-2">{error}</p>}
      {saved && <p role="status" className="text-xs text-success sm:col-span-2">Box updated.</p>}
    </form>
  );
}

function BoxDetailDialog({ box, onClose }: { box: BoxRow; onClose: () => void }) {
  const movements = useQuery(api.boxes.movements, { boxId: box._id });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="erp-scroll max-h-[92svh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Box {box.boxNumber}{box.label ? ` · ${box.label}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <StatTile label="Available weight" value={mgToGramsDisplay(box.weightMg)} unit="g" />
          <StatTile label="Pieces" value={String(box.pieces)} />
          <div className="flex flex-wrap gap-2 sm:flex-col">
            <Button asChild variant="outline" size="sm"><Link href="/inventory/adjustments">Add / deduct stock</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/boxes/transfers">Transfer to another box</Link></Button>
          </div>
        </div>
        <BoxItemsSection box={box} entries={box.entries} />
        <div className="grid items-start gap-3 lg:grid-cols-2">
        <BoxEditForm key={`${box._id}-${box.boxNumber}-${box.metal ?? ""}`} box={box} />
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent stock movements</p>
          {movements === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock movements yet.</p>
          ) : (
            <ul className="erp-scroll flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border text-sm">
              {movements.map((m) => (
                <li key={m._id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{SOURCE_LABEL[m.sourceTable] ?? m.sourceTable}{m.productName ? ` · ${m.productName}` : ""}</p>
                    <p className="truncate text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleDateString("en-IN")}{m.note ? ` · ${m.note}` : ""}</p>
                  </div>
                  <span className={`shrink-0 font-mono tabular-nums ${m.direction === "in" ? "text-success" : "text-destructive"}`}>
                    {m.direction === "in" ? "+" : "−"}{mgToGramsDisplay(m.netWeightMg)} g{m.quantity ? ` · ${m.quantity} pcs` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One-time: copy each item's saved details into its default box (for boxes set up before items lived in boxes). */
function SetupFromItemList() {
  const access = useQuery(api.organizations.getMyAccess);
  const products = useQuery(api.products.list);
  const boxes = useBoxes();
  const setup = useMutation(api.boxEntries.setupFromItemList);
  const [busy, setBusy] = useState(false);
  const role = access?.membership?.role;
  const pending = (products ?? []).filter(
    (p) => p.defaultBoxId && !p.deletedAt && !(boxes ?? []).find((b) => b._id === p.defaultBoxId)?.entries.some((e) => e.productId === p._id),
  ).length;
  if (!pending || (role !== "owner" && role !== "admin")) return null;
  async function run() {
    setBusy(true);
    try {
      const r = await setup({});
      toast.success(`${r.itemsAdded} item${r.itemsAdded === 1 ? "" : "s"} added to their boxes`);
    } catch (e) {
      toast.error(getUserErrorMessage(e, "Could not set up box items."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card size="sm" className="shrink-0 border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>{pending} item{pending === 1 ? " has" : "s have"} a box set in the Item List but {pending === 1 ? "is" : "are"} not listed inside that box yet. Copy their HSN, purity, prices and charges into their boxes?</p>
        <Button type="button" size="sm" disabled={busy} onClick={run}>{busy ? "Setting up…" : "Add items to their boxes"}</Button>
      </CardContent>
    </Card>
  );
}

export default function BoxOverviewPage() {
  const boxes = useBoxes();
  const products = useQuery(api.products.list);
  const [search, setSearch] = useState("");
  const [metalFilter, setMetalFilter] = useState<Metal | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedBox, setSelectedBox] = useState<Id<"boxes"> | null>(null);

  const stats = useMemo(() => {
    const active = boxes?.filter((b) => b.isActive) ?? [];
    const sum = (rows: BoxRow[]) => rows.reduce((total, b) => total + b.weightMg, 0);
    return {
      totalBoxes: active.length,
      weightMg: sum(active),
      pieces: active.reduce((total, b) => total + b.pieces, 0),
      goldMg: sum(active.filter((b) => b.metal === "gold")),
      silverMg: sum(active.filter((b) => b.metal === "silver")),
      unsetCount: active.filter((b) => !b.metal).length,
    };
  }, [boxes]);

  const filtered = useMemo(() => {
    if (!boxes) return undefined;
    const q = search.trim().toLowerCase();
    return boxes.filter((b) =>
      (!metalFilter || b.metal === metalFilter) &&
      (!categoryFilter || b.category === categoryFilter) &&
      (!q || String(b.boxNumber).includes(q) || [b.label, b.location, b.description, b.category, b.boxType].some((text) => text?.toLowerCase().includes(q))),
    );
  }, [boxes, search, metalFilter, categoryFilter]);
  const categoriesInUse = useMemo(() => [...new Set((boxes ?? []).map((b) => b.category).filter((c): c is string => Boolean(c)))].sort(), [boxes]);

  // Live record, so the dialog follows saved changes.
  const selectedBoxRecord = selectedBox ? boxes?.find((b) => b._id === selectedBox) : undefined;

  const selection = useRecordSelection(filtered?.map((box) => box._id) ?? [], `boxes:${search}:${metalFilter}:${categoryFilter}`);

  return (
    <>
      <div className="erp-fill flex w-full flex-col gap-3">
        <div className="shrink-0">
          <h1 className="text-xl font-bold tracking-tight">Box Overview</h1>
          <p className="text-xs text-muted-foreground">Box-wise stock and weight. Sales deduct the gross weight from the selected box; purchases add to it.</p>
        </div>

        {/* Totals and metal-wise stock in one row */}
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Total boxes" value={boxes ? String(stats.totalBoxes) : "—"} />
          <StatTile label="Total stock weight" value={boxes ? mgToGramsDisplay(stats.weightMg) : "—"} unit="g" />
          <StatTile label="Total pieces" value={boxes ? String(stats.pieces) : "—"} />
          <StatTile label="Active items" value={products ? String(products.filter((p) => p.isActive).length) : "—"} />
          <StatTile label="Gold" value={mgToGramsDisplay(stats.goldMg)} unit="g" tone="text-amber-600 dark:text-amber-400" />
          <StatTile label="Silver" value={mgToGramsDisplay(stats.silverMg)} unit="g" tone="text-slate-500 dark:text-slate-300" />
        </div>
        {stats.unsetCount > 0 && (
          <p className="shrink-0 text-xs text-amber-600">{stats.unsetCount} box{stats.unsetCount === 1 ? " has" : "es have"} no metal set — open the box and choose Gold or Silver so it is counted here and billing can check it.</p>
        )}

        <SetupFromItemList />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
          <div className="erp-scroll min-h-0 lg:overflow-y-auto">
            <CreateBoxForm onCreated={setSelectedBox} />
          </div>

          {/* Box list: search and filters on top, list scrolls inside */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/20 p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-9" placeholder="Search box number, name or location" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select aria-label="Filter by metal" className="h-9 rounded-md border bg-background px-3 text-sm" value={metalFilter} onChange={(e) => setMetalFilter(e.target.value as Metal | "")}>
            <option value="">All metals</option>
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
          </select>
          <select aria-label="Filter by box category" className="h-9 rounded-md border bg-background px-3 text-sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categoriesInUse.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <BulkRecordActions selection={selection} table="boxes" />
        <div className="erp-scroll max-h-[70vh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
        {filtered === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{boxes?.length ? "No boxes match your search." : "No boxes yet. Create your first box on the left."}</p>
        ) : (
              <ul className="divide-y">
                {filtered.map((box) => (
                  <li key={box._id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30 ${selection.has(box._id) ? "bg-primary/5" : ""} ${box.isActive ? "" : "opacity-60"}`}>
                    <Checkbox aria-label={`Select Box ${box.boxNumber}`} checked={selection.has(box._id)} onCheckedChange={() => selection.toggle(box._id)} />
                    <button type="button" onClick={() => setSelectedBox(box._id)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View Box ${box.boxNumber}`}>
                      <span className="flex min-w-0 items-center gap-3">
                        <Package className="h-5 w-5 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block font-semibold">Box {box.boxNumber}{box.label ? <span className="font-normal text-muted-foreground"> · {box.label}</span> : null}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {box.metal ? <Badge variant="outline" className="font-normal">{METAL_LABEL[box.metal]}</Badge> : <Badge variant="outline" className="border-amber-500/50 font-normal text-amber-600">Metal not set</Badge>}
                            {box.category && <span>{box.category}</span>}
                            {box.boxType && <span>· {box.boxType}</span>}
                            {box.location && <span>· {box.location}</span>}
                            {box.entries.length > 0 && <span className="truncate">· {box.entries.map((e) => e.productName).join(", ")}</span>}
                            {!box.isActive && <Badge variant="secondary" className="font-normal">Inactive</Badge>}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold tabular-nums">{mgToGramsDisplay(box.weightMg)} g</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">{box.pieces} pieces</span>
                      </span>
                    </button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSelectedBox(box._id)} aria-label={`Edit Box ${box.boxNumber}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteRecordButton table="boxes" id={box._id} name={`Box ${box.boxNumber}`} />
                  </li>
                ))}
              </ul>
        )}
        </div>
          </div>
        </div>

        {selectedBoxRecord && <BoxDetailDialog box={selectedBoxRecord} onClose={() => setSelectedBox(null)} />}
      </div>
    </>
  );
}
