"use client";

import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, Search } from "lucide-react";
import type { Doc } from "../../convex/_generated/dataModel";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

import type { BoxEntryRow } from "@/components/box-items";

type BoxRow = Doc<"boxes"> & { weightMg: number; pieces: number; entries?: BoxEntryRow[] };
type Metal = "gold" | "silver";

/** One dropdown row: an item inside a box, or the box's stock not assigned to an item. */
type PickRow = {
  key: string;
  box: BoxRow;
  entry?: BoxEntryRow;
  itemName: string;
  sku?: string;
  purityLabel: string;
  pieces: number;
  weightMg: number;
  netWeightMg: number;
  price: string;
};

/**
 * Vyapar-style box dropdown: a searchable table with Box No, Item, Purity,
 * Pcs, Gross Wt, Net Wt and Price columns — one row per item inside each
 * box, with that item's own stock and price. Picking a row picks the box
 * and the item, and the bill line takes the item's details from the box.
 */
export function BoxPicker({
  boxes,
  purities,
  rateByPurity,
  value,
  metal,
  priceKind,
  emptyLabel,
  ariaLabel,
  onPick,
  triggerClassName,
  itemFirst = false,
  selectedItemName,
}: {
  boxes: BoxRow[];
  purities: Doc<"metalPurities">[];
  rateByPurity: Map<string, number>;
  value: string;
  /** Only boxes of this metal (plus boxes with no metal set). */
  metal?: Metal | "";
  priceKind: "sale" | "purchase";
  /** Label of the "no box" choice, e.g. "Loose GST stock". Omit to hide it. */
  emptyLabel?: string;
  ariaLabel: string;
  onPick: (boxId: string, entry?: BoxEntryRow) => void;
  /** Width of the button; defaults to a fixed width. */
  triggerClassName?: string;
  /**
   * Billing view: list and show the item, not the box number (box numbers are for the shop's
   * stock count and barcode labels). The box shows only when one item name is in several boxes.
   */
  itemFirst?: boolean;
  /** With itemFirst: the picked item's name, shown on the button. */
  selectedItemName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);

  const rows = useMemo(() => {
    const purityById = new Map(purities.map((p) => [p._id as string, p]));
    const out: PickRow[] = [];
    for (const box of boxes) {
      if (!box.isActive && box._id !== value) continue;
      if (metal && box.metal && box.metal !== metal) continue;
      const entries = box.entries ?? [];
      for (const entry of entries) {
        const purity = entry.metalPurityId ? purityById.get(entry.metalPurityId) : undefined;
        const pricePaise = priceKind === "sale" ? entry.salePricePaise : entry.purchasePricePaise;
        const ratePaise = purity ? rateByPurity.get(purity._id) : undefined;
        out.push({
          key: entry._id,
          box,
          entry,
          itemName: entry.productName,
          sku: entry.sku,
          purityLabel: purity?.label ?? "—",
          pieces: entry.pieces,
          weightMg: entry.weightMg,
          netWeightMg: entry.netWeightMg,
          price: pricePaise ? `${formatPaise(pricePaise)} /pc` : ratePaise ? `${formatPaise(ratePaise)} /g` : "—",
        });
      }
      // Stock in the box not assigned to any item (older stock), or an empty box with no items yet.
      const freeWeight = box.weightMg - entries.reduce((sum, e) => sum + e.weightMg, 0);
      const freePieces = box.pieces - entries.reduce((sum, e) => sum + e.pieces, 0);
      if (entries.length === 0 || freeWeight > 0 || freePieces > 0) {
        out.push({
          key: `${box._id}:free`,
          box,
          itemName: entries.length === 0 ? box.label ?? "—" : "Other (not assigned)",
          purityLabel: box.metal === "gold" ? "Gold" : box.metal === "silver" ? "Silver" : "—",
          pieces: freePieces,
          weightMg: freeWeight,
          netWeightMg: freeWeight,
          price: "—",
        });
      }
    }
    return out;
  }, [boxes, purities, rateByPurity, value, metal, priceKind]);

  const term = search.trim().toLowerCase();
  const shown = term
    ? rows.filter((r) => String(r.box.boxNumber).includes(term) || r.itemName.toLowerCase().includes(term) || r.box.label?.toLowerCase().includes(term) || r.sku?.toLowerCase().includes(term))
    : rows;

  const current = boxes.find((b) => b._id === value);
  // Item names found in more than one box: only those rows show their box (to tell them apart).
  const sharedNames = useMemo(() => {
    const boxesByName = new Map<string, Set<string>>();
    for (const r of rows) {
      const name = r.itemName.toLowerCase();
      boxesByName.set(name, (boxesByName.get(name) ?? new Set()).add(r.box._id));
    }
    return new Set([...boxesByName].filter(([, ids]) => ids.size > 1).map(([name]) => name));
  }, [rows]);
  const columns = itemFirst ? 6 : 7;
  const triggerText = itemFirst
    ? current
      ? selectedItemName || current.label || `Box ${current.boxNumber}`
      : emptyLabel ?? "Select item"
    : current
      ? `Box ${current.boxNumber}${current.metal ? ` · ${current.metal === "gold" ? "Gold" : "Silver"}` : ""}`
      : emptyLabel ?? "Select box";

  function choose(row: PickRow | null) {
    if (row) onPick(row.box._id, row.entry);
    else onPick("");
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setActive(Math.max(0, rows.findIndex((r) => r.box._id === value)));
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" aria-label={ariaLabel} className={`flex h-8 items-center justify-between gap-1 rounded-md border bg-background px-2 text-left text-xs ${triggerClassName ?? "w-36"}`}>
          <span className="truncate" title={triggerText}>{triggerText}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-[min(44rem,calc(100vw-1rem))] rounded-md border bg-popover text-popover-foreground shadow-lg"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <div className="relative border-b p-2">
            <Search className="absolute top-1/2 left-4 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search boxes"
              placeholder={itemFirst ? "Search item name or code" : "Search box no, item name or code"}
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, shown.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (shown[active]) choose(shown[active]);
                }
              }}
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-[11px] font-semibold text-muted-foreground">
                <tr>
                  {!itemFirst && <th className="px-2 py-1.5">BOX NO</th>}
                  <th className="px-2 py-1.5">ITEM NAME</th>
                  <th className="px-2 py-1.5">PURITY</th>
                  <th className="px-2 py-1.5 text-right">PCS</th>
                  <th className="px-2 py-1.5 text-right">GROSS WT (g)</th>
                  <th className="px-2 py-1.5 text-right">NET WT (g)</th>
                  <th className="px-2 py-1.5 text-right">PRICE</th>
                </tr>
              </thead>
              <tbody>
                {emptyLabel && !term && (
                  <tr className="cursor-pointer border-b hover:bg-accent" onClick={() => choose(null)}>
                    <td colSpan={columns} className="px-2 py-1.5 text-muted-foreground">{emptyLabel}</td>
                  </tr>
                )}
                {shown.map((row, i) => (
                  <tr
                    key={row.key}
                    className={`cursor-pointer border-b border-border/50 ${i === active ? "bg-accent" : "hover:bg-accent/60"} ${row.box._id === value ? "font-semibold" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(row)}
                  >
                    {!itemFirst && <td className="px-2 py-1.5 font-mono">{row.box.boxNumber}</td>}
                    <td className="max-w-48 truncate px-2 py-1.5" title={row.itemName}>
                      {row.itemName}
                      {row.sku && <span className="ml-1 text-[10px] text-muted-foreground">({row.sku})</span>}
                      {itemFirst && sharedNames.has(row.itemName.toLowerCase()) && <span className="ml-1 text-[10px] text-muted-foreground">· Box {row.box.boxNumber}</span>}
                    </td>
                    <td className="px-2 py-1.5">{row.purityLabel}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.pieces}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{mgToGramsDisplay(row.weightMg)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-emerald-600">{mgToGramsDisplay(row.netWeightMg)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.price}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="px-2 py-4 text-center text-muted-foreground">No {itemFirst ? "item" : "box"} matches “{search}”.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
