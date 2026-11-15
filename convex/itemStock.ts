import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
import { changeItemStock, isGstCompanyType } from "./lib/itemStock";

/** GST item stock of the active company: every stocked item with its weight + pieces balance. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const [products, stock] = await Promise.all([
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
      ctx.db.query("productStock").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
    ]);
    const byProduct = new Map(stock.map((row) => [row.productId, row]));
    return products
      .filter((p) => !p.deletedAt && p.isActive && p.itemType !== "service")
      .map((p) => ({ productId: p._id, name: p.name, weightMg: byProduct.get(p._id)?.weightMg ?? 0, pieces: byProduct.get(p._id)?.pieces ?? 0 }))
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
          ctx.db.query("productStock").withIndex("by_org", (q) => q.eq("organizationId", org._id)).collect(),
        ]);
        const names = new Map(products.filter((p) => !p.deletedAt).map((p) => [p._id, p.name]));
        gst.push({
          organizationId: org._id,
          name: org.name,
          companyType: org.companyType ?? "gst_gold",
          items: stock
            .filter((row) => names.has(row.productId) && (row.weightMg > 0 || row.pieces > 0))
            .map((row) => ({ productId: row.productId, name: names.get(row.productId)!, weightMg: row.weightMg, pieces: row.pieces }))
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
