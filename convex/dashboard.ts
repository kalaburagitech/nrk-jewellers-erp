import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";

/**
 * One aggregated query for the whole dashboard — avoids a separate useQuery
 * per card. "Today" is a UTC calendar day (documented assumption; revisit if
 * the shop needs a specific local timezone boundary).
 */
export const getSummary = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const orgId = auth.organizationId;

    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    const todayStart = startOfTodayUtc.getTime();

    const [
      recentSales,
      recentPurchases,
      customers,
      suppliers,
      boxItems,
      products,
      purities,
      payments,
    ] = await Promise.all([
      ctx.db
        .query("sales")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .order("desc")
        .take(500),
      ctx.db
        .query("purchases")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .order("desc")
        .take(500),
      ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .collect(),
      ctx.db
        .query("suppliers")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .collect(),
      ctx.db
        .query("boxItems")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("status"), "in_stock"))
        .collect(),
      ctx.db
        .query("products")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .collect(),
      ctx.db
        .query("metalPurities")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .order("desc")
        .take(1000),
    ]);

    const todaysSalesPaise = recentSales
      .filter((s) => s.createdAt >= todayStart && s.status === "finalized")
      .reduce((sum, s) => sum + s.totalPaise, 0);
    const todaysPurchasesPaise = recentPurchases
      .filter((p) => p.createdAt >= todayStart && p.status === "finalized")
      .reduce((sum, p) => sum + p.totalPaise, 0);

    // Net cash position derived from recorded payments — not a full
    // accounting ledger (that's Stage 2 Accounting Engine, out of Phase 1
    // scope). Old gold exchange is a trade-in, not cash, so it's excluded.
    const netCashPaise = payments.reduce((sum, p) => {
      if (p.mode === "old_gold_exchange") return sum;
      const signed = p.direction === "receipt" ? p.amountPaise : -p.amountPaise;
      return sum + signed;
    }, 0);

    // Last 7 calendar days (oldest first) — drives the dashboard sparklines
    // and the Sales Overview chart. "Today vs yesterday" % deltas read off
    // the last two entries of this same array, so there's one source of truth.
    const dayMs = 24 * 60 * 60 * 1000;
    const trend = Array.from({ length: 7 }, (_, i) => {
      const dayStart = todayStart - (6 - i) * dayMs;
      const dayEnd = dayStart + dayMs;
      const salesPaise = recentSales
        .filter((s) => s.createdAt >= dayStart && s.createdAt < dayEnd && s.status === "finalized")
        .reduce((sum, s) => sum + s.totalPaise, 0);
      const purchasesPaise = recentPurchases
        .filter((p) => p.createdAt >= dayStart && p.createdAt < dayEnd && p.status === "finalized")
        .reduce((sum, p) => sum + p.totalPaise, 0);
      const cashPaise = payments
        .filter((p) => p.createdAt >= dayStart && p.createdAt < dayEnd && p.mode !== "old_gold_exchange")
        .reduce((sum, p) => sum + (p.direction === "receipt" ? p.amountPaise : -p.amountPaise), 0);
      return { date: dayStart, salesPaise, purchasesPaise, cashPaise };
    });

    function deltaPercent(today: number, yesterday: number): number | null {
      if (yesterday === 0) return today === 0 ? 0 : null;
      return Math.round(((today - yesterday) / Math.abs(yesterday)) * 100);
    }
    const yesterday = trend[trend.length - 2];
    const salesDeltaPercent = deltaPercent(todaysSalesPaise, yesterday.salesPaise);
    const purchasesDeltaPercent = deltaPercent(todaysPurchasesPaise, yesterday.purchasesPaise);
    const netCashDeltaPercent = deltaPercent(netCashPaise, yesterday.cashPaise);

    const totalReceivablesPaise = customers.reduce((sum, c) => {
      const balance = c.currentBalancePaise ?? c.openingBalancePaise;
      return sum + Math.max(0, balance);
    }, 0);
    const totalPayablesPaise = suppliers.reduce((sum, s) => {
      const balance = s.currentBalancePaise ?? s.openingBalancePaise;
      return sum + Math.max(0, balance);
    }, 0);

    const purityById = new Map(purities.map((p) => [p._id, p]));
    const productById = new Map(products.map((p) => [p._id, p]));

    let goldStockMg = 0;
    let silverStockMg = 0;
    const stockMgByProduct = new Map<string, number>();
    const stockMgByPurity = new Map<string, number>();
    for (const item of boxItems) {
      stockMgByProduct.set(item.productId, (stockMgByProduct.get(item.productId) ?? 0) + item.netWeightMg);
      const product = productById.get(item.productId);
      const purity = product?.metalPurityId ? purityById.get(product.metalPurityId) : undefined;
      if (purity?.metal === "gold") goldStockMg += item.netWeightMg;
      else if (purity?.metal === "silver") silverStockMg += item.netWeightMg;
      if (product?.metalPurityId) {
        stockMgByPurity.set(product.metalPurityId, (stockMgByPurity.get(product.metalPurityId) ?? 0) + item.netWeightMg);
      }
    }
    const stockByPurity = purities
      .filter((p) => p.isActive)
      .map((p) => ({ purityId: p._id, label: p.label, metal: p.metal, netWeightMg: stockMgByPurity.get(p._id) ?? 0 }));

    // Today's receipts by payment mode — old gold/silver exchange is a trade-in, kept separate from cash/digital modes.
    const todaysPaymentsByMode: Record<string, number> = {};
    let todaysOldGoldExchangePaise = 0;
    for (const p of payments) {
      if (p.createdAt < todayStart || p.direction !== "receipt") continue;
      if (p.mode === "old_gold_exchange") {
        todaysOldGoldExchangePaise += p.amountPaise;
        continue;
      }
      todaysPaymentsByMode[p.mode] = (todaysPaymentsByMode[p.mode] ?? 0) + p.amountPaise;
    }

    const lowStockCount = products.filter((p) => {
      if (!p.reorderLevelMg || !p.isActive) return false;
      return (stockMgByProduct.get(p._id) ?? 0) < p.reorderLevelMg;
    }).length;

    const customerNameById = new Map(customers.map((c) => [c._id, c.name]));
    const recentInvoices = recentSales
      .filter((s) => s.status === "finalized")
      .slice(0, 5)
      .map((s) => ({
        _id: s._id,
        invoiceNumber: s.invoiceNumber,
        customerName: customerNameById.get(s.customerId) ?? "—",
        totalPaise: s.totalPaise,
        createdAt: s.createdAt,
      }));

    return {
      todaysSalesPaise,
      todaysPurchasesPaise,
      netCashPaise,
      totalReceivablesPaise,
      totalPayablesPaise,
      goldStockMg,
      silverStockMg,
      stockByPurity,
      totalOrnamentCount: boxItems.length,
      lowStockCount,
      recentInvoices,
      todaysPaymentsByMode,
      todaysOldGoldExchangePaise,
      trend,
      salesDeltaPercent,
      purchasesDeltaPercent,
      netCashDeltaPercent,
    };
  },
});
