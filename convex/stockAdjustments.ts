import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { changeBoxStock, ensureBoxEntry, entryForRemoval, findBoxEntry, getCompanyBox } from "./lib/boxStock";

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) =>
        q.or(
          q.eq(q.field("action"), "stock.correct_weight"),
          q.eq(q.field("action"), "stock.write_off"),
          q.eq(q.field("action"), "stock.adjust_box"),
          // GST companies adjust item stock instead of boxes.
          q.eq(q.field("action"), "item_stock.adjust"),
        ),
      )
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(100);
  },
});

/** Audited box correction: add and/or deduct weight and pieces. Every change lands in the stock journal with its reason. */
export const adjustBox = mutation({
  args: {
    boxId: v.id("boxes"), addWeightMg: v.number(), deductWeightMg: v.number(), addPieces: v.number(), deductPieces: v.number(), reason: v.string(),
    // Net weight change of the item (optional; else it follows the gross weight).
    netDeltaMg: v.optional(v.number()),
    // Optional: the item the corrected stock belongs to, so item-wise (GST) stock counts it.
    productId: v.optional(v.id("products")),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required for every stock adjustment");
    if (reason.length > 200) throw new Error("Reason must be 200 characters or fewer");
    for (const value of [args.addWeightMg, args.deductWeightMg, args.addPieces, args.deductPieces]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Enter non-negative whole values (weight in milligrams)");
    }
    const weightDeltaMg = args.addWeightMg - args.deductWeightMg;
    const piecesDelta = args.addPieces - args.deductPieces;
    if (!weightDeltaMg && !piecesDelta) throw new Error("Enter an adjustment first");
    const box = await getCompanyBox(ctx, auth.organizationId, args.boxId, true);
    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Item not found");
    }
    const now = Date.now();
    // With an item: the change is to that item's row in the box (created when stock is added for a new item).
    let boxEntryId = undefined;
    if (args.productId) {
      const existing = await findBoxEntry(ctx, box._id, args.productId);
      if (weightDeltaMg > 0 || piecesDelta > 0) boxEntryId = (existing ?? (await ensureBoxEntry(ctx, { organizationId: auth.organizationId, boxId: box._id, productId: args.productId })))._id;
      else boxEntryId = (await entryForRemoval(ctx, box, existing, -weightDeltaMg, -piecesDelta))?._id;
    }
    await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: box._id, boxEntryId, weightDeltaMg, netDeltaMg: boxEntryId ? args.netDeltaMg : undefined, piecesDelta, productId: args.productId, sourceTable: "stock_adjustments", sourceId: box._id, at: now, note: reason });
    await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: "stock.adjust_box", entityTable: "boxes", entityId: box._id, metadata: { boxNumber: box.boxNumber, addWeightMg: args.addWeightMg, deductWeightMg: args.deductWeightMg, addPieces: args.addPieces, deductPieces: args.deductPieces, reason }, createdAt: now });
  },
});
