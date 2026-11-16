import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { normalizeCustomFieldValues } from "./lib/customFieldValues";
import { changeItemStock, isGstCompanyType } from "./lib/itemStock";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type Pricing = {
  salePricePaise?: number; salePriceIncludesTax?: boolean; saleDiscountMode?: "percent" | "amount"; saleDiscountValue?: number;
  wholesalePricePaise?: number; wholesaleMinQty?: number; purchasePricePaise?: number; purchasePriceIncludesTax?: boolean;
  taxConfigurationId?: Id<"taxConfigurations">; grossWeightMg?: number; netWeightMg?: number; makingChargePaise?: number;
  openingAtPricePaise?: number; openingAsOfMs?: number; location?: string; imageStorageId?: Id<"_storage">;
};

async function checkPricing(ctx: QueryCtx, organizationId: Id<"organizations">, p: Pricing) {
  const money = [p.salePricePaise, p.wholesalePricePaise, p.purchasePricePaise, p.makingChargePaise, p.openingAtPricePaise, p.grossWeightMg, p.netWeightMg, p.wholesaleMinQty, p.saleDiscountValue];
  if (money.some((n) => n !== undefined && (!Number.isSafeInteger(n) || n < 0))) throw new Error("Prices, weights and quantities must be valid amounts of zero or more");
  if (p.saleDiscountMode === "percent" && (p.saleDiscountValue ?? 0) > 10000) throw new Error("Discount cannot be more than 100%");
  if (p.grossWeightMg !== undefined && p.netWeightMg !== undefined && p.netWeightMg > p.grossWeightMg) throw new Error("Net weight cannot be more than gross weight");
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
    taxConfigurationId: p.taxConfigurationId, grossWeightMg: p.grossWeightMg, netWeightMg: p.netWeightMg,
    makingChargePaise: p.makingChargePaise, openingAtPricePaise: p.openingAtPricePaise, openingAsOfMs: p.openingAsOfMs,
    location: p.location?.trim() || undefined, imageStorageId: p.imageStorageId,
  };
}

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
      const row = await ctx.db.query("productStock").withIndex("by_org_and_product", (q) => q.eq("organizationId", auth.organizationId).eq("productId", args.id)).first();
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
    return await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
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
    // GST companies only: opening stock goes straight into item stock.
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
    const productId = await ctx.db.insert("products", {
      organizationId: auth.organizationId,
      ...pricingFields(args),
      name,
      description: args.description?.trim() || undefined,
      sku: args.sku?.trim() || undefined,
      itemType: args.itemType ?? "product",
      stockGroupId: args.stockGroupId,
      stockCategoryId: args.stockCategoryId,
      metalPurityId: args.metalPurityId,
      unit: args.unit,
      hsnCode: args.hsnCode?.trim() || undefined,
      reorderLevelMg: args.reorderLevelMg,
      customFields,
      isActive: true,
      createdAt: Date.now(),
    });
    const openingWeightMg = args.openingWeightMg ?? 0;
    const openingPieces = args.openingPieces ?? 0;
    if (openingWeightMg || openingPieces) {
      const company = await ctx.db.get(auth.organizationId);
      if (!isGstCompanyType(company?.companyType)) throw new Error("Opening stock here is for GST companies. In Daily Sales, add stock into a box.");
      if (!Number.isSafeInteger(openingWeightMg) || openingWeightMg < 0 || !Number.isSafeInteger(openingPieces) || openingPieces < 0) throw new Error("Enter a valid opening weight and pieces");
      await changeItemStock(ctx, { organizationId: auth.organizationId, productId, weightDeltaMg: openingWeightMg, piecesDelta: openingPieces, sourceTable: "opening_stock", sourceId: productId, at: args.openingAsOfMs ?? Date.now() });
    }
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
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Product not found");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const customFields = await normalizeCustomFieldValues(ctx, auth.organizationId, "product", args.customFields);
    await checkPricing(ctx, auth.organizationId, args);
    if (existing.imageStorageId && existing.imageStorageId !== args.imageStorageId) await ctx.storage.delete(existing.imageStorageId);
    await ctx.db.patch(args.id, {
      ...pricingFields(args),
      name,
      description: args.description?.trim() || undefined,
      sku: args.sku?.trim() || undefined,
      itemType: args.itemType ?? "product",
      stockGroupId: args.stockGroupId,
      stockCategoryId: args.stockCategoryId,
      metalPurityId: args.metalPurityId,
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
