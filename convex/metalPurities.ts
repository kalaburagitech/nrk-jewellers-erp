import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("metalPurities")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

export const create = mutation({
  args: {
    metal: v.union(v.literal("gold"), v.literal("silver")),
    label: v.string(),
    purityBasisPoints: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (args.purityBasisPoints <= 0 || args.purityBasisPoints > 10000) {
      throw new Error("Purity must be between 0 and 100%");
    }
    return await ctx.db.insert("metalPurities", {
      organizationId: auth.organizationId,
      metal: args.metal,
      label: args.label.trim(),
      purityBasisPoints: args.purityBasisPoints,
      isActive: true,
    });
  },
});

export const setActive = mutation({
  args: { id: v.id("metalPurities"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt || row.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});
