import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthContext } from "./lib/auth";

/**
 * One aggregated query for the whole dashboard — avoids a separate useQuery
 * per card. "Today" follows the shop's Asia/Kolkata calendar day.
 */
export const getSummary = query({
  args: {
    timeframe: v.optional(
      v.union(
        v.literal("week"),
        v.literal("month"),
        v.literal("quarter"),
        v.literal("half_year"),
        v.literal("year"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const orgId = auth.organizationId;
    const timeframe = args.timeframe ?? "week";

    const todayStart = Math.floor((Date.now() + 19_800_000) / 86_400_000) * 86_400_000 - 19_800_000;
    const dayMs = 24 * 60 * 60 * 1000;

    let daysCount = 7;
    let timeframeLabel = "last 7 days";
    if (timeframe === "week") {
      daysCount = 7;
      timeframeLabel = "last 7 days";
    } else if (timeframe === "month") {
      daysCount = 30;
      timeframeLabel = "this month";
    } else if (timeframe === "quarter") {
      daysCount = 90;
      timeframeLabel = "this quarter";
    } else if (timeframe === "half_year") {
      daysCount = 180;
      timeframeLabel = "this half-year";
    } else if (timeframe === "year") {
      daysCount = 365;
      timeframeLabel = "this year";
    }

    const windowStart = todayStart - (daysCount - 1) * dayMs;
    const windowEnd = todayStart + dayMs;

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
        .withIndex("by_org_and_time", (q) => q.eq("organizationId", orgId).gte("createdAt", windowStart).lt("createdAt", windowEnd))
        .order("desc")
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("purchases")
        .withIndex("by_org_and_time", (q) => q.eq("organizationId", orgId).gte("createdAt", windowStart).lt("createdAt", windowEnd))
        .order("desc")
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("suppliers")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("boxItems")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("status"), "in_stock"))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("products")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("metalPurities")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_org_and_time", (q) => q.eq("organizationId", orgId).gte("createdAt", windowStart).lt("createdAt", windowEnd))
        .order("desc")
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
    ]);

    const todaysSalesPaise = recentSales
      .filter((s) => s.createdAt >= todayStart && s.status === "finalized" && s.documentType === "sales_invoice")
      .reduce((sum, s) => sum + s.totalPaise, 0);
    const todaysPurchasesPaise = recentPurchases
      .filter((p) => p.createdAt >= todayStart && p.status === "finalized" && (!p.documentType || p.documentType === "purchase_invoice"))
      .reduce((sum, p) => sum + p.totalPaise, 0);

    const timeframeSalesPaise = recentSales
      .filter((s) => s.createdAt >= windowStart && s.status === "finalized" && s.documentType === "sales_invoice")
      .reduce((sum, s) => sum + s.totalPaise, 0);

    // Net cash position derived from recorded payments — not a full
    // accounting ledger (that's Stage 2 Accounting Engine, out of Phase 1
    // scope). Old gold exchange is a trade-in, not cash, so it's excluded.
    const netCashPaise = payments.reduce((sum, p) => {
      if (p.mode === "old_gold_exchange") return sum;
      const signed = p.direction === "receipt" ? p.amountPaise : -p.amountPaise;
      return sum + signed;
    }, 0);

    // Calendar days or intervals (oldest first) — drives the dashboard sparklines
    // and the Sales Overview chart.
    const pointCount = timeframe === "week" ? 7 : timeframe === "month" ? 15 : 12;
    const intervalMs = pointCount > 1 ? Math.floor(((daysCount - 1) * dayMs) / (pointCount - 1)) : dayMs;

    const trend = Array.from({ length: pointCount }, (_, i) => {
      const bucketStart = windowStart + i * intervalMs;
      const bucketEnd = i === pointCount - 1 ? windowEnd : bucketStart + intervalMs;
      const salesPaise = recentSales
        .filter((s) => s.createdAt >= bucketStart && s.createdAt < bucketEnd && s.status === "finalized" && s.documentType === "sales_invoice")
        .reduce((sum, s) => sum + s.totalPaise, 0);
      const purchasesPaise = recentPurchases
        .filter((p) => p.createdAt >= bucketStart && p.createdAt < bucketEnd && p.status === "finalized" && (!p.documentType || p.documentType === "purchase_invoice"))
        .reduce((sum, p) => sum + p.totalPaise, 0);
      const cashPaise = payments
        .filter((p) => p.createdAt >= bucketStart && p.createdAt < bucketEnd && p.mode !== "old_gold_exchange")
        .reduce((sum, p) => sum + (p.direction === "receipt" ? p.amountPaise : -p.amountPaise), 0);
      return { date: bucketStart, salesPaise, purchasesPaise, cashPaise };
    });

    function deltaPercent(today: number, yesterday: number): number | null {
      if (yesterday === 0) return today === 0 ? 0 : null;
      return Math.round(((today - yesterday) / Math.abs(yesterday)) * 100);
    }
    const yesterday = trend.length >= 2 ? trend[trend.length - 2] : trend[0];
    const salesDeltaPercent = yesterday ? deltaPercent(todaysSalesPaise, yesterday.salesPaise) : 0;
    const purchasesDeltaPercent = yesterday ? deltaPercent(todaysPurchasesPaise, yesterday.purchasesPaise) : 0;
    const netCashDeltaPercent = yesterday ? deltaPercent(netCashPaise, yesterday.cashPaise) : 0;

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
      .filter((s) => s.status === "finalized" && s.documentType === "sales_invoice")
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
      timeframeSalesPaise,
      timeframeLabel,
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
