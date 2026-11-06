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
    if (!boxItem || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
    if (boxItem.status !== "in_stock") throw new Error("Only in-stock items can be transferred");

    const toBox = await ctx.db.get(args.toBoxId);
    if (!toBox || toBox.organizationId !== auth.organizationId) throw new Error("Destination box not found");
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
    const boxes = await ctx.db.query("boxes").collect();
    for (const box of boxes) {
      const items = await ctx.db
        .query("boxItems")
        .withIndex("by_box", (q) => q.eq("boxId", box._id))
        .filter((q) => q.eq(q.field("status"), "in_stock"))
        .collect();
      if (box.itemCount !== items.length) {
        await ctx.db.patch(box._id, { itemCount: items.length });
      }
    }
  },
});
