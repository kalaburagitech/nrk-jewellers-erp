import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getPinRecord = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("appSecurity")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!record) return null;
    return { pinSalt: record.pinSalt, pinHash: record.pinHash };
  },
});

export const savePin = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    pinSalt: v.string(),
    pinHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appSecurity")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) throw new Error("An app MPIN is already set for this account.");
    const now = Date.now();
    await ctx.db.insert("appSecurity", { ...args, createdAt: now, updatedAt: now });
  },
});

export const replacePin = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    pinSalt: v.string(),
    pinHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("appSecurity")
      .withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { pinSalt: args.pinSalt, pinHash: args.pinHash, organizationId: args.organizationId, updatedAt: now });
    else await ctx.db.insert("appSecurity", { ...args, createdAt: now, updatedAt: now });
  },
});
