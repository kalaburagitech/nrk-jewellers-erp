import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext, requireRole } from "./lib/auth";
import { changeItemStock, isGstCompanyType } from "./lib/itemStock";

/** GST item stock of the active company: every stocked item with its gross, stone, and net weight + pieces balance. */
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
      .map((p) => {
        const row = byProduct.get(p._id);
        const grossWeightMg = row?.grossWeightMg ?? row?.weightMg ?? 0;
        const stoneWeightMg = row?.stoneWeightMg ?? 0;
        const netWeightMg = row?.netWeightMg ?? row?.weightMg ?? 0;
        return {
          productId: p._id,
          name: p.name,
          grossWeightMg,
          stoneWeightMg,
          netWeightMg,
          weightMg: netWeightMg,
          pieces: row?.pieces ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Add or remove GST item stock by hand (opening stock, corrections, damage) maintaining separate gross, stone and net weights. */
export const adjust = mutation({
  args: {
    productId: v.id("products"),
    direction: v.union(v.literal("in"), v.literal("out")),
    grossWeightMg: v.optional(v.number()),
    stoneWeightMg: v.optional(v.number()),
    netWeightMg: v.optional(v.number()),
    weightMg: v.optional(v.number()), // legacy fallback
    pieces: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["inventory_manager"]);
    const company = await ctx.db.get(auth.organizationId);
    if (!isGstCompanyType(company?.companyType)) throw new Error("Item stock is for GST companies. Daily Sales stock is kept in boxes.");

    const grossMg = args.grossWeightMg ?? args.weightMg ?? 0;
    const stoneMg = args.stoneWeightMg ?? 0;
    const netMg = args.netWeightMg ?? (grossMg - stoneMg);

    if (!Number.isSafeInteger(grossMg) || grossMg < 0 || !Number.isSafeInteger(stoneMg) || stoneMg < 0 || !Number.isSafeInteger(netMg) || netMg < 0 || !Number.isSafeInteger(args.pieces) || args.pieces < 0) {
      throw new Error("Enter valid non-negative weights and pieces");
    }
    if (stoneMg > grossMg) {
      throw new Error("Stone weight cannot exceed gross weight");
    }
    if (grossMg === 0 && stoneMg === 0 && netMg === 0 && args.pieces === 0) {
      throw new Error("Enter the weight or pieces to change");
    }

    const sign = args.direction === "in" ? 1 : -1;
    const now = Date.now();
    const logId = await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "item_stock.adjust",
      entityTable: "products",
      entityId: args.productId,
      metadata: { direction: args.direction, grossWeightMg: grossMg, stoneWeightMg: stoneMg, netWeightMg: netMg, pieces: args.pieces, reason: args.reason.trim() || "Manual adjustment" },
      createdAt: now,
    });

    await changeItemStock(ctx, {
      organizationId: auth.organizationId,
      productId: args.productId,
      grossWeightDeltaMg: sign * grossMg,
      stoneWeightDeltaMg: sign * stoneMg,
      netWeightDeltaMg: sign * netMg,
      piecesDelta: sign * args.pieces,
      sourceTable: "item_stock_adjustments",
      sourceId: logId,
      at: now,
    });
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
    const daily: Array<{ organizationId: Id<"organizations">; name: string; boxes: Array<{ boxId: Id<"boxes">; boxNumber: number; label?: string; pieces: number; grossWeightMg: number; stoneWeightMg: number; netWeightMg: number }> }> = [];
    const gst: Array<{ organizationId: Id<"organizations">; name: string; companyType: string; items: Array<{ productId: Id<"products">; name: string; grossWeightMg: number; stoneWeightMg: number; netWeightMg: number; weightMg: number; pieces: number }> }> = [];
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
            .filter((row) => names.has(row.productId) && ((row.grossWeightMg ?? row.weightMg) > 0 || (row.netWeightMg ?? row.weightMg) > 0 || row.pieces > 0))
            .map((row) => ({
              productId: row.productId,
              name: names.get(row.productId)!,
              grossWeightMg: row.grossWeightMg ?? row.weightMg,
              stoneWeightMg: row.stoneWeightMg ?? 0,
              netWeightMg: row.netWeightMg ?? row.weightMg,
              weightMg: row.netWeightMg ?? row.weightMg,
              pieces: row.pieces,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      } else {
        const [boxes, items] = await Promise.all([
          ctx.db.query("boxes").withIndex("by_org", (q) => q.eq("organizationId", org._id)).collect(),
          ctx.db.query("boxItems").withIndex("by_org", (q) => q.eq("organizationId", org._id)).collect(),
        ]);
        const totals = new Map<Id<"boxes">, { pieces: number; grossWeightMg: number; stoneWeightMg: number; netWeightMg: number }>();
        for (const item of items as Doc<"boxItems">[]) {
          if (item.deletedAt || item.status !== "in_stock") continue;
          const t = totals.get(item.boxId) ?? { pieces: 0, grossWeightMg: 0, stoneWeightMg: 0, netWeightMg: 0 };
          t.pieces += 1;
          t.grossWeightMg += item.grossWeightMg;
          t.stoneWeightMg += item.stoneWeightMg;
          t.netWeightMg += item.netWeightMg;
          totals.set(item.boxId, t);
        }
        daily.push({
          organizationId: org._id,
          name: org.name,
          boxes: boxes
            .filter((b) => !b.deletedAt && b.isActive)
            .map((b) => {
              const t = totals.get(b._id) ?? { pieces: 0, grossWeightMg: 0, stoneWeightMg: 0, netWeightMg: 0 };
              return { boxId: b._id, boxNumber: b.boxNumber, label: b.label, ...t };
            })
            .sort((a, b) => a.boxNumber - b.boxNumber),
        });
      }
    }
    return { activeOrganizationId: auth.organizationId, daily, gst };
  },
});
