import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("stockGroups")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .collect();
  },
});

export const create = mutation({
  args: { name: v.string(), parentId: v.optional(v.id("stockGroups")) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    return await ctx.db.insert("stockGroups", {
      organizationId: auth.organizationId,
      name,
      parentId: args.parentId,
    });
  },
});
