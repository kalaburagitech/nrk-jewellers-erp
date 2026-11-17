import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canViewCost, requireAuthContext, requireRole, type AuthContext } from "./lib/auth";
import { normalizeCustomFieldValues } from "./lib/customFieldValues";
import { PURITY_KARAT } from "./schema";
import { resolveKaratPurity } from "./lib/purity";
import { changeItemStock, isGstCompanyType } from "./lib/itemStock";

/** Strips internal purchase cost for roles that must not see it (billing counter, view-only staff). */
function forRole<T extends Doc<"products">>(product: T, role: AuthContext["role"]): T {
  if (canViewCost(role)) return product;
  const { purchasePricePaise: _hidden, ...rest } = product;
  void _hidden;
  return rest as T;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const rows = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    return rows.map((row) => forRole(row, auth.role));
  },
});

/** Whether the signed-in role may see purchase cost / override prices — lets screens hide those columns. */
export const myPricingAccess = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return {
      canViewCost: canViewCost(auth.role),
      canOverridePrice: auth.role === "owner" || auth.role === "admin",
    };
  },
});

const unit = v.union(v.literal("gram"), v.literal("kilogram"), v.literal("piece"), v.literal("carat"));

const itemType = v.optional(v.union(v.literal("product"), v.literal("service")));

const itemFields = {
  name: v.string(),
  description: v.optional(v.string()),
  sku: v.optional(v.string()),
  itemType,
  stockGroupId: v.optional(v.id("stockGroups")),
  stockCategoryId: v.optional(v.id("stockCategories")),
  metalPurityId: v.optional(v.id("metalPurities")),
  unit,
  hsnCode: v.optional(v.string()),
  reorderLevelMg: v.optional(v.number()),
  customFields: v.optional(v.record(v.string(), v.string())),
  // Item master defaults
  purityKarat: v.optional(PURITY_KARAT),
  purityOther: v.optional(v.string()),
  defaultBoxId: v.optional(v.id("boxes")),
  grossWeightMg: v.optional(v.number()),
  stoneWeightMg: v.optional(v.number()),
  netWeightMg: v.optional(v.number()),
  purchasePricePaise: v.optional(v.number()),
  sellingPricePaise: v.optional(v.number()),
  makingChargePaise: v.optional(v.number()),
  wastageBasisPoints: v.optional(v.number()),
  taxConfigurationId: v.optional(v.id("taxConfigurations")),
};

type ItemArgs = {
  name: string;
  description?: string;
  sku?: string;
  itemType?: "product" | "service";
  stockGroupId?: Id<"stockGroups">;
  stockCategoryId?: Id<"stockCategories">;
  metalPurityId?: Id<"metalPurities">;
  unit: Doc<"products">["unit"];
  hsnCode?: string;
  reorderLevelMg?: number;
  customFields?: Record<string, string>;
  purityKarat?: Doc<"products">["purityKarat"];
  purityOther?: string;
  defaultBoxId?: Id<"boxes">;
  grossWeightMg?: number;
  stoneWeightMg?: number;
  netWeightMg?: number;
  purchasePricePaise?: number;
  sellingPricePaise?: number;
  makingChargePaise?: number;
  wastageBasisPoints?: number;
  taxConfigurationId?: Id<"taxConfigurations">;
};

function optionalWhole(value: number | undefined, label: string) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be zero or more`);
  return value;
}

/**
 * Shared validation + normalisation for create and update, so both paths
 * enforce the same rules: weights are consistent (stone ≤ gross, net ≤ gross −
 * stone), prices are non-negative paise, references belong to this company,
 * and a chosen karat is resolved to the company's gold purity row.
 */
async function normaliseItem(ctx: MutationCtx, auth: AuthContext, args: ItemArgs, existing?: Doc<"products">) {
  const name = args.name.trim();
  if (!name) throw new Error("Item name is required");
  const sku = args.sku?.trim() || undefined;
  // Only check when the code changes, so legacy duplicate codes never block editing other fields.
  if (sku && sku !== existing?.sku) {
    const clash = await ctx.db
      .query("products")
      .withIndex("by_org_and_sku", (q) => q.eq("organizationId", auth.organizationId).eq("sku", sku))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (clash && clash._id !== existing?._id) throw new Error(`Item code "${sku}" is already used by "${clash.name}"`);
  }

  const grossWeightMg = optionalWhole(args.grossWeightMg, "Gross weight");
  const stoneWeightMg = optionalWhole(args.stoneWeightMg, "Stone weight");
  let netWeightMg = optionalWhole(args.netWeightMg, "Net weight");
  if (grossWeightMg !== undefined) {
    const stone = stoneWeightMg ?? 0;
    if (stone > grossWeightMg) throw new Error("Stone weight cannot be more than gross weight");
    if (netWeightMg === undefined) netWeightMg = grossWeightMg - stone;
    if (netWeightMg > grossWeightMg - stone) throw new Error("Net weight cannot be more than gross weight minus stone weight");
  } else if (stoneWeightMg || netWeightMg) {
    throw new Error("Enter the gross weight before stone or net weight");
  }

  const purchasePricePaise = optionalWhole(args.purchasePricePaise, "Purchase price");
  const sellingPricePaise = optionalWhole(args.sellingPricePaise, "Selling price");
  const makingChargePaise = optionalWhole(args.makingChargePaise, "Making charges");
  const wastageBasisPoints = optionalWhole(args.wastageBasisPoints, "Wastage");
  if (wastageBasisPoints !== undefined && wastageBasisPoints > 10000) throw new Error("Wastage cannot exceed 100%");

  if (args.defaultBoxId) {
    const box = await ctx.db.get(args.defaultBoxId);
    if (!box || box.deletedAt || box.organizationId !== auth.organizationId) throw new Error("Box not found");
  }
  if (args.taxConfigurationId) {
    const tax = await ctx.db.get(args.taxConfigurationId);
    if (!tax || tax.deletedAt || tax.organizationId !== auth.organizationId) throw new Error("GST rate not found");
  }

  let metalPurityId = args.metalPurityId;
  if (args.purityKarat && args.purityKarat !== "other") {
    metalPurityId = await resolveKaratPurity(ctx, auth.organizationId, args.purityKarat);
  }
  if (metalPurityId) {
    const purity = await ctx.db.get(metalPurityId);
    if (!purity || purity.deletedAt || purity.organizationId !== auth.organizationId) throw new Error("Purity not found");
  }

  const customFields = await normalizeCustomFieldValues(ctx, auth.organizationId, "product", args.customFields);
  return {
    name,
    description: args.description?.trim() || undefined,
    sku,
    itemType: args.itemType ?? "product",
    stockGroupId: args.stockGroupId,
    stockCategoryId: args.stockCategoryId,
    metalPurityId,
    unit: args.unit,
    hsnCode: args.hsnCode?.trim() || undefined,
    reorderLevelMg: args.reorderLevelMg,
    customFields,
    purityKarat: args.purityKarat,
    purityOther: args.purityKarat === "other" ? args.purityOther?.trim().slice(0, 40) || undefined : undefined,
    defaultBoxId: args.defaultBoxId,
    grossWeightMg,
    stoneWeightMg: grossWeightMg === undefined ? undefined : (stoneWeightMg ?? 0),
    netWeightMg,
    purchasePricePaise,
    sellingPricePaise,
    makingChargePaise,
    wastageBasisPoints,
    taxConfigurationId: args.taxConfigurationId,
  };
}

export const create = mutation({
  args: {
    ...itemFields,
    // Pieces of this item already on hand. Daily Sales company: that many
    // pieces are placed in the chosen box. GST company: added to item stock.
    openingStock: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const item = await normaliseItem(ctx, auth, args);
    const openingStock = args.openingStock ?? 0;
    if (!Number.isSafeInteger(openingStock) || openingStock < 0 || openingStock > 500) {
      throw new Error("Opening stock must be a whole number of pieces between 0 and 500");
    }
    if (openingStock > 0 && item.itemType === "service") throw new Error("Service items carry no stock");

    const now = Date.now();
    const productId = await ctx.db.insert("products", {
      organizationId: auth.organizationId,
      ...item,
      openingStockPieces: openingStock || undefined,
      isActive: true,
      createdAt: now,
    });

    if (openingStock > 0) await postOpeningStock(ctx, auth, productId, item, openingStock, now);

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "product.create",
      entityTable: "products",
      entityId: productId,
      metadata: { name: item.name, sellingPricePaise: item.sellingPricePaise, openingStock },
      createdAt: now,
    });
    return productId;
  },
});

/**
 * Puts the opening pieces into stock in the same transaction as the item, so
 * an item can never exist with a half-posted opening balance. Uses the same
 * stock paths purchases use (box pieces or GST item stock), each with a
 * stockMovements row for the journal.
 */
async function postOpeningStock(
  ctx: MutationCtx,
  auth: AuthContext,
  productId: Id<"products">,
  item: Awaited<ReturnType<typeof normaliseItem>>,
  pieces: number,
  now: number,
) {
  const gross = item.grossWeightMg ?? 0;
  const stone = item.stoneWeightMg ?? 0;
  const net = item.netWeightMg ?? Math.max(0, gross - stone);
  const company = await ctx.db.get(auth.organizationId);
  if (isGstCompanyType(company?.companyType)) {
    await changeItemStock(ctx, {
      organizationId: auth.organizationId,
      productId,
      grossWeightDeltaMg: gross * pieces,
      stoneWeightDeltaMg: stone * pieces,
      netWeightDeltaMg: net * pieces,
      piecesDelta: pieces,
      sourceTable: "opening_stock",
      sourceId: productId,
      at: now,
    });
    return;
  }
  if (!item.defaultBoxId) throw new Error("Choose the box for the opening stock pieces");
  if (gross <= 0) throw new Error("Enter the gross weight per piece for the opening stock");
  const box = await ctx.db.get(item.defaultBoxId);
  if (!box || box.deletedAt || box.organizationId !== auth.organizationId || !box.isActive) throw new Error("Choose an active box for the opening stock");
  for (let i = 0; i < pieces; i++) {
    const boxItemId = await ctx.db.insert("boxItems", {
      organizationId: auth.organizationId,
      boxId: box._id,
      productId,
      label: pieces === 1 ? item.name : `${item.name} ${i + 1}`,
      grossWeightMg: gross,
      stoneWeightMg: stone,
      netWeightMg: net,
      status: "in_stock",
      createdAt: now,
    });
    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId,
      boxItemId,
      boxId: box._id,
      direction: "in",
      grossWeightMg: gross,
      stoneWeightMg: stone,
      netWeightMg: net,
      quantity: 1,
      sourceTable: "opening_stock",
      sourceId: productId,
      createdAt: now,
    });
  }
  await ctx.db.patch(box._id, { itemCount: (box.itemCount ?? 0) + pieces });
}

export const update = mutation({
  args: { id: v.id("products"), ...itemFields },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Product not found");
    const { id, ...rest } = args;
    // A role that can't see the cost gets it stripped from products.list, so
    // it would submit "no purchase price" — keep the stored value instead of wiping it.
    const input = canViewCost(auth.role) ? rest : { ...rest, purchasePricePaise: existing.purchasePricePaise };
    const item = await normaliseItem(ctx, auth, input, existing);
    // Editing never creates stock or boxes: opening stock is a create-only
    // action, and changing the default box doesn't move existing pieces.
    const { customFields, ...fields } = item;
    await ctx.db.patch(id, { ...fields, ...(customFields === undefined ? {} : { customFields }) });
    if (existing.sellingPricePaise !== item.sellingPricePaise || existing.purchasePricePaise !== item.purchasePricePaise) {
      await ctx.db.insert("auditLogs", {
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "product.price_change",
        entityTable: "products",
        entityId: id,
        metadata: {
          fromSellingPricePaise: existing.sellingPricePaise,
          toSellingPricePaise: item.sellingPricePaise,
          purchasePriceChanged: existing.purchasePricePaise !== item.purchasePricePaise,
        },
        createdAt: Date.now(),
      });
    }
  },
});

export const setActive = mutation({
  args: { id: v.id("products"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});

/** Item details screen: live stock for one item (box pieces or GST item stock) plus where its pieces are. */
export const getStockSummary = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Not found");
    const company = await ctx.db.get(auth.organizationId);
    if (isGstCompanyType(company?.companyType)) {
      const row = await ctx.db
        .query("productStock")
        .withIndex("by_org_and_product", (q) => q.eq("organizationId", auth.organizationId).eq("productId", args.productId))
        .first();
      return {
        mode: "item" as const,
        pieces: row?.pieces ?? 0,
        grossWeightMg: row?.grossWeightMg ?? row?.weightMg ?? 0,
        stoneWeightMg: row?.stoneWeightMg ?? 0,
        netWeightMg: row?.netWeightMg ?? row?.weightMg ?? 0,
        boxes: [] as Array<{ boxId: Id<"boxes">; boxNumber: number; label?: string; pieces: number }>,
      };
    }
    const pieces = (await ctx.db.query("boxItems").withIndex("by_product", (q) => q.eq("productId", args.productId)).collect())
      .filter((item) => !item.deletedAt && item.status === "in_stock" && item.organizationId === auth.organizationId);
    const byBox = new Map<Id<"boxes">, number>();
    for (const piece of pieces) byBox.set(piece.boxId, (byBox.get(piece.boxId) ?? 0) + 1);
    const boxes = await Promise.all([...byBox.entries()].map(async ([boxId, count]) => {
      const box = await ctx.db.get(boxId);
      return { boxId, boxNumber: box?.boxNumber ?? 0, label: box?.label, pieces: count };
    }));
    return {
      mode: "box" as const,
      pieces: pieces.length,
      grossWeightMg: pieces.reduce((sum, p) => sum + p.grossWeightMg, 0),
      stoneWeightMg: pieces.reduce((sum, p) => sum + p.stoneWeightMg, 0),
      netWeightMg: pieces.reduce((sum, p) => sum + p.netWeightMg, 0),
      boxes: boxes.sort((a, b) => a.boxNumber - b.boxNumber),
    };
  },
});

/**
 * Item-level stock adjustment from the Item screen ("Adjust Item"). Adds or
 * removes whole pieces of this item using its standard weights (or weights
 * typed for this adjustment):
 *  - GST company → item stock balance (gross, stone, net and pieces separately);
 *  - Daily Sales company → pieces are created in / written off from a box.
 * Every change writes stockMovements + an audit log in the same transaction.
 */
export const adjustStock = mutation({
  args: {
    productId: v.id("products"),
    direction: v.union(v.literal("add"), v.literal("reduce")),
    pieces: v.number(),
    boxId: v.optional(v.id("boxes")),
    grossWeightMg: v.optional(v.number()), // per piece; defaults to the item's standard weight
    stoneWeightMg: v.optional(v.number()),
    reason: v.string(),
    adjustedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const product = await ctx.db.get(args.productId);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (product.itemType === "service") throw new Error("Service items carry no stock");
    if (!Number.isSafeInteger(args.pieces) || args.pieces < 1 || args.pieces > 500) throw new Error("Pieces must be a whole number from 1 to 500");
    const reason = args.reason.trim();
    if (!reason) throw new Error("Enter a reason for this adjustment");
    const gross = args.grossWeightMg ?? product.grossWeightMg ?? 0;
    const stone = args.stoneWeightMg ?? product.stoneWeightMg ?? 0;
    if (!Number.isSafeInteger(gross) || gross < 0 || !Number.isSafeInteger(stone) || stone < 0 || stone > gross) {
      throw new Error("Enter valid weights (stone cannot exceed gross)");
    }
    const net = args.grossWeightMg === undefined && product.netWeightMg !== undefined ? product.netWeightMg : gross - stone;
    const now = args.adjustedAt ?? Date.now();
    const logId = await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "product.adjust_stock",
      entityTable: "products",
      entityId: product._id,
      metadata: { direction: args.direction, pieces: args.pieces, grossWeightMg: gross, stoneWeightMg: stone, reason },
      createdAt: Date.now(),
    });

    const company = await ctx.db.get(auth.organizationId);
    if (isGstCompanyType(company?.companyType)) {
      const sign = args.direction === "add" ? 1 : -1;
      await changeItemStock(ctx, {
        organizationId: auth.organizationId,
        productId: product._id,
        grossWeightDeltaMg: sign * gross * args.pieces,
        stoneWeightDeltaMg: sign * stone * args.pieces,
        netWeightDeltaMg: sign * net * args.pieces,
        piecesDelta: sign * args.pieces,
        sourceTable: "item_stock_adjustments",
        sourceId: logId,
        at: now,
      });
      return;
    }

    if (args.direction === "add") {
      const boxId = args.boxId ?? product.defaultBoxId;
      if (!boxId) throw new Error("Choose the box to put these pieces in");
      if (gross <= 0) throw new Error("Enter the gross weight per piece");
      const box = await ctx.db.get(boxId);
      if (!box || box.deletedAt || box.organizationId !== auth.organizationId || !box.isActive) throw new Error("Choose an active box");
      for (let i = 0; i < args.pieces; i++) {
        const boxItemId = await ctx.db.insert("boxItems", {
          organizationId: auth.organizationId, boxId, productId: product._id, label: product.name,
          grossWeightMg: gross, stoneWeightMg: stone, netWeightMg: net, status: "in_stock", createdAt: now,
        });
        await ctx.db.insert("stockMovements", {
          organizationId: auth.organizationId, productId: product._id, boxItemId, boxId, direction: "in",
          grossWeightMg: gross, stoneWeightMg: stone, netWeightMg: net, quantity: 1,
          sourceTable: "stock_adjustments", sourceId: logId, createdAt: now,
        });
      }
      await ctx.db.patch(boxId, { itemCount: (box.itemCount ?? 0) + args.pieces });
      return;
    }

    // Reduce: write off the most recently added in-stock pieces of this item (optionally from one box).
    const pieces = (await ctx.db.query("boxItems").withIndex("by_product", (q) => q.eq("productId", product._id)).collect())
      .filter((p) => !p.deletedAt && p.status === "in_stock" && p.organizationId === auth.organizationId && (!args.boxId || p.boxId === args.boxId))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (pieces.length < args.pieces) throw new Error(`Only ${pieces.length} piece(s) of "${product.name}" are in stock${args.boxId ? " in that box" : ""}`);
    const boxDeltas = new Map<Id<"boxes">, number>();
    for (const piece of pieces.slice(0, args.pieces)) {
      await ctx.db.patch(piece._id, { status: "written_off" });
      boxDeltas.set(piece.boxId, (boxDeltas.get(piece.boxId) ?? 0) + 1);
      await ctx.db.insert("stockMovements", {
        organizationId: auth.organizationId, productId: product._id, boxItemId: piece._id, boxId: piece.boxId, direction: "out",
        grossWeightMg: piece.grossWeightMg, stoneWeightMg: piece.stoneWeightMg, netWeightMg: piece.netWeightMg, quantity: 1,
        sourceTable: "stock_adjustments", sourceId: logId, createdAt: now,
      });
    }
    for (const [boxId, delta] of boxDeltas) {
      const box = await ctx.db.get(boxId);
      if (box) await ctx.db.patch(boxId, { itemCount: Math.max(0, (box.itemCount ?? 0) - delta) });
    }
  },
});
