import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext } from "./lib/auth";
import { isInterStateSupply, splitGst } from "../src/lib/jewelry-calc";

/**
 * GST module data, computed from the existing GST sales invoices and purchase
 * bills — nothing is copied into a separate GST table, so the module can never
 * drift from the real transactions. Only finalized GST documents count;
 * non-GST (Daily Sales) bills are never part of it.
 *
 * Tax split per line:
 *  - lines saved with a stored split (lineCgst/Sgst/IgstPaise) use it as-is;
 *  - older lines prorate their tax across their tax configuration's
 *    CGST/SGST/IGST components, the same rule the old GST register used.
 * Purchases carry one bill-level tax; it is split by the stored inter-state
 * flag, or (older bills) by supplier state vs company state.
 */
export const report = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const organization = await ctx.db.get(auth.organizationId);

    const [sales, purchases, customers, suppliers, products, taxConfigs] = await Promise.all([
      ctx.db
        .query("sales")
        .withIndex("by_org_and_time", (q) => q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect(),
      ctx.db
        .query("purchases")
        .withIndex("by_org_and_time", (q) => q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect(),
      ctx.db.query("customers").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
      ctx.db.query("suppliers").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
      ctx.db.query("taxConfigurations").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
    ]);
    const customerById = new Map(customers.map((c) => [c._id, c]));
    const supplierById = new Map(suppliers.map((s) => [s._id, s]));
    const productById = new Map(products.map((p) => [p._id, p]));
    const taxById = new Map(taxConfigs.map((t) => [t._id, t]));

    const gstSales = sales.filter((s) => s.isGst && s.status === "finalized" && s.documentType === "sales_invoice");

    type HsnRow = { hsnCode: string; ratePercent: number; pieces: number; netWeightMg: number; taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
    const hsn = new Map<string, HsnRow>();
    type RateRow = { ratePercent: number; taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
    const rates = new Map<number, RateRow>();

    const salesRows = [];
    for (const sale of gstSales) {
      const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .collect();
      let cgstPaise = 0;
      let sgstPaise = 0;
      let igstPaise = 0;
      for (const item of items) {
        const split = lineSplit(item, item.taxConfigurationId ? taxById.get(item.taxConfigurationId) : undefined);
        cgstPaise += split.cgstPaise;
        sgstPaise += split.sgstPaise;
        igstPaise += split.igstPaise;

        const config = item.taxConfigurationId ? taxById.get(item.taxConfigurationId) : undefined;
        const ratePercent = config ? (config.cgstBasisPoints + config.sgstBasisPoints + config.igstBasisPoints) / 100 : 0;
        const taxable = item.lineTotalPaise - item.lineTaxPaise;
        const code = item.hsnCode ?? productById.get(item.productId)?.hsnCode ?? config?.hsnCode ?? "—";
        const key = `${code}|${ratePercent}`;
        const h = hsn.get(key) ?? { hsnCode: code, ratePercent, pieces: 0, netWeightMg: 0, taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
        h.pieces += item.pieces ?? 1;
        h.netWeightMg += item.netWeightMg;
        h.taxableValuePaise += taxable;
        h.cgstPaise += split.cgstPaise;
        h.sgstPaise += split.sgstPaise;
        h.igstPaise += split.igstPaise;
        hsn.set(key, h);
        const r = rates.get(ratePercent) ?? { ratePercent, taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
        r.taxableValuePaise += taxable;
        r.cgstPaise += split.cgstPaise;
        r.sgstPaise += split.sgstPaise;
        r.igstPaise += split.igstPaise;
        rates.set(ratePercent, r);
      }
      const customer = customerById.get(sale.customerId);
      salesRows.push({
        saleId: sale._id,
        invoiceNumber: sale.invoiceNumber,
        createdAt: sale.createdAt,
        customerName: customer?.name ?? "—",
        customerGstin: customer?.gstin,
        placeOfSupply: sale.stateOfSupply ?? customer?.state ?? organization?.state,
        isInterState: cgstPaise + sgstPaise === 0 && igstPaise > 0,
        taxableValuePaise: sale.subtotalPaise - sale.discountPaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalTaxPaise: sale.taxPaise,
        totalPaise: sale.totalPaise,
      });
    }

    const purchaseRows = purchases
      .filter((p) => p.status === "finalized" && (p.documentType ?? "purchase_invoice") === "purchase_invoice" && p.taxPaise > 0)
      .map((p) => {
        const supplier = supplierById.get(p.supplierId);
        const interState = p.isInterState ?? isInterStateSupply(organization?.state, supplier?.state);
        const split = splitGst(p.taxPaise, interState);
        return {
          purchaseId: p._id,
          invoiceNumber: p.invoiceNumber,
          createdAt: p.createdAt,
          supplierName: supplier?.name ?? "—",
          supplierGstin: supplier?.gstin,
          supplierState: supplier?.state,
          isInterState: interState,
          taxableValuePaise: p.subtotalPaise,
          ...split,
          totalTaxPaise: p.taxPaise,
          totalPaise: p.totalPaise,
        };
      });

    const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
    const output = {
      taxableValuePaise: sum(salesRows, (r) => r.taxableValuePaise),
      cgstPaise: sum(salesRows, (r) => r.cgstPaise),
      sgstPaise: sum(salesRows, (r) => r.sgstPaise),
      igstPaise: sum(salesRows, (r) => r.igstPaise),
      invoiceCount: salesRows.length,
    };
    const input = {
      taxableValuePaise: sum(purchaseRows, (r) => r.taxableValuePaise),
      cgstPaise: sum(purchaseRows, (r) => r.cgstPaise),
      sgstPaise: sum(purchaseRows, (r) => r.sgstPaise),
      igstPaise: sum(purchaseRows, (r) => r.igstPaise),
      billCount: purchaseRows.length,
    };

    return {
      company: { name: organization?.legalName || organization?.name || "", gstin: organization?.gstin, state: organization?.state },
      sales: salesRows,
      purchases: purchaseRows,
      hsnSummary: [...hsn.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.ratePercent - b.ratePercent),
      rateSummary: [...rates.values()].sort((a, b) => a.ratePercent - b.ratePercent),
      output,
      input,
      net: {
        cgstPaise: output.cgstPaise - input.cgstPaise,
        sgstPaise: output.sgstPaise - input.sgstPaise,
        igstPaise: output.igstPaise - input.igstPaise,
      },
    };
  },
});

function lineSplit(item: Doc<"saleItems">, config: Doc<"taxConfigurations"> | undefined) {
  if (item.lineCgstPaise !== undefined || item.lineSgstPaise !== undefined || item.lineIgstPaise !== undefined) {
    return { cgstPaise: item.lineCgstPaise ?? 0, sgstPaise: item.lineSgstPaise ?? 0, igstPaise: item.lineIgstPaise ?? 0 };
  }
  if (!config || item.lineTaxPaise === 0) return { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  const totalBp = config.cgstBasisPoints + config.sgstBasisPoints + config.igstBasisPoints;
  if (totalBp === 0) return { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  const cgstPaise = Math.round((item.lineTaxPaise * config.cgstBasisPoints) / totalBp);
  const igstPaise = Math.round((item.lineTaxPaise * config.igstBasisPoints) / totalBp);
  return { cgstPaise, sgstPaise: item.lineTaxPaise - cgstPaise - igstPaise, igstPaise };
}

/** HSN code master for the GST module: every HSN used by items or GST rates, with the items under it and their rate. */
export const hsnCodes = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const [products, taxConfigs] = await Promise.all([
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("taxConfigurations").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
    ]);
    const taxById = new Map(taxConfigs.map((t) => [t._id, t]));
    const codes = new Map<string, { hsnCode: string; items: Array<{ productId: Id<"products">; name: string; ratePercent?: number }>; rateNames: Set<string> }>();
    for (const product of products) {
      if (!product.hsnCode) continue;
      const row = codes.get(product.hsnCode) ?? { hsnCode: product.hsnCode, items: [], rateNames: new Set<string>() };
      const tax = product.taxConfigurationId ? taxById.get(product.taxConfigurationId) : undefined;
      row.items.push({ productId: product._id, name: product.name, ratePercent: tax ? (tax.cgstBasisPoints + tax.sgstBasisPoints + tax.igstBasisPoints) / 100 : undefined });
      if (tax) row.rateNames.add(tax.name);
      codes.set(product.hsnCode, row);
    }
    for (const tax of taxConfigs) {
      if (!tax.hsnCode) continue;
      const row = codes.get(tax.hsnCode) ?? { hsnCode: tax.hsnCode, items: [], rateNames: new Set<string>() };
      row.rateNames.add(tax.name);
      codes.set(tax.hsnCode, row);
    }
    const itemsWithoutHsn = products.filter((p) => !p.hsnCode && p.itemType !== "service").map((p) => ({ productId: p._id, name: p.name }));
    return {
      codes: [...codes.values()].map((row) => ({ hsnCode: row.hsnCode, items: row.items, rateNames: [...row.rateNames] })).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode)),
      itemsWithoutHsn,
    };
  },
});
