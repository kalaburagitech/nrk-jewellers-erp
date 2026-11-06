import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const getForSale = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("ewayBills")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .first();
  },
});

/** Everything the printable e-way bill (Part A) document needs, joined in one query. */
export const getDocumentData = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");

    const [saleItems, customer, organization, ewayBill] = await Promise.all([
      ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
        .collect(),
      ctx.db.get(sale.customerId),
      ctx.db.get(auth.organizationId),
      ctx.db
        .query("ewayBills")
        .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
        .first(),
    ]);

    const products = await Promise.all(saleItems.map((item) => ctx.db.get(item.productId)));

    // One row per distinct HSN code, as the e-way bill format expects — not one row per physical item.
    const hsnSummary = new Map<string, { taxableValuePaise: number; taxPaise: number }>();
    saleItems.forEach((item, i) => {
      const hsn = products[i]?.hsnCode || "7113";
      const existing = hsnSummary.get(hsn) ?? { taxableValuePaise: 0, taxPaise: 0 };
      existing.taxableValuePaise += item.lineTotalPaise - item.lineTaxPaise;
      existing.taxPaise += item.lineTaxPaise;
      hsnSummary.set(hsn, existing);
    });

    return {
      sale,
      customer,
      organization,
      ewayBill,
      hsnSummary: [...hsnSummary.entries()].map(([hsnCode, v]) => ({ hsnCode, ...v })),
    };
  },
});

export const upsert = mutation({
  args: {
    saleId: v.id("sales"),
    transportMode: v.union(v.literal("road"), v.literal("rail"), v.literal("air"), v.literal("ship")),
    vehicleNumber: v.optional(v.string()),
    transporterName: v.optional(v.string()),
    transporterGstin: v.optional(v.string()),
    approxDistanceKm: v.optional(v.number()),
    ewayBillNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");

    const existing = await ctx.db
      .query("ewayBills")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .first();

    const fields = {
      transportMode: args.transportMode,
      vehicleNumber: args.vehicleNumber?.trim() || undefined,
      transporterName: args.transporterName?.trim() || undefined,
      transporterGstin: args.transporterGstin?.trim() || undefined,
      approxDistanceKm: args.approxDistanceKm,
      ewayBillNumber: args.ewayBillNumber?.trim() || undefined,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("ewayBills", {
      organizationId: auth.organizationId,
      saleId: args.saleId,
      createdByUserId: auth.userId,
      createdAt: Date.now(),
      ...fields,
    });
  },
});
