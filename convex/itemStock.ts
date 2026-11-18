import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
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
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const company = await ctx.db.get(auth.organizationId);
    if (!isGstCompanyType(company?.companyType)) throw new Error("Only GST companies have loose item stock to put into boxes.");
    const product = await ctx.db.get(args.productId);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Item not found");
    const box = await ctx.db.get(args.boxId);
    if (!box || box.deletedAt || box.organizationId !== auth.organizationId) throw new Error("Box not found");
    if (!box.isActive) throw new Error(`Box ${box.boxNumber} is inactive. Mark it active first.`);
    if (!Number.isSafeInteger(args.grossWeightMg) || args.grossWeightMg <= 0) throw new Error("Enter the gross weight of the piece");
    if (!Number.isSafeInteger(args.stoneWeightMg) || args.stoneWeightMg < 0 || args.stoneWeightMg > args.grossWeightMg) throw new Error("Stone weight must be between 0 and the gross weight");
    const label = args.label.trim().slice(0, 80) || product.name;
    const now = Date.now();
    // Throws if there isn't that much loose stock — the move can't create stock.
    await changeItemStock(ctx, { organizationId: auth.organizationId, productId: product._id, weightDeltaMg: -args.grossWeightMg, piecesDelta: -1, sourceTable: "item_stock_to_box", sourceId: box._id, at: now });
    const boxItemId = await ctx.db.insert("boxItems", {
      organizationId: auth.organizationId,
      boxId: box._id,
      productId: product._id,
      label,
      grossWeightMg: args.grossWeightMg,
      stoneWeightMg: args.stoneWeightMg,
      netWeightMg: args.grossWeightMg - args.stoneWeightMg,
      status: "in_stock",
      createdAt: now,
    });
    await ctx.db.patch(box._id, { itemCount: (box.itemCount ?? 0) + 1 });
    await ctx.db.insert("stockMovements", {
      organizationId: auth.organizationId,
      productId: product._id,
      boxItemId,
      boxId: box._id,
      direction: "in",
      netWeightMg: args.grossWeightMg - args.stoneWeightMg,
      quantity: 1,
      sourceTable: "item_stock_to_box",
      sourceId: box._id,
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "item_stock.move_to_box",
      entityTable: "boxItems",
      entityId: boxItemId,
      metadata: { productId: product._id, boxNumber: box.boxNumber, grossWeightMg: args.grossWeightMg, stoneWeightMg: args.stoneWeightMg },
      createdAt: now,
    });
    return boxItemId;
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
        const [boxes, items] = await Promise.all([
          ctx.db.query("boxes").withIndex("by_org", (q) => q.eq("organizationId", org._id)).collect(),
          ctx.db.query("boxItems").withIndex("by_org", (q) => q.eq("organizationId", org._id)).collect(),
        ]);
        const totals = new Map<Id<"boxes">, { pieces: number; netWeightMg: number }>();
        for (const item of items as Doc<"boxItems">[]) {
          if (item.deletedAt || item.status !== "in_stock") continue;
          const t = totals.get(item.boxId) ?? { pieces: 0, netWeightMg: 0 };
          t.pieces += 1;
          t.netWeightMg += item.netWeightMg;
          totals.set(item.boxId, t);
        }
        daily.push({
          organizationId: org._id,
          name: org.name,
          boxes: boxes
            .filter((b) => !b.deletedAt)
            .map((b) => ({ boxId: b._id, boxNumber: b.boxNumber, label: b.label, ...(totals.get(b._id) ?? { pieces: 0, netWeightMg: 0 }) }))
            .sort((a, b) => a.boxNumber - b.boxNumber),
        });
      }
    }
    return { activeOrganizationId: auth.organizationId, daily, gst };
  },
});
