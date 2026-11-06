import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

/** Corrects a box item's recorded weight (e.g. a physical audit found a scale error) — logs the delta as a stock movement, never silently overwrites without a trail. */
export const correctWeight = mutation({
  args: { boxItemId: v.id("boxItems"), newNetWeightMg: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);

    if (args.newNetWeightMg < 0) throw new Error("Weight cannot be negative");
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required for every stock adjustment");

    const boxItem = await ctx.db.get(args.boxItemId);
    if (!boxItem || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (boxItem.status !== "in_stock") throw new Error("Only in-stock items can be adjusted");

    const deltaMg = args.newNetWeightMg - boxItem.netWeightMg;
    if (deltaMg === 0) throw new Error("New weight matches the current weight — nothing to adjust");

    const now = Date.now();
    await ctx.db.patch(args.boxItemId, { netWeightMg: args.newNetWeightMg });

    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId: boxItem.productId,
      boxItemId: args.boxItemId,
      direction: deltaMg > 0 ? "in" : "out",
      netWeightMg: Math.abs(deltaMg),
      quantity: 0,
      sourceTable: "stock_adjustments",
      sourceId: args.boxItemId,
      createdAt: now,
    });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "stock.correct_weight",
      entityTable: "boxItems",
      entityId: args.boxItemId,
      metadata: { label: boxItem.label, fromMg: boxItem.netWeightMg, toMg: args.newNetWeightMg, reason },
      createdAt: now,
    });
  },
});

/** Removes an item from stock entirely (loss, damage, theft) — a dedicated status + audit trail, not a silent delete. */
export const writeOff = mutation({
  args: { boxItemId: v.id("boxItems"), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);

    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required for every stock adjustment");

    const boxItem = await ctx.db.get(args.boxItemId);
    if (!boxItem || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (boxItem.status !== "in_stock") throw new Error("Only in-stock items can be written off");

    const box = await ctx.db.get(boxItem.boxId);
    const now = Date.now();

    await ctx.db.patch(args.boxItemId, { status: "written_off" });
    if (box) await ctx.db.patch(box._id, { itemCount: Math.max(0, (box.itemCount ?? 0) - 1) });

    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId: boxItem.productId,
      boxItemId: args.boxItemId,
      direction: "out",
      netWeightMg: boxItem.netWeightMg,
      quantity: 1,
      sourceTable: "stock_adjustments",
      sourceId: args.boxItemId,
      createdAt: now,
    });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "stock.write_off",
      entityTable: "boxItems",
      entityId: args.boxItemId,
      metadata: { label: boxItem.label, netWeightMg: boxItem.netWeightMg, reason },
      createdAt: now,
    });
  },
});

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.or(q.eq(q.field("action"), "stock.correct_weight"), q.eq(q.field("action"), "stock.write_off")))
      .order("desc")
      .take(100);
  },
});
