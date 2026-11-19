import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canViewCost, requireAuthContext, requireRole, type AuthContext } from "./lib/auth";
import {
  assertBoxMetal,
  boxName,
  changeBoxStock,
  ensureBoxEntry,
  entryDefaultsFromProduct,
  findBoxEntry,
  getCompanyBox,
  listBoxEntries,
  readBoxBalance,
  type BoxEntryDetails,
} from "./lib/boxStock";

/**
 * Items inside a box. A box has a unique number; each item placed in it
 * carries its own billing details (HSN, purity, wastage, making, prices,
 * discount, tax, stock group, description) and its own stock (gross weight,
 * net weight, pieces). The Item List only names the item, its category and
 * stock group.
 */

const detailsArgs = {
  hsnCode: v.optional(v.string()),
  metalPurityId: v.optional(v.id("metalPurities")),
  description: v.optional(v.string()),
  stockGroupId: v.optional(v.id("stockGroups")),
  wastageBasisPoints: v.optional(v.number()),
  makingChargeMode: v.optional(v.union(v.literal("fixed"), v.literal("per_gram"), v.literal("percent"))),
  makingChargeValue: v.optional(v.number()),
  salePricePaise: v.optional(v.number()),
  purchasePricePaise: v.optional(v.number()),
  saleDiscountMode: v.optional(v.union(v.literal("percent"), v.literal("amount"))),
  saleDiscountValue: v.optional(v.number()),
  taxConfigurationId: v.optional(v.id("taxConfigurations")),
};

type DetailsArgs = BoxEntryDetails;

function amount(value: number | undefined, field: string, max?: number) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be zero or more`);
  if (max !== undefined && value > max) throw new Error(`${field} cannot be more than ${max / 100}%`);
  return value || undefined;
}

function text(value: string | undefined, max: number, field: string) {
  const t = value?.trim() || undefined;
  if (t && t.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return t;
}

/** Checks the details belong to the company and are valid; returns them cleaned. */
async function cleanDetails(ctx: MutationCtx, auth: AuthContext, box: Doc<"boxes">, args: DetailsArgs): Promise<BoxEntryDetails> {
  if (args.metalPurityId) {
    const purity = await ctx.db.get(args.metalPurityId);
    if (!purity || purity.deletedAt || purity.organizationId !== auth.organizationId) throw new Error("Purity not found");
    assertBoxMetal(box, purity.metal);
  }
  if (args.stockGroupId) {
    const group = await ctx.db.get(args.stockGroupId);
    if (!group || group.deletedAt || group.organizationId !== auth.organizationId) throw new Error("Stock group not found");
  }
  if (args.taxConfigurationId) {
    const tax = await ctx.db.get(args.taxConfigurationId);
    if (!tax || tax.deletedAt || tax.organizationId !== auth.organizationId) throw new Error("Tax rate not found");
  }
  const discountMax = args.saleDiscountMode === "percent" ? 10000 : undefined;
  return {
    hsnCode: text(args.hsnCode, 12, "HSN code"),
    metalPurityId: args.metalPurityId,
    description: text(args.description, 300, "Description"),
    stockGroupId: args.stockGroupId,
    wastageBasisPoints: amount(args.wastageBasisPoints, "Wastage", 10000),
    makingChargeMode: args.makingChargeValue ? args.makingChargeMode ?? "fixed" : undefined,
    makingChargeValue: amount(args.makingChargeValue, "Making charge", args.makingChargeMode === "percent" ? 10000 : undefined),
    salePricePaise: amount(args.salePricePaise, "Sale price"),
    purchasePricePaise: amount(args.purchasePricePaise, "Purchase price"),
    saleDiscountMode: args.saleDiscountValue ? args.saleDiscountMode ?? "amount" : undefined,
    saleDiscountValue: amount(args.saleDiscountValue, "Discount", discountMax),
    taxConfigurationId: args.taxConfigurationId,
  };
}

/** An entry as the screens see it: purchase price only for roles allowed to see cost. */
export function entryForRole(entry: Doc<"boxEntries">, role: AuthContext["role"]) {
  if (canViewCost(role)) return entry;
  const { purchasePricePaise: _cost, ...rest } = entry;
  void _cost;
  return rest;
}

/** Items inside one box, with the item's name, code and category. */
export const listForBox = query({
  args: { boxId: v.id("boxes") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    await getCompanyBox(ctx, auth.organizationId, args.boxId, true);
    const entries = await listBoxEntries(ctx, args.boxId);
    return await Promise.all(
      entries.map(async (entry) => {
        const product = await ctx.db.get(entry.productId);
        const category = product?.stockCategoryId ? await ctx.db.get(product.stockCategoryId) : null;
        return { ...entryForRole(entry, auth.role), productName: product?.name ?? "Item", sku: product?.sku, categoryName: category?.name };
      }),
    );
  },
});

/** Puts an item into a box with its details and opening stock (gross weight, net weight, pieces). */
export const add = mutation({
  args: {
    boxId: v.id("boxes"),
    productId: v.id("products"),
    ...detailsArgs,
    grossWeightMg: v.number(),
    netWeightMg: v.number(),
    pieces: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const box = await getCompanyBox(ctx, auth.organizationId, args.boxId);
    const product = await ctx.db.get(args.productId);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (await findBoxEntry(ctx, box._id, product._id)) throw new Error(`${product.name} is already in ${boxName(box)}. Edit it there instead.`);
    const { boxId: _b, productId: _p, grossWeightMg, netWeightMg, pieces, ...rawDetails } = args;
    void _b; void _p;
    for (const [value, field] of [[grossWeightMg, "Gross weight"], [netWeightMg, "Net weight"], [pieces, "Pieces"]] as const) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be zero or more`);
    }
    if (netWeightMg > grossWeightMg) throw new Error("Net weight cannot be more than the gross weight");
    if (pieces > 0 && grossWeightMg === 0) throw new Error("Enter the gross weight of the pieces");
    const details = await cleanDetails(ctx, auth, box, rawDetails);
    if (!canViewCost(auth.role)) details.purchasePricePaise = undefined;
    const now = Date.now();
    const entryId = await ctx.db.insert("boxEntries", {
      ...details,
      organizationId: auth.organizationId,
      boxId: box._id,
      productId: product._id,
      weightMg: 0,
      netWeightMg: 0,
      pieces: 0,
      createdAt: now,
    });
    await changeBoxStock(ctx, {
      organizationId: auth.organizationId,
      boxId: box._id,
      boxEntryId: entryId,
      weightDeltaMg: grossWeightMg,
      netDeltaMg: netWeightMg,
      piecesDelta: pieces,
      productId: product._id,
      sourceTable: "box_opening",
      sourceId: entryId,
      at: now,
      note: `Opening stock · ${product.name}`,
    });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "box.add_item",
      entityTable: "boxes",
      entityId: box._id,
      metadata: { boxNumber: box.boxNumber, item: product.name, grossWeightMg, netWeightMg, pieces },
      createdAt: now,
    });
    return entryId;
  },
});

/** Changes an item's details in a box. Stock changes only through purchases, sales, adjustments and transfers. */
export const update = mutation({
  args: { entryId: v.id("boxEntries"), ...detailsArgs },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.deletedAt || entry.organizationId !== auth.organizationId) throw new Error("Item not found in this box");
    const box = await getCompanyBox(ctx, auth.organizationId, entry.boxId, true);
    const { entryId: _e, ...rawDetails } = args;
    void _e;
    const details = await cleanDetails(ctx, auth, box, rawDetails);
    // Roles that can't see the purchase price can't change it either.
    if (!canViewCost(auth.role)) details.purchasePricePaise = entry.purchasePricePaise;
    await ctx.db.replace(entry._id, {
      organizationId: entry.organizationId,
      boxId: entry.boxId,
      productId: entry.productId,
      weightMg: entry.weightMg,
      netWeightMg: entry.netWeightMg,
      pieces: entry.pieces,
      createdAt: entry.createdAt,
      ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)),
    });
  },
});

/** Takes an item out of a box's list. Only when none of it is left in the box. */
export const remove = mutation({
  args: { entryId: v.id("boxEntries") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.deletedAt || entry.organizationId !== auth.organizationId) throw new Error("Item not found in this box");
    if (entry.weightMg !== 0 || entry.pieces !== 0) {
      throw new Error(`This item still has ${(entry.weightMg / 1000).toFixed(3)} g, ${entry.pieces} pcs in the box. Sell, move or adjust it to zero first.`);
    }
    await ctx.db.patch(entry._id, { deletedAt: Date.now() });
  },
});

/**
 * One-time setup for boxes made before items lived in boxes: every item
 * with a default box gets its row in that box, carrying the item's saved
 * details. A box whose stock was never split by item, and that now has
 * exactly one item, has that stock assigned to the item. Safe to run again.
 */
export const setupFromItemList = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const products = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    let itemsAdded = 0;
    const touched = new Set<Id<"boxes">>();
    for (const product of products) {
      if (!product.defaultBoxId) continue;
      const box = await ctx.db.get(product.defaultBoxId);
      if (!box || box.deletedAt || box.organizationId !== auth.organizationId) continue;
      if (await findBoxEntry(ctx, box._id, product._id)) continue;
      await ensureBoxEntry(ctx, { organizationId: auth.organizationId, boxId: box._id, productId: product._id, details: entryDefaultsFromProduct(product) });
      itemsAdded++;
      touched.add(box._id);
    }
    let stockAssigned = 0;
    for (const boxId of touched) {
      const box = (await ctx.db.get(boxId))!;
      const entries = await listBoxEntries(ctx, boxId);
      if (entries.length !== 1 || entries[0].weightMg !== 0 || entries[0].pieces !== 0) continue;
      const balance = await readBoxBalance(ctx, box);
      if (balance.weightMg <= 0 && balance.pieces <= 0) continue;
      // Older stock had only gross weight: net starts equal to it.
      await ctx.db.patch(entries[0]._id, { weightMg: Math.max(0, balance.weightMg), netWeightMg: Math.max(0, balance.weightMg), pieces: Math.max(0, balance.pieces) });
      if (box.weightMg === undefined) await ctx.db.patch(box._id, { weightMg: balance.weightMg, pieces: balance.pieces, itemCount: balance.pieces });
      stockAssigned++;
    }
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "box.setup_items",
      entityTable: "boxes",
      entityId: auth.organizationId,
      metadata: { itemsAdded, stockAssigned },
      createdAt: Date.now(),
    });
    return { itemsAdded, stockAssigned };
  },
});
