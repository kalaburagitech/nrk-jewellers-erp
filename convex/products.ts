import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .take(500);
  },
});

const unit = v.union(v.literal("gram"), v.literal("kilogram"), v.literal("piece"), v.literal("carat"));

export const create = mutation({
  args: {
    name: v.string(),
    sku: v.optional(v.string()),
    stockGroupId: v.optional(v.id("stockGroups")),
    stockCategoryId: v.optional(v.id("stockCategories")),
    metalPurityId: v.optional(v.id("metalPurities")),
    unit,
    hsnCode: v.optional(v.string()),
    reorderLevelMg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");

    return await ctx.db.insert("products", {
      organizationId: auth.organizationId,
      name,
      sku: args.sku?.trim() || undefined,
      stockGroupId: args.stockGroupId,
      stockCategoryId: args.stockCategoryId,
      metalPurityId: args.metalPurityId,
      unit: args.unit,
      hsnCode: args.hsnCode?.trim() || undefined,
      reorderLevelMg: args.reorderLevelMg,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const setActive = mutation({
  args: { id: v.id("products"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});
