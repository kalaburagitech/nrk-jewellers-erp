import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { changeItemStock, gstStockByProduct, isGstCompanyType } from "./lib/itemStock";

/**
 * GST stock of the active company per item: total (loose item stock + pieces
 * in boxes), with the loose part shown separately.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const [products, stock] = await Promise.all([
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
      gstStockByProduct(ctx, auth.organizationId),
    ]);
    return products
      .filter((p) => !p.deletedAt && p.isActive && p.itemType !== "service")
      .map((p) => {
        const s = stock.get(p._id);
        return {
          productId: p._id,
          name: p.name,
          weightMg: s?.weightMg ?? 0,
          pieces: s?.pieces ?? 0,
          looseWeightMg: s?.looseWeightMg ?? 0,
          loosePieces: s?.loosePieces ?? 0,
          boxPieces: s?.boxPieces ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Add or remove GST item stock by hand (opening stock, corrections, damage). */
export const adjust = mutation({
  args: {
    productId: v.id("products"),
    direction: v.union(v.literal("in"), v.literal("out")),
    weightMg: v.number(),
    pieces: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const company = await ctx.db.get(auth.organizationId);
    if (!isGstCompanyType(company?.companyType)) throw new Error("Item stock is for GST companies. Daily Sales stock is kept in boxes.");
    if (!Number.isSafeInteger(args.weightMg) || args.weightMg < 0 || !Number.isSafeInteger(args.pieces) || args.pieces < 0) throw new Error("Enter a valid weight and pieces");
    if (args.weightMg === 0 && args.pieces === 0) throw new Error("Enter the weight or pieces to change");
    const sign = args.direction === "in" ? 1 : -1;
    const now = Date.now();
    const logId = await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "item_stock.adjust",
      entityTable: "products",
      entityId: args.productId,
      metadata: { direction: args.direction, weightMg: args.weightMg, pieces: args.pieces, reason: args.reason.trim() || "Manual adjustment" },
      createdAt: now,
    });
    await changeItemStock(ctx, { organizationId: auth.organizationId, productId: args.productId, weightDeltaMg: sign * args.weightMg, piecesDelta: sign * args.pieces, sourceTable: "item_stock_adjustments", sourceId: logId, at: now });
  },
});
