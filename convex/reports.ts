import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";

/**
 * GST sales register: one row per GST-finalized sale in range, with the
 * CGST/SGST/IGST split derived by prorating each line's tax across its
 * own tax configuration (lines in one sale can in principle use different
 * rates, though in practice a shop usually bills one rate per sale).
 */
export const getGstSalesRegister = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sales = (
      await ctx.db
        .query("sales")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .order("desc")
        .take(2000)
    ).filter(
      (s) => s.isGst && s.status === "finalized" && s.createdAt >= args.startDate && s.createdAt <= args.endDate,
    );

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .collect();
    const customerNameById = new Map(customers.map((c) => [c._id, c.name]));

    const taxConfigCache = new Map<string, { cgstBasisPoints: number; sgstBasisPoints: number; igstBasisPoints: number }>();

    const rows = [];
    for (const sale of sales) {
      const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
        .collect();

      let cgstPaise = 0;
      let sgstPaise = 0;
      let igstPaise = 0;

      for (const item of items) {
        if (!item.taxConfigurationId || item.lineTaxPaise === 0) continue;
        const key = item.taxConfigurationId;
        if (!taxConfigCache.has(key)) {
          const config = await ctx.db.get(item.taxConfigurationId);
          if (config) {
            taxConfigCache.set(key, {
              cgstBasisPoints: config.cgstBasisPoints,
              sgstBasisPoints: config.sgstBasisPoints,
              igstBasisPoints: config.igstBasisPoints,
            });
          }
        }
        const rates = taxConfigCache.get(key);
        if (!rates) continue;
        const totalBp = rates.cgstBasisPoints + rates.sgstBasisPoints + rates.igstBasisPoints;
        if (totalBp === 0) continue;
        cgstPaise += Math.round((item.lineTaxPaise * rates.cgstBasisPoints) / totalBp);
        sgstPaise += Math.round((item.lineTaxPaise * rates.sgstBasisPoints) / totalBp);
        igstPaise += Math.round((item.lineTaxPaise * rates.igstBasisPoints) / totalBp);
      }

      rows.push({
        saleId: sale._id,
        invoiceNumber: sale.invoiceNumber,
        createdAt: sale.createdAt,
        customerName: customerNameById.get(sale.customerId) ?? "—",
        taxableValuePaise: sale.subtotalPaise - sale.discountPaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalTaxPaise: sale.taxPaise,
        totalPaise: sale.totalPaise,
      });
    }

    return rows;
  },
});

/** GST purchase register: flat tax amount per purchase — purchases don't track a CGST/SGST/IGST split (documented simplification, see docs/BILLING_RULES.md). */
export const getGstPurchaseRegister = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchases = (
      await ctx.db
        .query("purchases")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .order("desc")
        .take(2000)
    ).filter(
      (p) => p.taxPaise > 0 && p.status === "finalized" && p.createdAt >= args.startDate && p.createdAt <= args.endDate,
    );

    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .collect();
    const supplierNameById = new Map(suppliers.map((s) => [s._id, s.name]));

    return purchases.map((p) => ({
      purchaseId: p._id,
      invoiceNumber: p.invoiceNumber,
      createdAt: p.createdAt,
      supplierName: supplierNameById.get(p.supplierId) ?? "—",
      subtotalPaise: p.subtotalPaise,
      taxPaise: p.taxPaise,
      totalPaise: p.totalPaise,
    }));
  },
});

/** Sales report: totals + daily breakdown + payment-mode breakdown for a date range. */
export const getSalesReport = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sales = (
      await ctx.db
        .query("sales")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .order("desc")
        .take(2000)
    ).filter((s) => s.status === "finalized" && s.createdAt >= args.startDate && s.createdAt <= args.endDate);

    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .order("desc")
        .take(5000)
    ).filter(
      (p) =>
        // Old gold exchange credits are stored with sourceTable
        // "old_gold_exchanges" (linking to their own audit record) rather
        // than "sales" — include them here too, or this breakdown would
        // under-count and silently disagree with Total Sales.
        (p.sourceTable === "sales" || p.sourceTable === "old_gold_exchanges") &&
        p.direction === "receipt" &&
        p.createdAt >= args.startDate &&
        p.createdAt <= args.endDate,
    );

    const byPaymentMode = new Map<string, number>();
    for (const p of payments) {
      byPaymentMode.set(p.mode, (byPaymentMode.get(p.mode) ?? 0) + p.amountPaise);
    }

    const byDay = new Map<string, { totalPaise: number; count: number }>();
    for (const s of sales) {
      const dayKey = new Date(s.createdAt).toISOString().slice(0, 10);
      const existing = byDay.get(dayKey) ?? { totalPaise: 0, count: 0 };
      existing.totalPaise += s.totalPaise;
      existing.count += 1;
      byDay.set(dayKey, existing);
    }

    return {
      totalSalesPaise: sales.reduce((sum, s) => sum + s.totalPaise, 0),
      totalInvoiceCount: sales.length,
      byPaymentMode: Array.from(byPaymentMode.entries()).map(([mode, amountPaise]) => ({ mode, amountPaise })),
      byDay: Array.from(byDay.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  },
});

/** Current stock, grouped by metal purity — net weight and piece count. */
export const getStockByPurity = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const [boxItems, products, purities] = await Promise.all([
      ctx.db
        .query("boxItems")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("status"), "in_stock"))
        .collect(),
      ctx.db
        .query("products")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .collect(),
      ctx.db
        .query("metalPurities")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .collect(),
    ]);

    const productById = new Map(products.map((p) => [p._id, p]));
    const byPurity = new Map<string, { netWeightMg: number; pieceCount: number }>();
    let unassigned = { netWeightMg: 0, pieceCount: 0 };

    for (const item of boxItems) {
      const purityId = productById.get(item.productId)?.metalPurityId;
      if (!purityId) {
        unassigned = { netWeightMg: unassigned.netWeightMg + item.netWeightMg, pieceCount: unassigned.pieceCount + 1 };
        continue;
      }
      const existing = byPurity.get(purityId) ?? { netWeightMg: 0, pieceCount: 0 };
      existing.netWeightMg += item.netWeightMg;
      existing.pieceCount += 1;
      byPurity.set(purityId, existing);
    }

    const rows = purities
      .map((p) => ({ purity: p, ...(byPurity.get(p._id) ?? { netWeightMg: 0, pieceCount: 0 }) }))
      .filter((r) => r.pieceCount > 0);

    return { rows, unassigned };
  },
});
