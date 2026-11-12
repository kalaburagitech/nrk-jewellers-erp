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
        .withIndex("by_org_and_time", (q) =>
          q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate),
        )
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
    ).filter((s) => s.isGst && s.status === "finalized");

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const customerNameById = new Map(customers.map((c) => [c._id, c.name]));

    const taxConfigCache = new Map<string, { cgstBasisPoints: number; sgstBasisPoints: number; igstBasisPoints: number }>();

    const rows = [];
    for (const sale of sales) {
      const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
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
        .withIndex("by_org_and_time", (q) =>
          q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate),
        )
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
    ).filter((p) => p.taxPaise > 0 && p.status === "finalized");

    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
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
        .withIndex("by_org_and_time", (q) =>
          q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate),
        )
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
    ).filter((s) => s.status === "finalized");

    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_org_and_time", (q) =>
          q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate),
        )
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
    ).filter(
      (p) =>
        // Old gold exchange credits are stored with sourceTable
        // "old_gold_exchanges" (linking to their own audit record) rather
        // than "sales" — include them here too, or this breakdown would
        // under-count and silently disagree with Total Sales.
        (p.sourceTable === "sales" || p.sourceTable === "old_gold_exchanges") &&
        p.direction === "receipt",
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
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("products")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect(),
      ctx.db
        .query("metalPurities")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
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

/** Purchase report: supplier-wise totals and purity-wise weight breakdown for a date range. */
export const getPurchaseReport = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchases = (
      await ctx.db
        .query("purchases")
        .withIndex("by_org_and_time", (q) =>
          q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate),
        )
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
    ).filter((p) => p.status === "finalized");

    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const supplierNameById = new Map(suppliers.map((s) => [s._id, s.name]));

    const bySupplier = new Map<string, { name: string; totalPaise: number; count: number }>();
    for (const p of purchases) {
      const key = p.supplierId;
      const existing = bySupplier.get(key) ?? { name: supplierNameById.get(key) ?? "—", totalPaise: 0, count: 0 };
      existing.totalPaise += p.totalPaise;
      existing.count += 1;
      bySupplier.set(key, existing);
    }

    const purities = await ctx.db
      .query("metalPurities")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const purityById = new Map(purities.map((p) => [p._id, p]));

    const byPurity = new Map<string, { label: string; netWeightMg: number }>();
    for (const p of purchases) {
      const items = await ctx.db
        .query("purchaseItems")
        .withIndex("by_purchase", (q) => q.eq("purchaseId", p._id))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
      for (const item of items) {
        const key = item.metalPurityId ?? "unassigned";
        const label = item.metalPurityId ? (purityById.get(item.metalPurityId)?.label ?? "Unknown") : "No purity set";
        const existing = byPurity.get(key) ?? { label, netWeightMg: 0 };
        existing.netWeightMg += item.netWeightMg;
        byPurity.set(key, existing);
      }
    }

    return {
      totalPurchasesPaise: purchases.reduce((sum, p) => sum + p.totalPaise, 0),
      totalInvoiceCount: purchases.length,
      bySupplier: Array.from(bySupplier.values()).sort((a, b) => b.totalPaise - a.totalPaise),
      byPurity: Array.from(byPurity.values()),
    };
  },
});

/** Physical box ledger. Legacy movements without boxId are included in the opening baseline. */
export const getBoxReport = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const boxes = await ctx.db
      .query("boxes")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("asc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    const [products, categories, allItems, allMovements] = await Promise.all([
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("stockCategories").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("boxItems").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("stockMovements").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
    ]);
    const categoryName = new Map(categories.map((category) => [category._id, category.name]));
    const categoryByProduct = new Map(products.map((product) => [product._id, product.stockCategoryId ? categoryName.get(product.stockCategoryId) : undefined]));
    const itemsByBox = new Map<string, typeof allItems>();
    for (const item of allItems) {
      if (item.status !== "in_stock") continue;
      const rows = itemsByBox.get(item.boxId) ?? [];
      rows.push(item);
      itemsByBox.set(item.boxId, rows);
    }
    const movementsByBox = new Map<string, typeof allMovements>();
    for (const movement of allMovements) {
      if (!movement.boxId) continue;
      const rows = movementsByBox.get(movement.boxId) ?? [];
      rows.push(movement);
      movementsByBox.set(movement.boxId, rows);
    }

    return boxes.filter((box) => box.isActive).map((box) => {
      const items = itemsByBox.get(box._id) ?? [];
      const boxMovements = movementsByBox.get(box._id) ?? [];
      const amountFor = (predicate: (movement: typeof boxMovements[number]) => boolean) => boxMovements
        .filter(predicate).reduce((sum, movement) => sum + movement.netWeightMg * (movement.direction === "in" ? 1 : -1), 0);
      const currentPhysicalWeightMg = items.reduce((sum, item) => sum + item.netWeightMg, 0);
      const signedMovementMg = amountFor(() => true);
      const categoriesInBox = [...new Set(items.map((item) => categoryByProduct.get(item.productId)).filter((name): name is string => Boolean(name)))];
      return {
        boxId: box._id,
        boxNumber: box.boxNumber,
        label: box.label,
        categories: categoriesInBox,
        itemCount: items.length,
        openingWeightMg: Math.max(0, currentPhysicalWeightMg - signedMovementMg),
        // Net incoming purchases and manual stock corrections. This keeps the
        // box roll-forward balanced when an adjustment reduces physical weight.
        stockAddedWeightMg: amountFor((movement) => movement.sourceTable === "purchases" || movement.sourceTable === "stock_adjustments"),
        weightSoldMg: amountFor((movement) => movement.sourceTable === "sales"),
        transferredInWeightMg: boxMovements.filter((movement) => movement.sourceTable === "box_transfers" && movement.direction === "in").reduce((sum, movement) => sum + movement.netWeightMg, 0),
        transferredOutWeightMg: boxMovements.filter((movement) => movement.sourceTable === "box_transfers" && movement.direction === "out").reduce((sum, movement) => sum + movement.netWeightMg, 0),
        currentPhysicalWeightMg,
      };
    });
  },
});

/** Customer aging: outstanding balance bucketed by days since the customer's oldest unpaid bill. */
export const getCustomerAging = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const customers = (
      await ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
    ).filter((c) => (c.currentBalancePaise ?? c.openingBalancePaise) > 0);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const rows = await Promise.all(
      customers.map(async (customer) => {
        const unpaidSale = await ctx.db
          .query("sales")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .filter((q) => q.and(q.eq(q.field("status"), "finalized"), q.lt(q.field("amountPaidPaise"), q.field("totalPaise"))))
          .order("asc")
          .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

        const ageDays = unpaidSale ? Math.floor((now - unpaidSale.createdAt) / DAY) : 0;
        const bucket = ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";

        return {
          customerId: customer._id,
          name: customer.name,
          outstandingPaise: customer.currentBalancePaise ?? customer.openingBalancePaise,
          ageDays,
          bucket,
        };
      }),
    );

    return rows.sort((a, b) => b.outstandingPaise - a.outstandingPaise);
  },
});

/** Every stock movement, newest first — the append-only audit trail of everything that ever changed inventory. */
export const getStockJournal = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(200);

    const products = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const productNameById = new Map(products.map((p) => [p._id, p.name]));
    const boxes = await ctx.db.query("boxes").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect();
    const boxById = new Map(boxes.map((box) => [box._id, `Box ${box.boxNumber}${box.label ? ` · ${box.label}` : ""}`]));

    return movements.map((m) => ({
      _id: m._id,
      productName: productNameById.get(m.productId) ?? "Product",
      boxName: m.boxId ? boxById.get(m.boxId) ?? "Box unavailable" : "—",
      quantity: m.quantity,
      direction: m.direction,
      netWeightMg: m.netWeightMg,
      sourceTable: m.sourceTable,
      createdAt: m.createdAt,
    }));
  },
});
