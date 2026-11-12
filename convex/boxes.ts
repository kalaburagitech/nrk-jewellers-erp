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

/**
 * Adds one physical piece directly into a box from the billing screen, for
 * when an operator finds a box empty (or the item they need missing) mid-sale
 * and shouldn't have to leave billing to go fix inventory first. Same direct
 * boxItems-without-a-purchase-row pattern `stockAdjustments.adjustBox`
 * already uses — not a new precedent, just reachable from a different screen
 * and open to billing_operator (adjustBox is inventory_manager-only).
 */
export const quickAddItem = mutation({
  args: {
    boxId: v.id("boxes"),
    productId: v.optional(v.id("products")),
    newProductName: v.optional(v.string()),
    label: v.string(),
    grossWeightMg: v.number(),
    stoneWeightMg: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator", "inventory_manager"]);

    const label = args.label.trim();
    if (!label) throw new Error("Enter a label for this item");
    if (args.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
    if (args.stoneWeightMg < 0 || args.stoneWeightMg > args.grossWeightMg) {
      throw new Error("Stone weight must be between 0 and gross weight");
    }

    const box = await ctx.db.get(args.boxId);
    if (!box || box.deletedAt || box.organizationId !== auth.organizationId || !box.isActive) {
      throw new Error("Box not found");
    }

    let productId = args.productId;
    if (productId) {
      const product = await ctx.db.get(productId);
      if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Product not found");
    } else {
      const newProductName = args.newProductName?.trim();
      if (!newProductName) throw new Error("Select a product or enter a new product name");
      productId = await ctx.db.insert("products", {
        organizationId: auth.organizationId,
        name: newProductName,
        unit: "gram",
        isActive: true,
        createdAt: Date.now(),
      });
    }

    const netWeightMg = Math.max(0, args.grossWeightMg - args.stoneWeightMg);
    const now = Date.now();
    const boxItemId = await ctx.db.insert("boxItems", {
      organizationId: auth.organizationId,
      boxId: args.boxId,
      productId,
      label,
      grossWeightMg: args.grossWeightMg,
      stoneWeightMg: args.stoneWeightMg,
      netWeightMg,
      status: "in_stock",
      createdAt: now,
    });
    await ctx.db.patch(args.boxId, { itemCount: (box.itemCount ?? 0) + 1 });
    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId,
      boxItemId,
      boxId: args.boxId,
      direction: "in",
      netWeightMg,
      quantity: 1,
      sourceTable: "stock_adjustments",
      sourceId: boxItemId,
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "stock.quick_add_from_billing",
      entityTable: "boxItems",
      entityId: boxItemId,
      metadata: { boxNumber: box.boxNumber, label, grossWeightMg: args.grossWeightMg },
      createdAt: now,
    });

    return await ctx.db.get(boxItemId);
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
    if (!toBox || toBox.deletedAt || toBox.organizationId !== auth.organizationId || !toBox.isActive) throw new Error("Choose an active destination box in this company.");
    if (toBox._id === boxItem.boxId) throw new Error("Item is already in this box");

    const fromBox = await ctx.db.get(boxItem.boxId);
    if (!fromBox || fromBox.deletedAt || fromBox.organizationId !== auth.organizationId || !fromBox.isActive) throw new Error("The item's current box is unavailable. Refresh the box list and try again.");
    const now = Date.now();

    await ctx.db.patch(args.boxItemId, { boxId: args.toBoxId });
    await ctx.db.patch(fromBox._id, { itemCount: Math.max(0, (fromBox.itemCount ?? 0) - 1) });
    await ctx.db.patch(args.toBoxId, { itemCount: (toBox.itemCount ?? 0) + 1 });

    // A transfer is a paired ledger event: the physical item leaves one box
    // and arrives in the other. Both rows commit atomically with its new boxId.
    for (const [boxId, direction] of [[fromBox._id, "out"], [toBox._id, "in"]] as const) {
      await ctx.db.insert("stockMovements", {
        organizationId: auth.organizationId,
        productId: boxItem.productId,
        boxItemId: boxItem._id,
        boxId,
        direction,
        netWeightMg: boxItem.netWeightMg,
        quantity: 1,
        sourceTable: "box_transfers",
        sourceId: `${boxItem._id}:${now}`,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "box.transfer",
      entityTable: "boxItems",
      entityId: args.boxItemId,
      metadata: { fromBoxNumber: fromBox?.boxNumber, toBoxNumber: toBox.boxNumber, label: boxItem.label },
      createdAt: now,
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
