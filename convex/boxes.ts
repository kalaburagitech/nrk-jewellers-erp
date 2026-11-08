import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("boxes")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("asc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(1000);
  },
});

export const getItems = query({
  args: { boxId: v.id("boxes") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const box = await ctx.db.get(args.boxId);
    if (!box || box.deletedAt || box.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("boxItems")
      .withIndex("by_box", (q) => q.eq("boxId", args.boxId))
      .filter((q) => q.eq(q.field("status"), "in_stock"))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

export const getInventoryOverview = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const boxes = await ctx.db.query("boxes").withIndex("by_org", q => q.eq("organizationId", auth.organizationId))
      .filter(q => q.eq(q.field("deletedAt"), undefined)).collect();
    const summaries = await Promise.all(boxes.map(async box => {
      const items = await ctx.db.query("boxItems").withIndex("by_box", q => q.eq("boxId", box._id))
        .filter(q => q.eq(q.field("status"), "in_stock"))
        .filter(q => q.eq(q.field("deletedAt"), undefined)).collect();
      return { box, items, weightMg: items.reduce((sum, item) => sum + item.netWeightMg, 0), quantity: items.length };
    }));
    return { boxes: summaries, totalBoxes: boxes.length,
      totalWeightMg: summaries.reduce((sum, row) => sum + row.weightMg, 0),
      totalQuantity: summaries.reduce((sum, row) => sum + row.quantity, 0) };
  },
});

/** Manually chosen number, with an automatic fallback for existing callers. */
export const createNext = mutation({
  args: { label: v.optional(v.string()), boxNumber: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);

    const highest = await ctx.db
      .query("boxes")
      .withIndex("by_org_and_number", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

    const boxNumber = args.boxNumber ?? (highest?.boxNumber ?? 100) + 1;
    if (!Number.isSafeInteger(boxNumber) || boxNumber < 1) throw new Error("Enter a positive whole box number");
    const duplicate = await ctx.db.query("boxes").withIndex("by_org_and_number", q => q.eq("organizationId", auth.organizationId).eq("boxNumber", boxNumber))
      .first();
    if (duplicate) throw new Error("That box number is already in use. Please choose a different number.");
    return await ctx.db.insert("boxes", {
      organizationId: auth.organizationId,
      boxNumber,
      label: args.label?.trim() || undefined,
      itemCount: 0,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

/** Moves one physical item to a different box — never two boxes at once, since this patches the single boxItem.boxId that is the source of truth for its location. */
export const transferItem = mutation({
  args: { boxItemId: v.id("boxItems"), toBoxId: v.id("boxes") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);

    const boxItem = await ctx.db.get(args.boxItemId);
    if (!boxItem || boxItem.deletedAt || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (boxItem.status !== "in_stock") throw new Error("Only in-stock items can be transferred");

    const toBox = await ctx.db.get(args.toBoxId);
    if (!toBox || toBox.deletedAt || toBox.organizationId !== auth.organizationId) throw new Error("Destination box not found");
    if (toBox._id === boxItem.boxId) throw new Error("Item is already in this box");

    const fromBox = await ctx.db.get(boxItem.boxId);

    await ctx.db.patch(args.boxItemId, { boxId: args.toBoxId });
    if (fromBox) await ctx.db.patch(fromBox._id, { itemCount: Math.max(0, (fromBox.itemCount ?? 0) - 1) });
    await ctx.db.patch(args.toBoxId, { itemCount: (toBox.itemCount ?? 0) + 1 });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "box.transfer",
      entityTable: "boxItems",
      entityId: args.boxItemId,
      metadata: { fromBoxNumber: fromBox?.boxNumber, toBoxNumber: toBox.boxNumber, label: boxItem.label },
      createdAt: Date.now(),
    });
  },
});

/** One-off data repair: recomputes itemCount for boxes created before the field existed. Not exposed in the UI. */
export const recomputeItemCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const boxes = await ctx.db.query("boxes").filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    for (const box of boxes) {
      const items = await ctx.db
        .query("boxItems")
        .withIndex("by_box", (q) => q.eq("boxId", box._id))
        .filter((q) => q.eq(q.field("status"), "in_stock"))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
      if (box.itemCount !== items.length) {
        await ctx.db.patch(box._id, { itemCount: items.length });
      }
    }
  },
});
