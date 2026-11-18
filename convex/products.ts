import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canOverridePrice, canViewCost, requireAuthContext, requireRole } from "./lib/auth";
import { resolveKaratPurity } from "./lib/purity";
import type { MutationCtx } from "./_generated/server";
import type { PurityKarat } from "../src/lib/jewelry-calc";
import { normalizeCustomFieldValues } from "./lib/customFieldValues";
import { changeItemStock, gstStockByProduct, isGstCompanyType } from "./lib/itemStock";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type Pricing = {
  salePricePaise?: number; salePriceIncludesTax?: boolean; saleDiscountMode?: "percent" | "amount"; saleDiscountValue?: number;
  wholesalePricePaise?: number; wholesaleMinQty?: number; purchasePricePaise?: number; purchasePriceIncludesTax?: boolean;
  taxConfigurationId?: Id<"taxConfigurations">; grossWeightMg?: number; netWeightMg?: number; makingChargePaise?: number;
  openingAtPricePaise?: number; openingAsOfMs?: number; location?: string; imageStorageId?: Id<"_storage">;
  stoneWeightMg?: number; wastageBasisPoints?: number; defaultBoxId?: Id<"boxes">; purityOther?: string;
};

async function checkPricing(ctx: QueryCtx, organizationId: Id<"organizations">, p: Pricing) {
  const money = [p.salePricePaise, p.wholesalePricePaise, p.purchasePricePaise, p.makingChargePaise, p.openingAtPricePaise, p.grossWeightMg, p.netWeightMg, p.wholesaleMinQty, p.saleDiscountValue, p.stoneWeightMg, p.wastageBasisPoints];
  if (money.some((n) => n !== undefined && (!Number.isSafeInteger(n) || n < 0))) throw new Error("Prices, weights and quantities must be valid amounts of zero or more");
  if (p.saleDiscountMode === "percent" && (p.saleDiscountValue ?? 0) > 10000) throw new Error("Discount cannot be more than 100%");
  if (p.grossWeightMg !== undefined && p.netWeightMg !== undefined && p.netWeightMg > p.grossWeightMg) throw new Error("Net weight cannot be more than gross weight");
  if (p.stoneWeightMg !== undefined && p.grossWeightMg !== undefined && p.stoneWeightMg > p.grossWeightMg) throw new Error("Stone weight cannot be more than gross weight");
  if (p.stoneWeightMg !== undefined && p.grossWeightMg !== undefined && p.netWeightMg !== undefined && p.netWeightMg > p.grossWeightMg - p.stoneWeightMg) {
    throw new Error("Net weight cannot be more than gross weight minus stone weight");
  }
  if ((p.wastageBasisPoints ?? 0) > 10000) throw new Error("Wastage cannot be more than 100%");
  if (p.defaultBoxId) {
    const box = await ctx.db.get(p.defaultBoxId);
    // Each company has its own boxes — an item can only point at a box of its own company.
    if (!box || box.deletedAt || box.organizationId !== organizationId) throw new Error("Box not found in this company");
  }
  if (p.taxConfigurationId) {
    const tax = await ctx.db.get(p.taxConfigurationId);
    if (!tax || tax.organizationId !== organizationId || tax.deletedAt) throw new Error("Tax rate not found");
  }
}

function pricingFields(p: Pricing) {
  return {
    salePricePaise: p.salePricePaise, salePriceIncludesTax: p.salePriceIncludesTax,
    saleDiscountMode: p.saleDiscountValue ? p.saleDiscountMode : undefined, saleDiscountValue: p.saleDiscountValue || undefined,
    wholesalePricePaise: p.wholesalePricePaise, wholesaleMinQty: p.wholesalePricePaise ? p.wholesaleMinQty : undefined,
    purchasePricePaise: p.purchasePricePaise, purchasePriceIncludesTax: p.purchasePriceIncludesTax,
    taxConfigurationId: p.taxConfigurationId, grossWeightMg: p.grossWeightMg,
    makingChargePaise: p.makingChargePaise, openingAtPricePaise: p.openingAtPricePaise, openingAsOfMs: p.openingAsOfMs,
    location: p.location?.trim() || undefined, imageStorageId: p.imageStorageId,
    stoneWeightMg: p.stoneWeightMg, wastageBasisPoints: p.wastageBasisPoints || undefined, defaultBoxId: p.defaultBoxId,
    // Net weight defaults to gross − stone when only those are given.
    netWeightMg: p.netWeightMg ?? (p.grossWeightMg !== undefined && p.stoneWeightMg !== undefined ? p.grossWeightMg - p.stoneWeightMg : undefined),
    purityOther: p.purityOther?.trim().slice(0, 40) || undefined,
  };
}

const PURITY_KARAT = v.union(
  v.literal("24K"), v.literal("22K"), v.literal("20K"), v.literal("18K"), v.literal("14K"), v.literal("12K"), v.literal("10K"), v.literal("9K"),
);

/** A chosen karat becomes the matching gold purity row; "Other" keeps any purity row plus the typed text. */
async function resolvePurity(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  args: { metalPurityId?: Id<"metalPurities">; purityKarat?: PurityKarat },
) {
  if (args.purityKarat) return await resolveKaratPurity(ctx, organizationId, args.purityKarat);
  if (args.metalPurityId) {
    const purity = await ctx.db.get(args.metalPurityId);
    if (!purity || purity.deletedAt || purity.organizationId !== organizationId) throw new Error("Purity not found");
  }
  return args.metalPurityId;
}

/**
 * Opening stock for a new item. With a box: one piece per quantity is put in
 * that box at the item's weights (both company types). Without a box: GST
 * companies add loose item stock; Daily Sales needs a box.
 */
async function postOpeningStock(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  product: { _id: Id<"products">; name: string; defaultBoxId?: Id<"boxes">; grossWeightMg?: number; stoneWeightMg?: number },
  opening: { pieces: number; weightMg: number; at: number },
) {
  if (!Number.isSafeInteger(opening.weightMg) || opening.weightMg < 0 || !Number.isSafeInteger(opening.pieces) || opening.pieces < 0) throw new Error("Enter a valid opening weight and pieces");
  if (!opening.pieces && !opening.weightMg) return;
  const company = await ctx.db.get(organizationId);
  const gst = isGstCompanyType(company?.companyType);
  if (product.defaultBoxId && opening.pieces > 0) {
    if (opening.pieces > 500) throw new Error("Opening quantity can be at most 500 pieces at a time");
    const box = await ctx.db.get(product.defaultBoxId);
    if (!box || box.deletedAt || box.organizationId !== organizationId) throw new Error("Box not found in this company");
    // Per-piece weight: the item's gross weight, else the opening weight shared across the pieces.
    const grossWeightMg = product.grossWeightMg ?? Math.floor(opening.weightMg / opening.pieces);
    const stoneWeightMg = Math.min(product.stoneWeightMg ?? 0, grossWeightMg);
    if (grossWeightMg <= 0) throw new Error("Enter the item's gross weight (or the opening weight) to put opening pieces into the box");
    for (let i = 0; i < opening.pieces; i++) {
      const boxItemId = await ctx.db.insert("boxItems", {
        organizationId,
        boxId: box._id,
        productId: product._id,
        label: opening.pieces === 1 ? product.name : `${product.name} ${i + 1}`,
        grossWeightMg,
        stoneWeightMg,
        netWeightMg: grossWeightMg - stoneWeightMg,
        status: "in_stock",
        createdAt: opening.at,
      });
      await ctx.db.insert("stockMovements", {
        organizationId, productId: product._id, boxItemId, boxId: box._id, direction: "in",
        netWeightMg: grossWeightMg - stoneWeightMg, quantity: 1, sourceTable: "opening_stock", sourceId: product._id, createdAt: opening.at,
      });
    }
    await ctx.db.patch(box._id, { itemCount: (box.itemCount ?? 0) + opening.pieces });
    return;
  }
  if (!gst) throw new Error("Choose the box for the opening stock. Daily Sales stock is kept in boxes.");
  await changeItemStock(ctx, { organizationId, productId: product._id, weightDeltaMg: opening.weightMg, piecesDelta: opening.pieces, sourceTable: "opening_stock", sourceId: product._id, at: opening.at });
}

/** Purchase price is internal: hidden from the billing counter and staff. */
function withoutCostFor<T extends { purchasePricePaise?: number; purchasePriceIncludesTax?: boolean }>(role: Parameters<typeof canViewCost>[0], product: T): T {
  if (canViewCost(role)) return product;
  const { purchasePricePaise: _cost, purchasePriceIncludesTax: _inc, ...rest } = product;
  void _cost;
  void _inc;
  return rest as T;
}

/** What the signed-in user may do with prices (drives the bill screen). */
export const myPricingAccess = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return { canViewCost: canViewCost(auth.role), canOverridePrice: canOverridePrice(auth.role) };
  },
});

export const generateImageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Image URL + live stock (box pieces for Daily Sales, item stock for GST) for the item detail panel. */
export const details = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const product = await ctx.db.get(args.id);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) return null;
    const company = await ctx.db.get(auth.organizationId);
    let weightMg = 0;
    let pieces = 0;
    if (isGstCompanyType(company?.companyType)) {
      const row = (await gstStockByProduct(ctx, auth.organizationId)).get(args.id);
      weightMg = row?.weightMg ?? 0;
      pieces = row?.pieces ?? 0;
    } else {
      const items = await ctx.db.query("boxItems").withIndex("by_product", (q) => q.eq("productId", args.id)).collect();
      for (const i of items) if (!i.deletedAt && i.status === "in_stock") { weightMg += i.netWeightMg; pieces += 1; }
    }
    const tax = product.taxConfigurationId ? await ctx.db.get(product.taxConfigurationId) : null;
    return {
      imageUrl: product.imageStorageId ? await ctx.storage.getUrl(product.imageStorageId) : null,
      weightMg,
      pieces,
      isGstCompany: isGstCompanyType(company?.companyType),
      taxName: tax?.name ?? null,
      lowStock: product.reorderLevelMg !== undefined && weightMg < product.reorderLevelMg,
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const products = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    return products.map((p) => withoutCostFor(auth.role, p));
  },
});

const unit = v.union(v.literal("gram"), v.literal("kilogram"), v.literal("piece"), v.literal("carat"));

const itemType = v.optional(v.union(v.literal("product"), v.literal("service")));

export const create = mutation({
  args: {
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
    salePricePaise: v.optional(v.number()),
    salePriceIncludesTax: v.optional(v.boolean()),
    saleDiscountMode: v.optional(v.union(v.literal("percent"), v.literal("amount"))),
    saleDiscountValue: v.optional(v.number()),
    wholesalePricePaise: v.optional(v.number()),
    wholesaleMinQty: v.optional(v.number()),
    purchasePricePaise: v.optional(v.number()),
    purchasePriceIncludesTax: v.optional(v.boolean()),
    taxConfigurationId: v.optional(v.id("taxConfigurations")),
    grossWeightMg: v.optional(v.number()),
    netWeightMg: v.optional(v.number()),
    makingChargePaise: v.optional(v.number()),
    openingAtPricePaise: v.optional(v.number()),
    openingAsOfMs: v.optional(v.number()),
    location: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    stoneWeightMg: v.optional(v.number()),
    wastageBasisPoints: v.optional(v.number()),
    defaultBoxId: v.optional(v.id("boxes")),
    purityKarat: v.optional(PURITY_KARAT),
    purityOther: v.optional(v.string()),
    // Opening stock: pieces into the item's box, or (GST, no box) loose item stock.
    openingWeightMg: v.optional(v.number()),
    openingPieces: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const customFields = await normalizeCustomFieldValues(ctx, auth.organizationId, "product", args.customFields);

    await checkPricing(ctx, auth.organizationId, args);
    if (args.purchasePricePaise !== undefined && !canViewCost(auth.role)) throw new Error("Only the Owner, Admin, Accountant or managers can set the purchase price.");
    const metalPurityId = await resolvePurity(ctx, auth.organizationId, args);
    const productId = await ctx.db.insert("products", {
      organizationId: auth.organizationId,
      ...pricingFields(args),
      name,
      description: args.description?.trim() || undefined,
      sku: args.sku?.trim() || undefined,
      itemType: args.itemType ?? "product",
      stockGroupId: args.stockGroupId,
      stockCategoryId: args.stockCategoryId,
      metalPurityId,
      unit: args.unit,
      hsnCode: args.hsnCode?.trim() || undefined,
      reorderLevelMg: args.reorderLevelMg,
      customFields,
      isActive: true,
      createdAt: Date.now(),
    });
    await postOpeningStock(
      ctx,
      auth.organizationId,
      { _id: productId, name, defaultBoxId: args.defaultBoxId, grossWeightMg: args.grossWeightMg, stoneWeightMg: args.stoneWeightMg },
      { pieces: args.openingPieces ?? 0, weightMg: args.openingWeightMg ?? 0, at: args.openingAsOfMs ?? Date.now() },
    );
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId, userId: auth.userId, action: "product.create", entityTable: "products", entityId: productId,
      metadata: { name, salePricePaise: args.salePricePaise, openingPieces: args.openingPieces ?? 0 }, createdAt: Date.now(),
    });
    return productId;
  },
});

export const update = mutation({
  args: {
    id: v.id("products"),
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
    salePricePaise: v.optional(v.number()),
    salePriceIncludesTax: v.optional(v.boolean()),
    saleDiscountMode: v.optional(v.union(v.literal("percent"), v.literal("amount"))),
    saleDiscountValue: v.optional(v.number()),
    wholesalePricePaise: v.optional(v.number()),
    wholesaleMinQty: v.optional(v.number()),
    purchasePricePaise: v.optional(v.number()),
    purchasePriceIncludesTax: v.optional(v.boolean()),
    taxConfigurationId: v.optional(v.id("taxConfigurations")),
    grossWeightMg: v.optional(v.number()),
    netWeightMg: v.optional(v.number()),
    makingChargePaise: v.optional(v.number()),
    openingAtPricePaise: v.optional(v.number()),
    openingAsOfMs: v.optional(v.number()),
    location: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    stoneWeightMg: v.optional(v.number()),
    wastageBasisPoints: v.optional(v.number()),
    defaultBoxId: v.optional(v.id("boxes")),
    purityKarat: v.optional(PURITY_KARAT),
    purityOther: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Product not found");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const customFields = await normalizeCustomFieldValues(ctx, auth.organizationId, "product", args.customFields);
    // A role that can't see the purchase price can't change it either: keep the saved one.
    const costArgs = canViewCost(auth.role) ? args : { ...args, purchasePricePaise: existing.purchasePricePaise, purchasePriceIncludesTax: existing.purchasePriceIncludesTax };
    await checkPricing(ctx, auth.organizationId, costArgs);
    const metalPurityId = await resolvePurity(ctx, auth.organizationId, args);
    if (existing.imageStorageId && existing.imageStorageId !== args.imageStorageId) await ctx.storage.delete(existing.imageStorageId);
    if (existing.salePricePaise !== costArgs.salePricePaise || existing.purchasePricePaise !== costArgs.purchasePricePaise) {
      await ctx.db.insert("auditLogs", {
        organizationId: auth.organizationId, userId: auth.userId, action: "product.price_change", entityTable: "products", entityId: args.id,
        metadata: {
          salePricePaise: { from: existing.salePricePaise ?? null, to: costArgs.salePricePaise ?? null },
          purchasePricePaise: { from: existing.purchasePricePaise ?? null, to: costArgs.purchasePricePaise ?? null },
        },
        createdAt: Date.now(),
      });
    }
    // Editing an item never creates boxes or stock — it only changes the item's details.
    await ctx.db.patch(args.id, {
      ...pricingFields(costArgs),
      name,
      description: args.description?.trim() || undefined,
      sku: args.sku?.trim() || undefined,
      itemType: args.itemType ?? "product",
      stockGroupId: args.stockGroupId,
      stockCategoryId: args.stockCategoryId,
      metalPurityId,
      unit: args.unit,
      hsnCode: args.hsnCode?.trim() || undefined,
      reorderLevelMg: args.reorderLevelMg,
      ...(customFields === undefined ? {} : { customFields }),
    });
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
