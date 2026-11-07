import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

/** Latest rate per active purity — "current rate" is always a read of the append-only log, never a mutable field. */
export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const purities = await ctx.db
      .query("metalPurities")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    const rates = await Promise.all(
      purities.map(async (purity) => {
        const latest = await ctx.db
          .query("metalRates")
          .withIndex("by_org_and_purity", (q) =>
            q.eq("organizationId", auth.organizationId).eq("metalPurityId", purity._id),
          )
          .order("desc")
          .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
        return { purity, latest };
      }),
    );
    return rates;
  },
});

export const getHistory = query({
  args: { metalPurityId: v.id("metalPurities") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("metalRates")
      .withIndex("by_org_and_purity", (q) =>
        q.eq("organizationId", auth.organizationId).eq("metalPurityId", args.metalPurityId),
      )
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(100);
  },
});

export const setRate = mutation({
  args: {
    metalPurityId: v.id("metalPurities"),
    ratePerGramPaise: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (!Number.isInteger(args.ratePerGramPaise) || args.ratePerGramPaise <= 0) {
      throw new Error("Rate must be a positive integer number of paise per gram");
    }
    const purity = await ctx.db.get(args.metalPurityId);
    if (!purity || purity.deletedAt || purity.organizationId !== auth.organizationId) throw new Error("Not found");

    await ctx.db.insert("metalRates", {
      organizationId: auth.organizationId,
      metalPurityId: args.metalPurityId,
      ratePerGramPaise: args.ratePerGramPaise,
      effectiveAt: Date.now(),
      setByUserId: auth.userId,
    });
  },
});
