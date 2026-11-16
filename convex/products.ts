import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
import { normalizeCustomFieldValues } from "./lib/customFieldValues";

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

// Optional Vyapar-style item pricing and jewellery defaults.
const pricingArgs = {
  salePricePaise: v.optional(v.number()),
  salePriceIncludesTax: v.optional(v.boolean()),
  saleDiscountBasisPoints: v.optional(v.number()),
  purchasePricePaise: v.optional(v.number()),
  purchasePriceIncludesTax: v.optional(v.boolean()),
  taxConfigurationId: v.optional(v.id("taxConfigurations")),
  defaultGrossWeightMg: v.optional(v.number()),
  defaultNetWeightMg: v.optional(v.number()),
  defaultMakingChargePaise: v.optional(v.number()),
  location: v.optional(v.string()),
};

type PricingInput = {
  salePricePaise?: number;
  salePriceIncludesTax?: boolean;
  saleDiscountBasisPoints?: number;
  purchasePricePaise?: number;
  purchasePriceIncludesTax?: boolean;
  taxConfigurationId?: Id<"taxConfigurations">;
  defaultGrossWeightMg?: number;
  defaultNetWeightMg?: number;
  defaultMakingChargePaise?: number;
  location?: string;
};

function nonNegative(value: number | undefined, label: string) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} cannot be negative`);
  return Math.round(value);
}

function pricingFields(args: PricingInput) {
  const gross = nonNegative(args.defaultGrossWeightMg, "Gross weight");
  const net = nonNegative(args.defaultNetWeightMg, "Net weight");
  if (gross !== undefined && net !== undefined && net > gross) throw new Error("Net weight cannot be more than gross weight");
  const discount = nonNegative(args.saleDiscountBasisPoints, "Discount");
  if (discount !== undefined && discount > 10000) throw new Error("Discount cannot be more than 100%");
  return {
    salePricePaise: nonNegative(args.salePricePaise, "Sale price"),
    salePriceIncludesTax: args.salePriceIncludesTax,
    saleDiscountBasisPoints: discount,
    purchasePricePaise: nonNegative(args.purchasePricePaise, "Purchase price"),
    purchasePriceIncludesTax: args.purchasePriceIncludesTax,
    taxConfigurationId: args.taxConfigurationId,
    defaultGrossWeightMg: gross,
    defaultNetWeightMg: net,
    defaultMakingChargePaise: nonNegative(args.defaultMakingChargePaise, "Making charge"),
    location: args.location?.trim() || undefined,
  };
}

async function assertTaxConfig(ctx: MutationCtx, organizationId: Id<"organizations">, id: Id<"taxConfigurations"> | undefined) {
  if (!id) return;
  const config = await ctx.db.get(id);
  if (!config || config.deletedAt || config.organizationId !== organizationId) throw new Error("Tax rate not found");
}

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
    ...pricingArgs,
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const customFields = await normalizeCustomFieldValues(ctx, auth.organizationId, "product", args.customFields);
    await assertTaxConfig(ctx, auth.organizationId, args.taxConfigurationId);

    return await ctx.db.insert("products", {
      organizationId: auth.organizationId,
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
      ...pricingFields(args),
      isActive: true,
      createdAt: Date.now(),
    });
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
    ...pricingArgs,
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Product not found");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const customFields = await normalizeCustomFieldValues(ctx, auth.organizationId, "product", args.customFields);
    await assertTaxConfig(ctx, auth.organizationId, args.taxConfigurationId);
    await ctx.db.patch(args.id, {
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
      ...pricingFields(args),
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
