import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("boxes")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("asc")
      .take(1000);
  },
});

export const getItems = query({
  args: { boxId: v.id("boxes") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const box = await ctx.db.get(args.boxId);
    if (!box || box.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("boxItems")
      .withIndex("by_box", (q) => q.eq("boxId", args.boxId))
      .filter((q) => q.eq(q.field("status"), "in_stock"))
      .collect();
  },
});

/** Creates the next sequential box above the current highest number — boxes are never user-numbered to avoid collisions. */
export const createNext = mutation({
  args: { label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);

    const highest = await ctx.db
      .query("boxes")
      .withIndex("by_org_and_number", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .first();

    const boxNumber = (highest?.boxNumber ?? 100) + 1;
    return await ctx.db.insert("boxes", {
      organizationId: auth.organizationId,
      boxNumber,
      label: args.label?.trim() || undefined,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});
