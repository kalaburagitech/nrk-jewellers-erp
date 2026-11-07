import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("taxConfigurations")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    cgstBasisPoints: v.number(),
    sgstBasisPoints: v.number(),
    igstBasisPoints: v.number(),
    hsnCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    for (const bp of [args.cgstBasisPoints, args.sgstBasisPoints, args.igstBasisPoints]) {
      if (bp < 0 || bp > 10000) throw new Error("Tax percentage must be between 0 and 100");
    }

    return await ctx.db.insert("taxConfigurations", {
      organizationId: auth.organizationId,
      name,
      cgstBasisPoints: args.cgstBasisPoints,
      sgstBasisPoints: args.sgstBasisPoints,
      igstBasisPoints: args.igstBasisPoints,
      hsnCode: args.hsnCode?.trim() || undefined,
      isActive: true,
    });
  },
});

export const setActive = mutation({
  args: { id: v.id("taxConfigurations"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt || row.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});
