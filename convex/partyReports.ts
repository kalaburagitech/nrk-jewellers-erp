import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext } from "./lib/auth";

/**
 * Vyapar-style reports: party reports (statement, all parties, sale/purchase
 * by party, party report by item) and profit reports (P&L, bill-wise,
 * party-wise, item-wise) plus the Day Book. Read-only; built entirely from
 * the existing sales / purchases / ledgers / expenses tables.
 */

const range = { startDate: v.number(), endDate: v.number() };

type Org = Id<"organizations">;

const live = <T extends { deletedAt?: number }>(rows: T[]) => rows.filter((r) => r.deletedAt === undefined);

async function salesInRange(ctx: QueryCtx, org: Org, startDate: number, endDate: number) {
  const rows = await ctx.db
    .query("sales")
    .withIndex("by_org_and_time", (q) => q.eq("organizationId", org).gte("createdAt", startDate).lte("createdAt", endDate))
    .collect();
  return live(rows).filter((s) => s.status === "finalized");
}

async function purchasesInRange(ctx: QueryCtx, org: Org, startDate: number, endDate: number) {
  const rows = await ctx.db
    .query("purchases")
    .withIndex("by_org_and_time", (q) => q.eq("organizationId", org).gte("createdAt", startDate).lte("createdAt", endDate))
    .collect();
  return live(rows).filter((p) => p.status === "finalized");
}

const isSaleInvoice = (s: Doc<"sales">) => s.documentType === "sales_invoice";
const isSaleReturn = (s: Doc<"sales">) => s.documentType === "sales_return" || s.documentType === "credit_note";
const isPurchaseInvoice = (p: Doc<"purchases">) => (p.documentType ?? "purchase_invoice") === "purchase_invoice";
const isPurchaseReturn = (p: Doc<"purchases">) => p.documentType === "purchase_return";

/** Taxable sale value (before GST, after bill discount). */
const saleValue = (s: Doc<"sales">) => s.subtotalPaise - s.discountPaise;

async function partyNames(ctx: QueryCtx, org: Org) {
  const [customers, suppliers] = await Promise.all([
    ctx.db.query("customers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ctx.db.query("suppliers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
  ]);
  return {
    customers: live(customers),
    suppliers: live(suppliers),
    customerById: new Map(customers.map((c) => [String(c._id), c])),
    supplierById: new Map(suppliers.map((s) => [String(s._id), s])),
  };
}

/**
 * Cost of goods sold per sale line. Exact purchase cost when the sold box
 * piece came in through a purchase bill; otherwise the item's weighted
 * average purchase cost (per gram, or per piece for piece-only items).
 * Lines with no purchase history at all cost 0 and are counted so the UI can
 * say the profit is overstated rather than silently hiding it.
 * ponytail: whole-org scan of purchaseItems per call; index by product if this gets slow.
 */
async function buildCostModel(ctx: QueryCtx, org: Org) {
  const [purchases, purchaseItems] = await Promise.all([
    ctx.db.query("purchases").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ctx.db.query("purchaseItems").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
  ]);
  const validPurchase = new Set(
    live(purchases).filter((p) => p.status === "finalized" && isPurchaseInvoice(p)).map((p) => String(p._id)),
  );
  const byBoxItem = new Map<string, { costPaise: number; netMg: number }>();
  const byProduct = new Map<string, { costPaise: number; netMg: number; pieces: number; pieceCostPaise: number }>();
  for (const item of live(purchaseItems)) {
    if (!validPurchase.has(String(item.purchaseId))) continue;
    if (item.boxItemId) byBoxItem.set(String(item.boxItemId), { costPaise: item.lineTotalPaise, netMg: item.netWeightMg });
    const agg = byProduct.get(String(item.productId)) ?? { costPaise: 0, netMg: 0, pieces: 0, pieceCostPaise: 0 };
    if (item.netWeightMg > 0) {
      agg.costPaise += item.lineTotalPaise;
      agg.netMg += item.netWeightMg;
    }
    const pieces = item.pieces ?? (item.boxItemId ? 1 : 0);
    if (pieces > 0) {
      agg.pieces += pieces;
      agg.pieceCostPaise += item.lineTotalPaise;
    }
    byProduct.set(String(item.productId), agg);
  }

  return (line: Doc<"saleItems">): number | null => {
    const exact = line.boxItemId ? byBoxItem.get(String(line.boxItemId)) : undefined;
    if (exact && exact.netMg > 0) return Math.round((exact.costPaise * line.netWeightMg) / exact.netMg);
    if (exact) return exact.costPaise;
    const avg = byProduct.get(String(line.productId));
    if (avg && avg.netMg > 0 && line.netWeightMg > 0) return Math.round((avg.costPaise * line.netWeightMg) / avg.netMg);
    const pieces = line.pieces ?? (line.boxItemId ? 1 : 0);
    if (avg && avg.pieces > 0 && pieces > 0) return Math.round((avg.pieceCostPaise * pieces) / avg.pieces);
    return null;
  };
}

async function itemsBySale(ctx: QueryCtx, org: Org, saleIds: Set<string>) {
  const items = live(await ctx.db.query("saleItems").withIndex("by_org", (q) => q.eq("organizationId", org)).collect());
  const map = new Map<string, Doc<"saleItems">[]>();
  for (const item of items) {
    if (!saleIds.has(String(item.saleId))) continue;
    const list = map.get(String(item.saleId)) ?? [];
    list.push(item);
    map.set(String(item.saleId), list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Party reports
// ---------------------------------------------------------------------------

/** Every customer and supplier with their current receivable / payable balance. */
export const allParties = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const { customers, suppliers } = await partyNames(ctx, auth.organizationId);
    const balance = (p: { currentBalancePaise?: number; openingBalancePaise: number }) =>
      p.currentBalancePaise ?? p.openingBalancePaise;
    return [
      ...customers.map((c) => {
        const b = balance(c);
        return {
          id: String(c._id), partyType: "customer" as const, name: c.name, phone: c.phone ?? "", email: c.email ?? "",
          receivablePaise: Math.max(0, b), payablePaise: Math.max(0, -b), creditLimitPaise: c.creditLimitPaise ?? null,
        };
      }),
      ...suppliers.map((s) => {
        const b = balance(s);
        return {
          id: String(s._id), partyType: "supplier" as const, name: s.name, phone: s.phone ?? "", email: s.email ?? "",
          receivablePaise: Math.max(0, -b), payablePaise: Math.max(0, b), creditLimitPaise: s.creditLimitPaise ?? null,
        };
      }),
    ].sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Ledger statement for one party with running balance and a Vyapar-style summary. */
export const partyStatement = query({
  args: { ...range, partyType: v.union(v.literal("customer"), v.literal("supplier")), partyId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const id = ctx.db.normalizeId(args.partyType === "customer" ? "customers" : "suppliers", args.partyId);
    if (!id) return null;
    const party = await ctx.db.get(id);
    if (!party || party.organizationId !== org || party.deletedAt !== undefined) return null;

    type Entry = { _id: string; deletedAt?: number; createdAt: number; sourceTable: string; sourceId: string; debitPaise: number; creditPaise: number };
    const raw: Entry[] =
      args.partyType === "customer"
        ? await ctx.db.query("customerLedgerEntries").withIndex("by_customer", (q) => q.eq("customerId", id as Id<"customers">)).collect()
        : await ctx.db.query("supplierLedgerEntries").withIndex("by_supplier", (q) => q.eq("supplierId", id as Id<"suppliers">)).collect();
    const entries = live(raw).sort((a, b) => a.createdAt - b.createdAt);

    // Customer ledger: debit = they owe us. Supplier ledger: credit = we owe them.
    const sign = args.partyType === "customer" ? 1 : -1;
    let running = party.openingBalancePaise * sign;
    let opening = running;
    const rows = [];
    for (const e of entries) {
      running += e.debitPaise - e.creditPaise;
      if (e.createdAt < args.startDate) {
        opening = running;
        continue;
      }
      if (e.createdAt > args.endDate) break;
      let ref = "";
      let txnType = e.sourceTable;
      let totalPaise = Math.max(e.debitPaise, e.creditPaise);
      if (e.sourceTable === "sales") {
        const s = await ctx.db.get(e.sourceId as Id<"sales">);
        if (s) {
          ref = s.invoiceNumber;
          txnType = s.documentType.replaceAll("_", " ");
          totalPaise = s.totalPaise;
        }
      } else if (e.sourceTable === "purchases") {
        const p = await ctx.db.get(e.sourceId as Id<"purchases">);
        if (p) {
          ref = p.invoiceNumber;
          txnType = (p.documentType ?? "purchase_invoice").replaceAll("_", " ");
          totalPaise = p.totalPaise;
        }
      }
      rows.push({
        id: String(e._id), date: e.createdAt, txnType, ref, totalPaise,
        debitPaise: e.debitPaise, creditPaise: e.creditPaise, balancePaise: running * sign,
      });
    }

    // Summary figures for the range from the documents themselves.
    const [sales, purchases] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
    ]);
    const mine = <T extends { customerId?: Id<"customers">; supplierId?: Id<"suppliers"> }>(r: T) =>
      String(args.partyType === "customer" ? r.customerId : r.supplierId) === String(id);
    const mySales = sales.filter(mine);
    const myPurchases = purchases.filter(mine);
    const sum = <T>(rs: T[], f: (r: T) => number) => rs.reduce((a, r) => a + f(r), 0);

    return {
      party: { name: party.name, phone: party.phone ?? "", address: party.address ?? "" },
      openingBalancePaise: opening * sign,
      closingBalancePaise: (rows.at(-1)?.balancePaise ?? opening * sign),
      rows,
      summary: {
        totalSalePaise: sum(mySales.filter(isSaleInvoice), (s) => s.totalPaise) - sum(mySales.filter(isSaleReturn), (s) => s.totalPaise),
        totalPurchasePaise: sum(myPurchases.filter(isPurchaseInvoice), (p) => p.totalPaise) - sum(myPurchases.filter(isPurchaseReturn), (p) => p.totalPaise),
        moneyInPaise: sum(mySales.filter(isSaleInvoice), (s) => s.amountPaidPaise),
        moneyOutPaise: sum(myPurchases.filter(isPurchaseInvoice), (p) => p.amountPaidPaise),
      },
    };
  },
});

/** Sale and purchase totals per party for the range. */
export const salePurchaseByParty = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [sales, purchases, names] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
      partyNames(ctx, org),
    ]);
    const rows = new Map<string, { id: string; partyType: "customer" | "supplier"; name: string; phone: string; salePaise: number; purchasePaise: number }>();
    const bump = (key: string, partyType: "customer" | "supplier", party: { name: string; phone?: string } | undefined, sale: number, purchase: number) => {
      const row = rows.get(key) ?? { id: key, partyType, name: party?.name ?? "—", phone: party?.phone ?? "", salePaise: 0, purchasePaise: 0 };
      row.salePaise += sale;
      row.purchasePaise += purchase;
      rows.set(key, row);
    };
    for (const s of sales) {
      const amount = isSaleInvoice(s) ? s.totalPaise : isSaleReturn(s) ? -s.totalPaise : 0;
      if (amount) bump(`c:${s.customerId}`, "customer", names.customerById.get(String(s.customerId)), amount, 0);
    }
    for (const p of purchases) {
      const amount = isPurchaseInvoice(p) ? p.totalPaise : isPurchaseReturn(p) ? -p.totalPaise : 0;
      if (amount) bump(`s:${p.supplierId}`, "supplier", names.supplierById.get(String(p.supplierId)), 0, amount);
    }
    return [...rows.values()].sort((a, b) => b.salePaise + b.purchasePaise - (a.salePaise + a.purchasePaise));
  },
});

/** Per party: quantity and amount of sales and purchases, optionally narrowed to one item or category. */
export const partyReportByItem = query({
  args: { ...range, productId: v.optional(v.id("products")), categoryId: v.optional(v.id("stockCategories")) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [sales, purchases, names, products, saleItemRows, purchaseItemRows] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
      partyNames(ctx, org),
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("saleItems").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("purchaseItems").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ]);
    const productById = new Map(products.map((p) => [String(p._id), p]));
    const wanted = (productId: Id<"products">) => {
      if (args.productId && productId !== args.productId) return false;
      if (args.categoryId && productById.get(String(productId))?.stockCategoryId !== args.categoryId) return false;
      return true;
    };
    const saleById = new Map(sales.filter((s) => isSaleInvoice(s) || isSaleReturn(s)).map((s) => [String(s._id), s]));
    const purchaseById = new Map(purchases.filter((p) => isPurchaseInvoice(p) || isPurchaseReturn(p)).map((p) => [String(p._id), p]));

    type Row = { id: string; name: string; saleQty: number; saleWeightMg: number; salePaise: number; purchaseQty: number; purchaseWeightMg: number; purchasePaise: number };
    const rows = new Map<string, Row>();
    const row = (key: string, name: string) => {
      const r = rows.get(key) ?? { id: key, name, saleQty: 0, saleWeightMg: 0, salePaise: 0, purchaseQty: 0, purchaseWeightMg: 0, purchasePaise: 0 };
      rows.set(key, r);
      return r;
    };
    for (const item of live(saleItemRows)) {
      const s = saleById.get(String(item.saleId));
      if (!s || !wanted(item.productId)) continue;
      const k = isSaleReturn(s) ? -1 : 1;
      const r = row(`c:${s.customerId}`, names.customerById.get(String(s.customerId))?.name ?? "—");
      r.saleQty += k * (item.pieces ?? 1);
      r.saleWeightMg += k * item.netWeightMg;
      r.salePaise += k * item.lineTotalPaise;
    }
    for (const item of live(purchaseItemRows)) {
      const p = purchaseById.get(String(item.purchaseId));
      if (!p || !wanted(item.productId)) continue;
      const k = isPurchaseReturn(p) ? -1 : 1;
      const r = row(`s:${p.supplierId}`, names.supplierById.get(String(p.supplierId))?.name ?? "—");
      r.purchaseQty += k * (item.pieces ?? 1);
      r.purchaseWeightMg += k * item.netWeightMg;
      r.purchasePaise += k * item.lineTotalPaise;
    }
    return [...rows.values()].sort((a, b) => b.salePaise + b.purchasePaise - (a.salePaise + a.purchasePaise));
  },
});

// ---------------------------------------------------------------------------
// Profit reports
// ---------------------------------------------------------------------------

/**
 * One pass that powers Profit & Loss, Bill-wise Profit, Party-wise Profit &
 * Loss and Item-wise Profit & Loss. Profit = taxable sale value (after bill
 * discount, excluding GST) − purchase cost of the goods sold.
 */
export const profitReports = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [sales, purchases, names, products, costOf, expenses] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
      partyNames(ctx, org),
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      buildCostModel(ctx, org),
      ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ]);
    const productName = new Map(products.map((p) => [String(p._id), p.name]));
    const invoices = sales.filter(isSaleInvoice);
    const returns = sales.filter(isSaleReturn);
    const lines = await itemsBySale(ctx, org, new Set(invoices.map((s) => String(s._id))));

    let linesWithoutCost = 0;
    const bills = [];
    const parties = new Map<string, { id: string; name: string; phone: string; salePaise: number; costPaise: number; profitPaise: number }>();
    const items = new Map<string, { id: string; name: string; qty: number; weightMg: number; salePaise: number; costPaise: number; profitPaise: number }>();

    for (const s of invoices) {
      const saleLines = lines.get(String(s._id)) ?? [];
      const value = saleValue(s);
      const preTaxLines = saleLines.reduce((a, l) => a + l.lineTotalPaise - l.lineTaxPaise, 0);
      let billCost = 0;
      for (const l of saleLines) {
        const cost = costOf(l);
        if (cost === null) linesWithoutCost++;
        const lineCost = cost ?? 0;
        billCost += lineCost;
        // Spread the bill discount across lines by their share of the pre-tax value.
        const lineValue = preTaxLines > 0 ? Math.round((value * (l.lineTotalPaise - l.lineTaxPaise)) / preTaxLines) : 0;
        const key = String(l.productId);
        const it = items.get(key) ?? { id: key, name: productName.get(key) ?? "—", qty: 0, weightMg: 0, salePaise: 0, costPaise: 0, profitPaise: 0 };
        it.qty += l.pieces ?? 1;
        it.weightMg += l.netWeightMg;
        it.salePaise += lineValue;
        it.costPaise += lineCost;
        it.profitPaise += lineValue - lineCost;
        items.set(key, it);
      }
      const customer = names.customerById.get(String(s.customerId));
      bills.push({
        id: String(s._id), date: s.createdAt, invoiceNumber: s.invoiceNumber, partyName: customer?.name ?? "—",
        totalPaise: s.totalPaise, salePaise: value, costPaise: billCost, profitPaise: value - billCost,
      });
      const pk = String(s.customerId);
      const p = parties.get(pk) ?? { id: pk, name: customer?.name ?? "—", phone: customer?.phone ?? "", salePaise: 0, costPaise: 0, profitPaise: 0 };
      p.salePaise += s.totalPaise;
      p.costPaise += billCost;
      p.profitPaise += value - billCost;
      parties.set(pk, p);
    }

    // Returns reverse revenue; goods come back to stock so their cost reverses too (approximated at the same margin).
    const returnValue = returns.reduce((a, s) => a + saleValue(s), 0);
    const saleTotal = bills.reduce((a, b) => a + b.salePaise, 0);
    const cogs = bills.reduce((a, b) => a + b.costPaise, 0);
    const returnCost = saleTotal > 0 ? Math.round((cogs * returnValue) / saleTotal) : 0;

    const expensesInRange = live(expenses).filter(
      (e) => e.status === "recorded" && e.expenseDate >= args.startDate && e.expenseDate <= args.endDate,
    );
    const byCategory = new Map<string, number>();
    for (const e of expensesInRange) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountPaise);
    const expenseTotal = expensesInRange.reduce((a, e) => a + e.amountPaise, 0);

    const purchaseValue = purchases.filter(isPurchaseInvoice).reduce((a, p) => a + p.subtotalPaise, 0);
    const purchaseReturnValue = purchases.filter(isPurchaseReturn).reduce((a, p) => a + p.subtotalPaise, 0);
    const gstPayable = invoices.reduce((a, s) => a + s.taxPaise, 0) - returns.reduce((a, s) => a + s.taxPaise, 0);
    const gstReceivable = purchases.filter(isPurchaseInvoice).reduce((a, p) => a + p.taxPaise, 0);
    const grossProfit = saleTotal - returnValue - (cogs - returnCost);

    return {
      linesWithoutCost,
      pnl: {
        salePaise: saleTotal,
        saleReturnPaise: returnValue,
        costOfGoodsSoldPaise: cogs - returnCost,
        grossProfitPaise: grossProfit,
        expenses: [...byCategory.entries()].map(([category, amountPaise]) => ({ category, amountPaise })).sort((a, b) => b.amountPaise - a.amountPaise),
        expenseTotalPaise: expenseTotal,
        netProfitPaise: grossProfit - expenseTotal,
        // Shown for reference, not part of profit (GST is a pass-through; purchases go to stock).
        purchasePaise: purchaseValue,
        purchaseReturnPaise: purchaseReturnValue,
        gstPayablePaise: gstPayable,
        gstReceivablePaise: gstReceivable,
      },
      bills: bills.sort((a, b) => b.date - a.date),
      parties: [...parties.values()].sort((a, b) => b.profitPaise - a.profitPaise),
      items: [...items.values()].sort((a, b) => b.profitPaise - a.profitPaise),
    };
  },
});

// ---------------------------------------------------------------------------
// Day book
// ---------------------------------------------------------------------------

/** Every money-moving transaction in the range, newest first, with money in / out. */
export const dayBook = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [sales, purchases, names, expenses] = await Promise.all([
      salesInRange(ctx, org, args.startDate, args.endDate),
      purchasesInRange(ctx, org, args.startDate, args.endDate),
      partyNames(ctx, org),
      ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ]);
    const rows: { id: string; date: number; name: string; ref: string; txnType: string; totalPaise: number; moneyInPaise: number; moneyOutPaise: number }[] = [];
    for (const s of sales) {
      if (!isSaleInvoice(s) && !isSaleReturn(s)) continue;
      const ret = isSaleReturn(s);
      rows.push({
        id: String(s._id), date: s.createdAt, name: names.customerById.get(String(s.customerId))?.name ?? "—",
        ref: s.invoiceNumber, txnType: ret ? "Sale Return" : "Sale", totalPaise: s.totalPaise,
        moneyInPaise: ret ? 0 : s.amountPaidPaise, moneyOutPaise: ret ? s.amountPaidPaise : 0,
      });
    }
    for (const p of purchases) {
      if (!isPurchaseInvoice(p) && !isPurchaseReturn(p)) continue;
      const ret = isPurchaseReturn(p);
      rows.push({
        id: String(p._id), date: p.createdAt, name: names.supplierById.get(String(p.supplierId))?.name ?? "—",
        ref: p.invoiceNumber, txnType: ret ? "Purchase Return" : "Purchase", totalPaise: p.totalPaise,
        moneyInPaise: ret ? p.amountPaidPaise : 0, moneyOutPaise: ret ? 0 : p.amountPaidPaise,
      });
    }
    for (const e of live(expenses)) {
      if (e.status !== "recorded" || e.expenseDate < args.startDate || e.expenseDate > args.endDate) continue;
      rows.push({
        id: String(e._id), date: e.expenseDate, name: e.category, ref: e.description ?? "", txnType: "Expense",
        totalPaise: e.amountPaise, moneyInPaise: 0, moneyOutPaise: e.amountPaise,
      });
    }
    return rows.sort((a, b) => b.date - a.date);
  },
});
