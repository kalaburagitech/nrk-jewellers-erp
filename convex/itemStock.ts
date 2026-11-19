import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
import { assertBoxMetal, changeBoxStock, ensureBoxEntry, getCompanyBox, listBoxBalances } from "./lib/boxStock";
import { changeItemStock, gstStockByProduct, isGstCompanyType } from "./lib/itemStock";

/**
 * GST stock of the active company per item: total (loose item stock + pieces
 * in boxes), with the loose part shown separately so it can be put into boxes.
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

/**
 * "Put into box": moves loose GST item stock into a box as one physical piece
 * (label + weights), so it can be billed from the box like Daily Sales. The
 * item's total GST stock doesn't change — it only moves into the box.
 */
export const moveToBox = mutation({
  args: {
    productId: v.id("products"),
    boxId: v.id("boxes"),
    label: v.string(),
    grossWeightMg: v.number(),
    stoneWeightMg: v.number(),
    pieces: v.optional(v.number()), // defaults to 1
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const company = await ctx.db.get(auth.organizationId);
    if (!isGstCompanyType(company?.companyType)) throw new Error("Only GST companies have loose item stock to put into boxes.");
    const product = await ctx.db.get(args.productId);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Item not found");
    const box = await getCompanyBox(ctx, auth.organizationId, args.boxId);
    assertBoxMetal(box, (product.metalPurityId ? await ctx.db.get(product.metalPurityId) : null)?.metal);
    if (!Number.isSafeInteger(args.grossWeightMg) || args.grossWeightMg <= 0) throw new Error("Enter the gross weight to put into the box");
    if (!Number.isSafeInteger(args.stoneWeightMg) || args.stoneWeightMg < 0 || args.stoneWeightMg > args.grossWeightMg) throw new Error("Stone weight must be between 0 and the gross weight");
    const pieces = args.pieces ?? 1;
    if (!Number.isSafeInteger(pieces) || pieces < 0) throw new Error("Pieces must be 0 or more");
    const label = args.label.trim().slice(0, 80) || product.name;
    const now = Date.now();
    // Throws if there isn't that much loose stock — the move can't create stock.
    await changeItemStock(ctx, { organizationId: auth.organizationId, productId: product._id, weightDeltaMg: -args.grossWeightMg, piecesDelta: -pieces, sourceTable: "item_stock_to_box", sourceId: box._id, at: now });
    // Box stock is gross weight + pieces; the stock journal keeps the item and label.
    const entry = await ensureBoxEntry(ctx, { organizationId: auth.organizationId, boxId: box._id, productId: product._id });
    await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: box._id, boxEntryId: entry._id, weightDeltaMg: args.grossWeightMg, netDeltaMg: args.grossWeightMg - args.stoneWeightMg, piecesDelta: pieces, productId: product._id, sourceTable: "item_stock_to_box", sourceId: box._id, at: now, note: label });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "item_stock.move_to_box",
      entityTable: "boxes",
      entityId: box._id,
      metadata: { productId: product._id, boxNumber: box.boxNumber, grossWeightMg: args.grossWeightMg, stoneWeightMg: args.stoneWeightMg, pieces },
      createdAt: now,
    });
    return box._id;
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

/**
 * Stock screen tabs: totals for every company this login belongs to, split
 * into Daily Sales (box stock) and GST (item stock), so the owner sees both
 * without switching companies.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const memberships = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", auth.userId)).collect();
    const daily: Array<{ organizationId: Id<"organizations">; name: string; boxes: Array<{ boxId: Id<"boxes">; boxNumber: number; label?: string; pieces: number; netWeightMg: number }> }> = [];
    const gst: Array<{ organizationId: Id<"organizations">; name: string; companyType: string; items: Array<{ productId: Id<"products">; name: string; weightMg: number; pieces: number }> }> = [];
    for (const membership of memberships) {
      if (membership.status !== "active") continue;
      const org = await ctx.db.get(membership.organizationId);
      if (!org) continue;
      if (isGstCompanyType(org.companyType)) {
        const [products, stock] = await Promise.all([
          ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", org._id)).collect(),
          gstStockByProduct(ctx, org._id),
        ]);
        const names = new Map(products.filter((p) => !p.deletedAt).map((p) => [p._id, p.name]));
        gst.push({
          organizationId: org._id,
          name: org.name,
          companyType: org.companyType ?? "gst_gold",
          items: [...stock.entries()]
            .filter(([productId, row]) => names.has(productId) && (row.weightMg > 0 || row.pieces > 0))
            .map(([productId, row]) => ({ productId, name: names.get(productId)!, weightMg: row.weightMg, pieces: row.pieces }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      } else {
        const boxes = await listBoxBalances(ctx, org._id);
        daily.push({
          organizationId: org._id,
          name: org.name,
          boxes: boxes.map(({ box, weightMg, pieces }) => ({ boxId: box._id, boxNumber: box.boxNumber, label: box.label, metal: box.metal, pieces, netWeightMg: weightMg })),
        });
      }
    }
    return { activeOrganizationId: auth.organizationId, daily, gst };
  },
});
