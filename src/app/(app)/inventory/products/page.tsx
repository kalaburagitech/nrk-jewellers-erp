"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Gem,
  Search,
  Pencil,
  Boxes,
  Sliders,
  ChevronRight,
  Barcode,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ImportCsvDialog } from "@/components/import-csv-dialog";
import { formatPaise } from "@/lib/money";
import { AdjustStockDialog, ItemFormDialog } from "@/components/item-form-dialog";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const UNITS = [
  { value: "gram", label: "Gram" },
  { value: "kilogram", label: "Kilogram" },
  { value: "piece", label: "Piece" },
  { value: "carat", label: "Carat" },
] as const;

const PRODUCT_IMPORT_HEADERS = [
  "Name",
  "SKU",
  "Unit (gram/kilogram/piece/carat)",
  "Purity Label",
  "HSN Code",
  "Reorder Level (g)",
];

function ImportProductsDialog({
  purities,
}: {
  purities: Doc<"metalPurities">[] | undefined;
}) {
  const createProduct = useMutation(api.products.create);
  return (
    <ImportCsvDialog
      title="Import products"
      templateFilename="products-template"
      templateHeaders={PRODUCT_IMPORT_HEADERS}
      templateExampleRow={["Gold Chain 20g", "", "gram", "22K", "", ""]}
      rowLabel={(r) => r["Name"] ?? ""}
      onImportRow={async (r) => {
        const name = r["Name"]?.trim();
        if (!name) throw new Error("Name is required");
        const rawUnit = r["Unit (gram/kilogram/piece/carat)"]?.trim().toLowerCase();
        const unit = UNITS.find((u) => u.value === rawUnit)?.value ?? "gram";
        const purityLabelInput = r["Purity Label"]?.trim().toLowerCase();
        const metalPurityId = purityLabelInput
          ? purities?.find((p) => p.label.toLowerCase() === purityLabelInput)?._id
          : undefined;
        if (purityLabelInput && !metalPurityId)
          throw new Error(
            `No purity named "${r["Purity Label"]}" — check Settings > Metal Purity Configuration`,
          );
        const reorderLevelGrams = r["Reorder Level (g)"]?.trim();
        await createProduct({
          name,
          sku: r["SKU"] || undefined,
          unit,
          metalPurityId,
          hsnCode: r["HSN Code"] || undefined,
          reorderLevelMg: reorderLevelGrams
            ? Math.round(Number(reorderLevelGrams) * 1000)
            : undefined,
        });
      }}
    />
  );
}

function StatCard({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <Card className="gap-0 border-border/80 py-0 shadow-xs">
      <CardContent className="p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-base font-bold ${tone ?? "text-foreground"}`}>{value}</p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** Purchase price × stock: per gram for weight units, per piece otherwise. */
function stockValuePaise(product: Doc<"products">, stock: { weightMg: number; pieces: number }) {
  const price = product.purchasePricePaise ?? 0;
  if (product.unit === "gram") return Math.round((price * stock.weightMg) / 1000);
  if (product.unit === "kilogram") return Math.round((price * stock.weightMg) / 1_000_000);
  return price * stock.pieces;
}

// Right Detail View for Selected Item (Page 10)
function ProductDetailView({
  product,
  purityLabel,
}: {
  product: Doc<"products">;
  purityLabel?: string;
}) {
  const details = useQuery(api.products.details, { id: product._id });
  const boxes = useQuery(api.boxes.list);
  const pricing = useQuery(api.products.myPricingAccess);
  const box = product.defaultBoxId ? boxes?.find((b) => b._id === product.defaultBoxId) : undefined;
  const g = (mg?: number) => (mg === undefined ? "—" : `${(mg / 1000).toFixed(3)} g`);
  return (
    <div className="space-y-3">
      {/* Item Header & Controls (Page 10) */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">
              {product.name}
            </h2>
            <Badge variant="outline" className="text-xs capitalize">
              {product.unit}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {product.sku && <span className="font-mono">Code: {product.sku}</span>}
            {(purityLabel || product.purityOther) && (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{purityLabel ?? product.purityOther}</Badge>
            )}
            {box && <span className="font-medium">Box {box.boxNumber}{box.label ? ` · ${box.label}` : ""}</span>}
            {product.hsnCode && <span>HSN: {product.hsnCode}</span>}
            {product.description && <span>{product.description}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AdjustStockDialog product={product} />
          <ItemFormDialog
            product={product}
            trigger={
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            }
          />
          <Button
            asChild
            size="sm"
            className="h-9 bg-[#d93025] hover:bg-[#b3261e] text-white font-medium"
          >
            <Link href="/sales/new">
              <Receipt className="h-3.5 w-3.5" />
              Sell Item
            </Link>
          </Button>
          <DeleteRecordButton table="products" id={product._id} name={product.name} />
        </div>
      </div>

      {/* Summary cards: real prices and live stock */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Sale Price" value={product.salePricePaise !== undefined ? `${formatPaise(product.salePricePaise)} ${product.salePriceIncludesTax ? "(incl. tax)" : "(excl. tax)"}` : "Billed at today's rate"} />
        {pricing?.canViewCost && (
          <StatCard
            label="Purchase Price"
            value={product.purchasePricePaise !== undefined ? `${formatPaise(product.purchasePricePaise)} ${product.purchasePriceIncludesTax ? "(incl. tax)" : "(excl. tax)"}` : "—"}
            note={product.purchasePricePaise !== undefined && product.salePricePaise !== undefined ? `Margin ${formatPaise(product.salePricePaise - product.purchasePricePaise)} / pc` : undefined}
          />
        )}
        <StatCard
          label="Stock Quantity"
          value={details ? `${details.pieces} pcs · ${(details.weightMg / 1000).toFixed(3)} g` : "…"}
          tone={details?.lowStock ? "text-red-600" : "text-emerald-600"}
          note={details?.lowStock ? "Below minimum stock" : product.location ? `Location: ${product.location}` : undefined}
        />
        <StatCard
          label="Stock Value"
          value={details && product.purchasePricePaise !== undefined ? formatPaise(stockValuePaise(product, details)) : "Set a purchase price"}
          note={details?.taxName ? `Tax: ${details.taxName}` : undefined}
        />
      </div>
      {/* Per-piece jewellery details from the item master */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-5">
        <div><p className="text-[11px] uppercase text-muted-foreground">Gross wt</p><p className="font-semibold tabular-nums">{g(product.grossWeightMg)}</p></div>
        <div><p className="text-[11px] uppercase text-muted-foreground">Stone wt</p><p className="font-semibold tabular-nums">{g(product.stoneWeightMg)}</p></div>
        <div><p className="text-[11px] uppercase text-muted-foreground">Net wt</p><p className="font-semibold tabular-nums text-emerald-600">{g(product.netWeightMg)}</p></div>
        <div><p className="text-[11px] uppercase text-muted-foreground">Making</p><p className="font-semibold tabular-nums">{product.makingChargePaise !== undefined ? formatPaise(product.makingChargePaise) : "—"}</p></div>
        <div><p className="text-[11px] uppercase text-muted-foreground">Wastage</p><p className="font-semibold tabular-nums">{product.wastageBasisPoints !== undefined ? `${product.wastageBasisPoints / 100}%` : "—"}</p></div>
      </div>
      {/* Box Links & Barcode Labeling Quick Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
          <Link href="/boxes">
            <Boxes className="h-4 w-4 text-primary" />
            <span>Manage Physical Stock Boxes</span>
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
          <Link href="/boxes/labels">
            <Barcode className="h-4 w-4" />
            <span>Print Item Barcodes</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}

const MOVEMENT_LABEL: Record<string, string> = { box_opening: "Opening", purchases: "Purchase", sales: "Sale", stock_adjustments: "Adjustment", box_transfers: "Transfer" };

/** Latest stock movements of a box: sales, purchases, adjustments and transfers. */
function BoxMovementsTable({ boxId }: { boxId: Id<"boxes"> }) {
  const movements = useQuery(api.boxes.movements, { boxId });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left font-semibold text-muted-foreground">
            <th className="pb-2">DATE</th>
            <th className="pb-2">TYPE</th>
            <th className="pb-2">ITEM / REMARK</th>
            <th className="pb-2 text-right">WEIGHT</th>
            <th className="pb-2 text-right">PCS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {movements === undefined ? (
            <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Loading…</td></tr>
          ) : movements.length === 0 ? (
            <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No stock movements yet.</td></tr>
          ) : (
            movements.slice(0, 15).map((m) => (
              <tr key={m._id} className="hover:bg-muted/30">
                <td className="py-2.5">{new Date(m.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="py-2.5">{MOVEMENT_LABEL[m.sourceTable] ?? m.sourceTable}</td>
                <td className="py-2.5">{m.productName ?? m.note ?? "—"}</td>
                <td className={`py-2.5 text-right font-mono ${m.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>{m.direction === "in" ? "+" : "−"}{(m.netWeightMg / 1000).toFixed(3)}g</td>
                <td className="py-2.5 text-right">{m.quantity || ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Main 2-Pane Items / Products Screen (Page 10 Layout)
export default function ProductsPage() {
  const products = useQuery(api.products.list);
  const purities = useQuery(api.metalPurities.list);
  const boxes = useQuery(api.boxes.list);
  const boxOverview = useMemo(() => boxes && { boxes: boxes.map((box) => ({ box, quantity: box.pieces, weightMg: box.weightMg })) }, [boxes]);
  const recentSales = useQuery(api.sales.list);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("products");
  const tabToUse = activeTab;
  const [selectedBoxId, setSelectedBoxId] = useState<Id<"boxes"> | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<Id<"products"> | null>(null);

  const purityMap = useMemo(() => {
    const map = new Map<string, string>();
    purities?.forEach((p) => map.set(p._id, p.label));
    return map;
  }, [purities]);

  const filtered = useMemo(() => {
    if (!products) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  }, [products, search]);
  // Tick several items and delete them together.
  const selection = useRecordSelection(filtered?.map((p) => p._id) ?? [], `products:${search}`);

  const filteredBoxes = useMemo(() => {
    if (!boxOverview?.boxes) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return boxOverview.boxes;
    return boxOverview.boxes.filter(
      (b) =>
        String(b.box.boxNumber).includes(q) ||
        (b.box.label && b.box.label.toLowerCase().includes(q)),
    );
  }, [boxOverview, search]);

  const activeBox = useMemo(() => {
    if (!filteredBoxes || filteredBoxes.length === 0) return null;
    if (selectedBoxId) {
      const match = filteredBoxes.find((b) => b.box._id === selectedBoxId);
      if (match) return match;
    }
    return filteredBoxes[0];
  }, [filteredBoxes, selectedBoxId]);

  const activeProduct = useMemo(() => {
    if (!filtered || filtered.length === 0) return null;
    if (selectedProductId) {
      const match = filtered.find((p) => p._id === selectedProductId);
      if (match) return match;
    }
    return filtered[0];
  }, [filtered, selectedProductId]);

  return (
    <div className="erp-fill flex w-full flex-col gap-3">
      {/* Top Header & Import / Add Buttons */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Items / Products</h1>
          <p className="text-xs text-muted-foreground">
            Manage jewellery stock, physical boxes, purities, barcodes, and stock adjustments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportProductsDialog purities={purities} />
          <ItemFormDialog />
        </div>
      </div>

      {/* Top Navigation Tabs matching Page 10 */}
      <div className="shrink-0 border-b">
        <div className="flex gap-5 overflow-x-auto text-xs font-semibold uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setActiveTab("products")}
            className={`whitespace-nowrap pb-2 border-b-2 transition ${
              activeTab === "products"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Products ({products?.length ?? 0})
          </button>
            <button
              type="button"
              onClick={() => setActiveTab("boxes")}
              className={`whitespace-nowrap pb-2 border-b-2 transition ${
                activeTab === "boxes"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Boxes & Physical Stock ({boxOverview?.boxes?.length ?? boxes?.length ?? 0})
            </button>
          
          <Link
            href="/inventory/categories"
            className="whitespace-nowrap pb-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground"
          >
            Categories
          </Link>
          <Link
            href="/inventory/groups"
            className="whitespace-nowrap pb-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground"
          >
            Stock Groups
          </Link>
        </div>
      </div>

      {tabToUse === "products" && (
        <div className="shrink-0">
          <BulkRecordActions selection={selection} table="products" />
        </div>
      )}

      {/* 2-Pane Split Master-Detail Layout (Page 10) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[300px_1fr] xl:grid-cols-[340px_1fr]">
        {/* Left Pane: Items / Boxes List with Quantity (Page 10) */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="shrink-0 p-3 border-b bg-muted/20">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search Items"
                placeholder={tabToUse === "boxes" ? "Search Box No / Label" : "Search Item / SKU"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8.5 h-9 text-xs rounded-lg"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item / Box</span>
              <span>Stock Quantity</span>
            </div>
          </div>

          <div className="erp-scroll max-h-[60vh] flex-1 overflow-y-auto divide-y divide-border/60 lg:max-h-none">
            {tabToUse === "boxes" ? (
              filteredBoxes === undefined ? (
                <p className="p-5 text-xs text-muted-foreground text-center">Loading boxes…</p>
              ) : filteredBoxes.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  <Boxes className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
                  <p>No stock boxes found</p>
                </div>
              ) : (
                filteredBoxes.map((b) => {
                  const isSelected = activeBox?.box._id === b.box._id;
                  const label = b.box.label ? ` (${b.box.label})` : "";
                  const boxName = `Box No${b.box.boxNumber}${label}`;
                  const isPositive = b.quantity > 0;
                  return (
                    <button
                      key={b.box._id}
                      type="button"
                      onClick={() => setSelectedBoxId(b.box._id)}
                      className={`w-full px-3 py-2.5 text-left transition-colors flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-primary/10 border-l-4 border-l-primary"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-xs sm:text-sm truncate">{boxName}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {b.quantity} pieces · {(b.weightMg / 1000).toFixed(3)}g
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                            isPositive
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {b.quantity}
                        </span>
                      </div>
                    </button>
                  );
                })
              )
            ) : filtered === undefined ? (
              <p className="p-5 text-xs text-muted-foreground text-center">Loading items…</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <Gem className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
                <p>No items found</p>
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = activeProduct?._id === p._id;
                const purity = (p.metalPurityId ? purityMap.get(p.metalPurityId) : null) ?? p.purityOther;
                return (
                  <div key={p._id} className="flex items-center gap-1 pl-3" data-state={selection.has(p._id) ? "selected" : undefined}>
                  <Checkbox aria-label={`Select ${p.name}`} checked={selection.has(p._id)} onCheckedChange={() => selection.toggle(p._id)} />
                  <button
                    type="button"
                    onClick={() => setSelectedProductId(p._id)}
                    className={`min-w-0 flex-1 px-3 py-2.5 text-left transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-xs sm:text-sm truncate">{p.name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {purity && <span className="font-medium">{purity}</span>}
                        {p.sku && <span>· {p.sku}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-600">
                        In Stock
                      </span>
                    </div>
                  </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Selected Item / Box Details & Transactions (Page 10) */}
        <div className="erp-scroll min-h-0 min-w-0 space-y-3 overflow-y-auto">
          {tabToUse === "boxes" && activeBox ? (
            <div className="space-y-3">
              {/* Box Header & Controls matching Page 10 */}
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">
                      BOX NO{activeBox.box.boxNumber}
                      {activeBox.box.label ? ` (${activeBox.box.label})` : ""}
                    </h2>
                    <Badge variant="outline" className="text-xs">
                      {activeBox.quantity} Pcs
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Physical Box #{activeBox.box.boxNumber}</span>
                    <span>Total Weight: {(activeBox.weightMg / 1000).toFixed(3)}g</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild size="sm" className="h-9 bg-[#1a73e8] hover:bg-[#1557b0] text-white">
                    <Link href={`/inventory/adjustments?boxId=${activeBox.box._id}`}>
                      <Sliders className="h-3.5 w-3.5 mr-1" />
                      Adjust Item
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="h-9 bg-[#d93025] hover:bg-[#b3261e] text-white">
                    <Link href="/sales/new">
                      <Receipt className="h-3.5 w-3.5 mr-1" />
                      Sell from Box
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Pieces in Box" value={`${activeBox.quantity} pcs`} tone="text-emerald-600" />
                <StatCard label="Gross Weight" value={`${(activeBox.weightMg / 1000).toFixed(3)} g`} />
              </div>

              {/* Box Transactions Table matching Page 10 */}
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between mb-3 border-b pb-2">
                  <h3 className="font-bold text-sm uppercase tracking-wide">
                    Transactions
                  </h3>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/boxes`}>
                      View Box Details <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                </div>

                <BoxMovementsTable boxId={activeBox.box._id} />
              </div>
            </div>
          ) : activeProduct ? (
            <ProductDetailView
              product={activeProduct}
              purityLabel={
                activeProduct.metalPurityId ? purityMap.get(activeProduct.metalPurityId) : undefined
              }
            />
          ) : (
            <Card className="p-12 text-center text-muted-foreground">
              <Gem className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">Select an item to view details and transactions</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
