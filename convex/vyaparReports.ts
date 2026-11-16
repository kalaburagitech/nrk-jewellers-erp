import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext } from "./lib/auth";

/**
 * Data feeds for the Vyapar-style Reports hub. Each query returns plain,
 * already-joined rows for a date range; the hub derives the individual
 * reports (Day book, Party statement, Profit & Loss, …) from them in the
 * browser so that switching reports doesn't re-hit the server.
 */

const range = { startDate: v.number(), endDate: v.number() };

async function salesInRange(ctx: QueryCtx, organizationId: Id<"organizations">, startDate: number, endDate: number) {
  return (
    await ctx.db
      .query("sales")
      .withIndex("by_org_and_time", (q) => q.eq("organizationId", organizationId).gte("createdAt", startDate).lte("createdAt", endDate))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
  ).filter((s) => s.status === "finalized");
}

async function purchasesInRange(ctx: QueryCtx, organizationId: Id<"organizations">, startDate: number, endDate: number) {
  return (
    await ctx.db
      .query("purchases")
      .withIndex("by_org_and_time", (q) => q.eq("organizationId", organizationId).gte("createdAt", startDate).lte("createdAt", endDate))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect()
  ).filter((p) => p.status === "finalized");
}

async function partyMaps(ctx: QueryCtx, organizationId: Id<"organizations">) {
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();
  const suppliers = await ctx.db
    .query("suppliers")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();
  return {
    customers,
    suppliers,
    customerById: new Map<string, Doc<"customers">>(customers.map((c) => [c._id, c])),
    supplierById: new Map<string, Doc<"suppliers">>(suppliers.map((s) => [s._id, s])),
  };
}

/** Every finalized sale/purchase document, payment and expense in the range, with party names joined. */
export const getTransactions = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [sales, purchases, parties] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
      partyMaps(ctx, org),
    ]);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org_and_time", (q) => q.eq("organizationId", org).gte("createdAt", args.startDate).lte("createdAt", args.endDate))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const expenses = (
      await ctx.db
        .query("expenses")
        .withIndex("by_org", (q) => q.eq("organizationId", org))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect()
    ).filter((e) => e.status === "recorded" && e.expenseDate >= args.startDate && e.expenseDate <= args.endDate);

    const userIds = new Set<Id<"users">>(sales.map((s) => s.createdByUserId));
    for (const p of purchases) userIds.add(p.createdByUserId);
    const userName = new Map<string, string>();
    for (const id of userIds) {
      const user = await ctx.db.get(id);
      userName.set(id, user?.name ?? user?.email ?? "User");
    }

    return {
      sales: sales.map((s) => {
        const c = parties.customerById.get(s.customerId);
        return {
          id: s._id,
          date: s.createdAt,
          number: s.invoiceNumber,
          type: s.documentType,
          isGst: s.isGst,
          partyId: s.customerId as string,
          partyName: c?.name ?? "—",
          partyPhone: c?.phone ?? "",
          partyGroup: c?.customerType ?? "regular",
          subtotalPaise: s.subtotalPaise,
          discountPaise: s.discountPaise + (s.oldItemDeductionPaise ?? 0),
          taxPaise: s.taxPaise,
          totalPaise: s.totalPaise,
          paidPaise: s.amountPaidPaise,
          userId: s.createdByUserId as string,
          userName: userName.get(s.createdByUserId) ?? "User",
        };
      }),
      purchases: purchases.map((p) => {
        const sup = parties.supplierById.get(p.supplierId);
        return {
          id: p._id,
          date: p.createdAt,
          number: p.invoiceNumber,
          type: p.documentType ?? "purchase_invoice",
          partyId: p.supplierId as string,
          partyName: sup?.name ?? "—",
          partyPhone: sup?.phone ?? "",
          subtotalPaise: p.subtotalPaise,
          taxPaise: p.taxPaise,
          totalPaise: p.totalPaise,
          paidPaise: p.amountPaidPaise,
          userId: p.createdByUserId as string,
          userName: userName.get(p.createdByUserId) ?? "User",
        };
      }),
      payments: payments.map((p) => ({
        id: p._id,
        date: p.createdAt,
        direction: p.direction,
        partyType: p.partyType,
        partyId: p.partyId,
        partyName:
          (p.partyType === "customer" ? parties.customerById.get(p.partyId)?.name : parties.supplierById.get(p.partyId)?.name) ?? "—",
        mode: p.mode,
        amountPaise: p.amountPaise,
        sourceTable: p.sourceTable ?? null,
        sourceId: p.sourceId ?? null,
      })),
      expenses: expenses.map((e) => ({
        id: e._id,
        date: e.expenseDate,
        category: e.category,
        description: e.description ?? "",
        amountPaise: e.amountPaise,
      })),
    };
  },
});

/** All customers and suppliers with their running balances (positive = receivable for customers, payable for suppliers). */
export const getParties = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const { customers, suppliers } = await partyMaps(ctx, auth.organizationId);
    return [
      ...customers.map((c) => ({
        id: c._id as string,
        kind: "customer" as const,
        name: c.name,
        phone: c.phone ?? "",
        email: c.email ?? "",
        group: c.customerType,
        balancePaise: c.currentBalancePaise ?? c.openingBalancePaise,
        openingBalancePaise: c.openingBalancePaise,
        creditLimitPaise: c.creditLimitPaise ?? null,
        isActive: c.isActive,
      })),
      ...suppliers.map((s) => ({
        id: s._id as string,
        kind: "supplier" as const,
        name: s.name,
        phone: s.phone ?? "",
        email: s.email ?? "",
        group: "supplier",
        balancePaise: s.currentBalancePaise ?? s.openingBalancePaise,
        openingBalancePaise: s.openingBalancePaise,
        creditLimitPaise: s.creditLimitPaise ?? null,
        isActive: s.isActive,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Line items of finalized sales and purchases in the range. For a sold box
 * piece, `costPaise` is the purchase cost of that piece (prorated by net
 * weight when only part of it was sold); null when no purchase is linked.
 */
export const getItemLines = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [sales, purchases, parties] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
      partyMaps(ctx, org),
    ]);
    const products = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .collect();
    const categories = await ctx.db
      .query("stockCategories")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .collect();
    const categoryName = new Map<string, string>(categories.map((c) => [c._id, c.name]));
    const productById = new Map(products.map((p) => [p._id as string, p]));

    const saleLines = [];
    for (const sale of sales) {
      const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect();
      for (const item of items) {
        let costPaise: number | null = null;
        if (item.boxItemId) {
          const boxItemId = item.boxItemId;
          const bought = await ctx.db
            .query("purchaseItems")
            .withIndex("by_product", (q) => q.eq("productId", item.productId))
            .filter((q) => q.and(q.eq(q.field("boxItemId"), boxItemId), q.eq(q.field("deletedAt"), undefined)))
            .first();
          if (bought && bought.netWeightMg > 0) {
            costPaise = Math.round((bought.lineTotalPaise * Math.min(item.netWeightMg, bought.netWeightMg)) / bought.netWeightMg);
          } else if (bought) {
            costPaise = bought.lineTotalPaise;
          }
        }
        const product = productById.get(item.productId);
        saleLines.push({
          docId: sale._id as string,
          docType: sale.documentType,
          docNumber: sale.invoiceNumber,
          date: sale.createdAt,
          partyId: sale.customerId as string,
          partyName: parties.customerById.get(sale.customerId)?.name ?? "—",
          productId: item.productId as string,
          productName: product?.name ?? "Item",
          categoryName: product?.stockCategoryId ? categoryName.get(product.stockCategoryId) ?? "Uncategorised" : "Uncategorised",
          hsn: product?.hsnCode ?? "",
          quantity: item.pieces ?? 1,
          netWeightMg: item.netWeightMg,
          grossWeightMg: item.grossWeightMg,
          makingChargePaise: item.makingChargePaise,
          taxPaise: item.lineTaxPaise,
          amountPaise: item.lineTotalPaise,
          costPaise,
        });
      }
    }

    const purchaseLines = [];
    for (const purchase of purchases) {
      const items = await ctx.db
        .query("purchaseItems")
        .withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect();
      for (const item of items) {
        const product = productById.get(item.productId);
        purchaseLines.push({
          docId: purchase._id as string,
          docType: purchase.documentType ?? "purchase_invoice",
          docNumber: purchase.invoiceNumber,
          date: purchase.createdAt,
          partyId: purchase.supplierId as string,
          partyName: parties.supplierById.get(purchase.supplierId)?.name ?? "—",
          productId: item.productId as string,
          productName: product?.name ?? item.label,
          categoryName: product?.stockCategoryId ? categoryName.get(product.stockCategoryId) ?? "Uncategorised" : "Uncategorised",
          hsn: product?.hsnCode ?? "",
          quantity: item.pieces ?? 1,
          netWeightMg: item.netWeightMg,
          grossWeightMg: item.grossWeightMg,
          makingChargePaise: item.makingChargePaise,
          taxPaise: 0,
          amountPaise: item.lineTotalPaise,
          costPaise: null as number | null,
        });
      }
    }
    return { saleLines, purchaseLines };
  },
});

/** Current stock per item: box pieces (Daily Sales company) plus item-wise stock (GST company). */
export const getStockSummary = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const products = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const categories = await ctx.db
      .query("stockCategories")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .collect();
    const purities = await ctx.db
      .query("metalPurities")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .collect();
    const categoryName = new Map<string, string>(categories.map((c) => [c._id, c.name]));
    const purityName = new Map<string, string>(purities.map((p) => [p._id, p.label]));

    const stock = new Map<string, { weightMg: number; pieces: number }>();
    const boxItems = await ctx.db
      .query("boxItems")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .filter((q) => q.and(q.eq(q.field("status"), "in_stock"), q.eq(q.field("deletedAt"), undefined)))
      .collect();
    for (const item of boxItems) {
      const row = stock.get(item.productId) ?? { weightMg: 0, pieces: 0 };
      row.weightMg += item.netWeightMg;
      row.pieces += 1;
      stock.set(item.productId, row);
    }
    const itemStock = await ctx.db
      .query("productStock")
      .withIndex("by_org", (q) => q.eq("organizationId", org))
      .collect();
    for (const s of itemStock) {
      const row = stock.get(s.productId) ?? { weightMg: 0, pieces: 0 };
      row.weightMg += s.weightMg;
      row.pieces += s.pieces;
      stock.set(s.productId, row);
    }

    return products
      .filter((p) => p.itemType !== "service")
      .map((p) => {
        const s = stock.get(p._id) ?? { weightMg: 0, pieces: 0 };
        return {
          id: p._id as string,
          name: p.name,
          sku: p.sku ?? "",
          hsn: p.hsnCode ?? "",
          categoryName: p.stockCategoryId ? categoryName.get(p.stockCategoryId) ?? "Uncategorised" : "Uncategorised",
          purityName: p.metalPurityId ? purityName.get(p.metalPurityId) ?? "" : "",
          unit: p.unit,
          weightMg: s.weightMg,
          pieces: s.pieces,
          reorderLevelMg: p.reorderLevelMg ?? null,
          isActive: p.isActive,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Cash and bank accounts with current balances, for the Balance Sheet and Bank Statement. */
export const getAccounts = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const accounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    return accounts.map((a) => ({
      id: a._id as string,
      name: a.name,
      type: a.type,
      balancePaise: a.currentBalancePaise ?? a.openingBalancePaise,
    }));
  },
});
