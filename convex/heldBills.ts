import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

/** Bills put on hold at the counter, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const held = await ctx.db
      .query("heldBills")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .collect();
    // The saved form is only needed when a bill is reopened, so the list leaves it out.
    return held.map((h) => ({
      _id: h._id,
      customerName: h.customerName,
      itemCount: h.itemCount,
      totalPaise: h.totalPaise,
      createdByUserId: h.createdByUserId,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    }));
  },
});

/** One held bill with its saved form, to reopen it in New Bill. Null once it has been billed or deleted. */
export const get = query({
  args: { heldBillId: v.id("heldBills") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const held = await ctx.db.get(args.heldBillId);
    if (!held || held.organizationId !== auth.organizationId) return null;
    return held;
  },
});

/** Parks the bill being written. Pass heldBillId to re-hold a bill that was reopened. */
export const hold = mutation({
  args: {
    heldBillId: v.optional(v.id("heldBills")),
    customerName: v.string(),
    itemCount: v.number(),
    totalPaise: v.number(),
    draft: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);
    if (args.draft.length > 500_000) throw new ConvexError("This bill is too large to hold.");
    const now = Date.now();
    const fields = {
      customerName: args.customerName.trim().slice(0, 120) || "Walk-in customer",
      itemCount: args.itemCount,
      totalPaise: args.totalPaise,
      draft: args.draft,
      updatedAt: now,
    };
    if (args.heldBillId) {
      const existing = await ctx.db.get(args.heldBillId);
      if (existing && existing.organizationId === auth.organizationId) {
        await ctx.db.patch(existing._id, fields);
        return existing._id;
      }
    }
    return await ctx.db.insert("heldBills", {
      ...fields,
      organizationId: auth.organizationId,
      createdByUserId: auth.userId,
      createdAt: now,
    });
  },
});

/** Drops a held bill (the customer left, or it was billed). */
export const remove = mutation({
  args: { heldBillId: v.id("heldBills") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);
    const held = await ctx.db.get(args.heldBillId);
    if (!held || held.organizationId !== auth.organizationId) return;
    await ctx.db.delete(held._id);
  },
});
