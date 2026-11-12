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
    if (!boxItem || boxItem.deletedAt || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (boxItem.status !== "in_stock") throw new Error("Only in-stock items can be adjusted");

    const deltaMg = args.newNetWeightMg - boxItem.netWeightMg;
    if (deltaMg === 0) throw new Error("New weight matches the current weight — nothing to adjust");

    const now = Date.now();
    await ctx.db.patch(args.boxItemId, { netWeightMg: args.newNetWeightMg });

    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId: boxItem.productId,
      boxItemId: args.boxItemId,
      boxId: boxItem.boxId,
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
    if (!boxItem || boxItem.deletedAt || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (boxItem.status !== "in_stock") throw new Error("Only in-stock items can be written off");

    const box = await ctx.db.get(boxItem.boxId);
    const now = Date.now();

    await ctx.db.patch(args.boxItemId, { status: "written_off" });
    if (box) await ctx.db.patch(box._id, { itemCount: Math.max(0, (box.itemCount ?? 0) - 1) });

    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId: boxItem.productId,
      boxItemId: args.boxItemId,
      boxId: boxItem.boxId,
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
      .filter((q) => q.or(q.eq(q.field("action"), "stock.correct_weight"), q.or(q.eq(q.field("action"), "stock.write_off"), q.eq(q.field("action"), "stock.adjust_box"))))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(100);
  },
});

/** Apply an audited box-level correction. Weight deltas are distributed across the remaining pieces. */
export const adjustBox = mutation({
  args: { boxId: v.id("boxes"), addWeightMg: v.number(), deductWeightMg: v.number(), addPieces: v.number(), deductPieces: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required for every stock adjustment");
    for (const value of [args.addWeightMg, args.deductWeightMg, args.addPieces, args.deductPieces]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Enter non-negative whole values (weight in milligrams)");
    }
    if (!(args.addWeightMg || args.deductWeightMg || args.addPieces || args.deductPieces)) throw new Error("Enter an adjustment first");
    const box = await ctx.db.get(args.boxId);
    if (!box || box.deletedAt || box.organizationId !== auth.organizationId) throw new Error("Box not found");
    const items = await ctx.db.query("boxItems").withIndex("by_box", q => q.eq("boxId", box._id))
      .filter(q => q.eq(q.field("status"), "in_stock")).filter(q => q.eq(q.field("deletedAt"), undefined)).collect();
    if (args.deductPieces > items.length) throw new Error("Cannot deduct more pieces than the box contains");
    const currentWeight = items.reduce((sum, item) => sum + item.netWeightMg, 0);
    const targetWeight = currentWeight + args.addWeightMg - args.deductWeightMg;
    if (targetWeight < 0) throw new Error("Deducted weight cannot exceed the box weight");
    const removed = [...items].sort((a,b) => b.createdAt - a.createdAt).slice(0, args.deductPieces);
    const retained = items.filter(item => !removed.some(row => row._id === item._id));
    const finalCount = retained.length + args.addPieces;
    if (targetWeight > 0 && finalCount === 0) throw new Error("Add at least one piece to keep the adjusted weight in inventory");
    const now = Date.now();
    for (const item of removed) {
      await ctx.db.patch(item._id, { status: "written_off" });
      await ctx.db.insert("stockMovements", { organizationId: auth.organizationId, productId: item.productId, boxItemId: item._id, boxId: box._id, direction: "out", netWeightMg: item.netWeightMg, quantity: 1, sourceTable: "stock_adjustments", sourceId: item._id, createdAt: now });
    }
    if (args.addPieces) {
      const template = retained[0] ?? items[0];
      if (!template) throw new Error("This box has no item type to add. Add a purchase item to the box first.");
      const totalAddedWeight = Math.max(0, targetWeight - retained.reduce((sum, item) => sum + item.netWeightMg, 0));
      if (!totalAddedWeight && args.addPieces) throw new Error("Enter added weight when adding pieces to an empty-weight box");
      const base = Math.floor(totalAddedWeight / args.addPieces);
      let remainder = totalAddedWeight - base * args.addPieces;
      for (let i = 0; i < args.addPieces; i++) {
        const weight = base + (remainder-- > 0 ? 1 : 0);
        const id = await ctx.db.insert("boxItems", { organizationId: auth.organizationId, boxId: box._id, productId: template.productId, label: template.label, grossWeightMg: weight, stoneWeightMg: 0, netWeightMg: weight, status: "in_stock", createdAt: now });
        await ctx.db.insert("stockMovements", { organizationId: auth.organizationId, productId: template.productId, boxItemId: id, boxId: box._id, direction: "in", netWeightMg: weight, quantity: 1, sourceTable: "stock_adjustments", sourceId: id, createdAt: now });
      }
    }
    const retainedWeight = retained.reduce((sum, item) => sum + item.netWeightMg, 0);
    const addedWeight = args.addPieces ? Math.max(0, targetWeight - retainedWeight) : 0;
    const desiredRetainedWeight = targetWeight - addedWeight;
    let delta = desiredRetainedWeight - retainedWeight;
    for (const item of retained) {
      if (!delta) break;
      const step = delta > 0 ? delta : -Math.min(item.netWeightMg, -delta);
      await ctx.db.patch(item._id, { netWeightMg: item.netWeightMg + step });
      if (step) await ctx.db.insert("stockMovements", { organizationId: auth.organizationId, productId: item.productId, boxItemId: item._id, boxId: box._id, direction: step > 0 ? "in" : "out", netWeightMg: Math.abs(step), quantity: 0, sourceTable: "stock_adjustments", sourceId: item._id, createdAt: now });
      delta -= step;
    }
    await ctx.db.patch(box._id, { itemCount: finalCount });
    await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: "stock.adjust_box", entityTable: "boxes", entityId: box._id, metadata: { boxNumber: box.boxNumber, addWeightMg: args.addWeightMg, deductWeightMg: args.deductWeightMg, addPieces: args.addPieces, deductPieces: args.deductPieces, reason }, createdAt: now });
  },
});
