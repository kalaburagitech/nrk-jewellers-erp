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
    return {
      pinSalt: record.pinSalt,
      pinHash: record.pinHash,
      failedAttempts: record.failedAttempts ?? 0,
      lockedUntil: record.lockedUntil,
    };
  },
});

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60_000;

/** Tracks consecutive failed PIN attempts and locks the PIN out for a cooldown after too many — a 4-6 digit PIN has too small a keyspace to leave unthrottled. */
export const recordPinAttempt = internalMutation({
  args: { userId: v.id("users"), success: v.boolean() },
  handler: async (ctx, args): Promise<{ lockedUntil?: number }> => {
    const record = await ctx.db.query("appSecurity").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!record) return {};
    if (args.success) {
      await ctx.db.patch(record._id, { failedAttempts: 0, lockedUntil: undefined });
      return {};
    }
    const failedAttempts = (record.failedAttempts ?? 0) + 1;
    const lockedUntil = failedAttempts >= MAX_PIN_ATTEMPTS ? Date.now() + LOCKOUT_MS : record.lockedUntil;
    await ctx.db.patch(record._id, { failedAttempts, lockedUntil });
    return { lockedUntil };
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
    if (existing) throw new Error("A passcode is already set for this account.");
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
    if (existing) await ctx.db.patch(existing._id, { pinSalt: args.pinSalt, pinHash: args.pinHash, organizationId: args.organizationId, updatedAt: now, failedAttempts: 0, lockedUntil: undefined });
    else await ctx.db.insert("appSecurity", { ...args, createdAt: now, updatedAt: now });
  },
});
