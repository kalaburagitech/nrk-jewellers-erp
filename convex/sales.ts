import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { allocateInvoiceNumber, resolveBranchId } from "./lib/sequences";
import { computeOldGoldExchange, computeSaleLine, basisPointsOf, roundOffToRupee } from "../src/lib/jewelry-calc";
import type { Doc, Id } from "./_generated/dataModel";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("sales")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .take(200);
  },
});

export const getItems = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .collect();
  },
});

export const getOldGoldExchange = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("oldGoldExchanges")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .first();
  },
});

/** Everything a printable invoice needs, in one query. */
export const getInvoiceData = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");

    const [saleItems, customer, organization, oldGoldExchange, payments] = await Promise.all([
      ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
        .collect(),
      ctx.db.get(sale.customerId),
      ctx.db.get(auth.organizationId),
      ctx.db
        .query("oldGoldExchanges")
        .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
        .first(),
      ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.and(q.eq(q.field("sourceTable"), "sales"), q.eq(q.field("sourceId"), args.saleId)))
        .collect(),
    ]);

    const items = await Promise.all(
      saleItems.map(async (item) => {
        const [product, boxItem] = await Promise.all([
          ctx.db.get(item.productId),
          item.boxItemId ? ctx.db.get(item.boxItemId) : null,
        ]);
        return { ...item, productName: product?.name ?? "Item", label: boxItem?.label ?? product?.name ?? "Item" };
      }),
    );

    return { sale, items, customer, organization, oldGoldExchange, payments };
  },
});

export const listByDocumentType = query({
  args: {
    documentType: v.union(
      v.literal("quotation"),
      v.literal("proforma_invoice"),
      v.literal("sales_return"),
      v.literal("credit_note"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const rows = await ctx.db
      .query("sales")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .take(200);
    const filtered = rows.filter((r) => r.documentType === args.documentType);
    const customerIds = [...new Set(filtered.map((r) => r.customerId))];
    const customers = await Promise.all(customerIds.map((id) => ctx.db.get(id)));
    const nameById = new Map(customerIds.map((id, i) => [id, customers[i]?.name ?? "—"]));
    return filtered.map((r) => ({ ...r, customerName: nameById.get(r.customerId) ?? "—" }));
  },
});

/** Finalized sales invoices for a customer, available as the source document for a return/credit note. */
export const listReturnableInvoices = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    return sales.filter((s) => s.organizationId === auth.organizationId && s.documentType === "sales_invoice" && s.status === "finalized");
  },
});

/** Sold line items on an invoice that are still "sold" (not already returned) — the only ones eligible to come back. */
export const listReturnableItems = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    const items = await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .collect();
    const withBoxItem = await Promise.all(
      items.map(async (item) => ({ item, boxItem: item.boxItemId ? await ctx.db.get(item.boxItemId) : null })),
    );
    return withBoxItem
      .filter(({ boxItem }) => boxItem?.status === "sold")
      .map(({ item, boxItem }) => ({ ...item, label: boxItem?.label ?? "Item" }));
  },
});

export const listByCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("sales")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .collect();
  },
});

const saleLineValidator = v.object({
  boxItemId: v.id("boxItems"),
  metalPurityId: v.optional(v.id("metalPurities")),
  otherDeductionMg: v.number(),
  ratePerGramPaise: v.number(),
  wastageBasisPoints: v.number(),
  makingChargePaise: v.number(),
  stoneChargePaise: v.number(),
  taxConfigurationId: v.optional(v.id("taxConfigurations")),
});

const paymentSplitValidator = v.object({
  mode: v.union(v.literal("cash"), v.literal("upi"), v.literal("card"), v.literal("cheque"), v.literal("bank_transfer")),
  amountPaise: v.number(),
});

const oldGoldExchangeValidator = v.object({
  metalPurityId: v.id("metalPurities"),
  grossWeightMg: v.number(),
  meltingDeductionBasisPoints: v.number(),
  ratePerGramPaise: v.number(),
});

export const create = mutation({
  args: {
    customerId: v.id("customers"),
    isGst: v.boolean(),
    items: v.array(saleLineValidator),
    discountMode: v.union(v.literal("percent"), v.literal("fixed"), v.literal("none")),
    discountValue: v.number(), // basis points if percent, paise if fixed
    payments: v.array(paymentSplitValidator),
    oldGoldExchange: v.optional(oldGoldExchangeValidator),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);

    if (args.items.length === 0) throw new Error("At least one item is required");

    const existing = await ctx.db
      .query("sales")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { saleId: existing._id, duplicate: true };

    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.organizationId !== auth.organizationId) throw new Error("Customer not found");

    // Resolve + lock in every box item up front: must exist, belong to this
    // org, and still be in stock — prevents selling the same physical item
    // twice under concurrent billing.
    const taxConfigs = new Map<Id<"taxConfigurations">, number>();
    const computedLines: Array<{
      item: (typeof args.items)[number];
      boxItem: Doc<"boxItems">;
      computed: ReturnType<typeof computeSaleLine>;
    }> = [];

    for (const item of args.items) {
      if (item.ratePerGramPaise <= 0) throw new Error("Rate per gram must be greater than zero");
      const boxItem = await ctx.db.get(item.boxItemId);
      if (!boxItem || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
      if (boxItem.status !== "in_stock") throw new Error(`"${boxItem.label}" is not available for sale`);

      let gstBasisPoints = 0;
      if (args.isGst && item.taxConfigurationId) {
        if (!taxConfigs.has(item.taxConfigurationId)) {
          const config = await ctx.db.get(item.taxConfigurationId);
          if (!config || config.organizationId !== auth.organizationId) throw new Error("Tax configuration not found");
          taxConfigs.set(item.taxConfigurationId, config.cgstBasisPoints + config.sgstBasisPoints + config.igstBasisPoints);
        }
        gstBasisPoints = taxConfigs.get(item.taxConfigurationId)!;
      }

      const computed = computeSaleLine({
        grossWeightMg: boxItem.grossWeightMg,
        stoneWeightMg: boxItem.stoneWeightMg,
        otherDeductionMg: item.otherDeductionMg,
        ratePerGramPaise: item.ratePerGramPaise,
        wastageBasisPoints: item.wastageBasisPoints,
        makingChargePaise: item.makingChargePaise,
        stoneChargePaise: item.stoneChargePaise,
        gstBasisPoints,
      });
      computedLines.push({ item, boxItem, computed });
    }

    let oldGoldComputed: ReturnType<typeof computeOldGoldExchange> | null = null;
    if (args.oldGoldExchange) {
      const { metalPurityId, grossWeightMg, meltingDeductionBasisPoints, ratePerGramPaise } = args.oldGoldExchange;
      if (grossWeightMg <= 0) throw new Error("Old gold weight must be greater than zero");
      if (meltingDeductionBasisPoints < 0 || meltingDeductionBasisPoints > 10000) {
        throw new Error("Melting deduction must be between 0 and 100%");
      }
      if (ratePerGramPaise <= 0) throw new Error("Old gold rate must be greater than zero");
      const purity = await ctx.db.get(metalPurityId);
      if (!purity || purity.organizationId !== auth.organizationId) throw new Error("Metal purity not found");
      oldGoldComputed = computeOldGoldExchange({ grossWeightMg, meltingDeductionBasisPoints, ratePerGramPaise });
    }

    const itemsSubtotalPaise = computedLines.reduce((sum, l) => sum + l.computed.taxableValuePaise, 0);
    const itemsTaxPaise = computedLines.reduce((sum, l) => sum + l.computed.lineTaxPaise, 0);

    let discountPaise = 0;
    if (args.discountMode === "percent") {
      discountPaise = basisPointsOf(itemsSubtotalPaise, args.discountValue);
    } else if (args.discountMode === "fixed") {
      discountPaise = Math.max(0, args.discountValue);
    }
    discountPaise = Math.min(discountPaise, itemsSubtotalPaise);

    const preRoundTotal = itemsSubtotalPaise - discountPaise + itemsTaxPaise;
    const { roundedTotalPaise, roundOffPaise } = roundOffToRupee(preRoundTotal);

    const paymentsTotalPaise = args.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    const amountPaidPaise = paymentsTotalPaise + (oldGoldComputed?.exchangeValuePaise ?? 0);
    if (amountPaidPaise < 0 || amountPaidPaise > roundedTotalPaise) {
      throw new Error("Total payments (including any old gold exchange) cannot exceed the invoice total");
    }
    for (const p of args.payments) {
      if (p.amountPaise <= 0) throw new Error("Each payment split must be greater than zero");
    }

    const branchId = await resolveBranchId(ctx, auth.organizationId, auth.branchId);
    const invoiceNumber = await allocateInvoiceNumber(ctx, auth.organizationId, branchId, "sales_invoice", "INV-");
    const now = Date.now();

    const saleId = await ctx.db.insert("sales", {
      organizationId: auth.organizationId,
      branchId,
      customerId: args.customerId,
      documentType: "sales_invoice",
      invoiceNumber,
      status: "finalized",
      isGst: args.isGst,
      subtotalPaise: itemsSubtotalPaise,
      discountPaise,
      taxPaise: itemsTaxPaise,
      roundOffPaise,
      totalPaise: roundedTotalPaise,
      amountPaidPaise,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    const boxDeltas = new Map<Id<"boxes">, number>();
    for (const { item, boxItem, computed } of computedLines) {
      await ctx.db.insert("saleItems", {
        organizationId: auth.organizationId,
        saleId,
        productId: boxItem.productId,
        boxItemId: item.boxItemId,
        metalPurityId: item.metalPurityId,
        grossWeightMg: boxItem.grossWeightMg,
        stoneWeightMg: boxItem.stoneWeightMg,
        otherDeductionMg: item.otherDeductionMg,
        netWeightMg: computed.netWeightMg,
        ratePerGramPaise: item.ratePerGramPaise,
        wastageBasisPoints: item.wastageBasisPoints,
        makingChargePaise: item.makingChargePaise,
        stoneChargePaise: item.stoneChargePaise,
        taxConfigurationId: item.taxConfigurationId,
        lineTaxPaise: computed.lineTaxPaise,
        lineTotalPaise: computed.lineTotalPaise,
      });

      await ctx.db.patch(item.boxItemId, { status: "sold" });
      boxDeltas.set(boxItem.boxId, (boxDeltas.get(boxItem.boxId) ?? 0) + 1);

      await ctx.db.insert("stockMovements", {
        organizationId: auth.organizationId,
        productId: boxItem.productId,
        boxItemId: item.boxItemId,
        direction: "out",
        netWeightMg: computed.netWeightMg,
        quantity: 1,
        sourceTable: "sales",
        sourceId: saleId,
        createdAt: now,
      });
    }

    for (const [boxId, delta] of boxDeltas) {
      const box = await ctx.db.get(boxId);
      if (box) await ctx.db.patch(boxId, { itemCount: Math.max(0, (box.itemCount ?? 0) - delta) });
    }

    const priorBalance = customer.currentBalancePaise ?? customer.openingBalancePaise;
    const newBalance = priorBalance + roundedTotalPaise - amountPaidPaise;

    await ctx.db.insert("customerLedgerEntries", {
      organizationId: auth.organizationId,
      customerId: args.customerId,
      sourceTable: "sales",
      sourceId: saleId,
      debitPaise: roundedTotalPaise,
      creditPaise: amountPaidPaise,
      balancePaise: newBalance,
      createdAt: now,
    });
    await ctx.db.patch(args.customerId, { currentBalancePaise: newBalance });

    for (const payment of args.payments) {
      await ctx.db.insert("payments", {
        organizationId: auth.organizationId,
        direction: "receipt",
        partyType: "customer",
        partyId: args.customerId,
        sourceTable: "sales",
        sourceId: saleId,
        mode: payment.mode,
        amountPaise: payment.amountPaise,
        createdByUserId: auth.userId,
        createdAt: now,
      });
    }

    if (args.oldGoldExchange && oldGoldComputed) {
      const exchangeId = await ctx.db.insert("oldGoldExchanges", {
        organizationId: auth.organizationId,
        saleId,
        customerId: args.customerId,
        metalPurityId: args.oldGoldExchange.metalPurityId,
        grossWeightMg: args.oldGoldExchange.grossWeightMg,
        meltingDeductionBasisPoints: args.oldGoldExchange.meltingDeductionBasisPoints,
        netWeightMg: oldGoldComputed.netWeightMg,
        ratePerGramPaise: args.oldGoldExchange.ratePerGramPaise,
        exchangeValuePaise: oldGoldComputed.exchangeValuePaise,
        createdByUserId: auth.userId,
        createdAt: now,
      });

      await ctx.db.insert("payments", {
        organizationId: auth.organizationId,
        direction: "receipt",
        partyType: "customer",
        partyId: args.customerId,
        sourceTable: "old_gold_exchanges",
        sourceId: exchangeId,
        mode: "old_gold_exchange",
        amountPaise: oldGoldComputed.exchangeValuePaise,
        createdByUserId: auth.userId,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "sale.create",
      entityTable: "sales",
      entityId: saleId,
      metadata: { invoiceNumber, totalPaise: roundedTotalPaise, itemCount: args.items.length },
      createdAt: now,
    });

    return { saleId, duplicate: false };
  },
});

const estimateLineValidator = v.object({
  productId: v.id("products"),
  metalPurityId: v.optional(v.id("metalPurities")),
  grossWeightMg: v.number(),
  stoneWeightMg: v.number(),
  ratePerGramPaise: v.number(),
  wastageBasisPoints: v.number(),
  makingChargePaise: v.number(),
  stoneChargePaise: v.number(),
  taxConfigurationId: v.optional(v.id("taxConfigurations")),
});

const ESTIMATE_PREFIX: Record<string, string> = {
  quotation: "QUO-",
  proforma_invoice: "PI-",
};

/**
 * Quotations and proforma invoices are non-binding estimates: no stock
 * leaves a box, no customer ledger entry is written, no payment is
 * recorded. They reuse the sales/saleItems tables (boxItemId stays unset)
 * purely so printing, sharing and listing can reuse the same code as a
 * real invoice.
 */
export const createEstimate = mutation({
  args: {
    documentType: v.union(v.literal("quotation"), v.literal("proforma_invoice")),
    customerId: v.id("customers"),
    isGst: v.boolean(),
    items: v.array(estimateLineValidator),
    discountMode: v.union(v.literal("percent"), v.literal("fixed"), v.literal("none")),
    discountValue: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);

    if (args.items.length === 0) throw new Error("At least one item is required");

    const existing = await ctx.db
      .query("sales")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { saleId: existing._id, duplicate: true };

    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.organizationId !== auth.organizationId) throw new Error("Customer not found");

    const taxConfigs = new Map<Id<"taxConfigurations">, number>();
    const computedLines: Array<{ item: (typeof args.items)[number]; computed: ReturnType<typeof computeSaleLine> }> = [];
    for (const item of args.items) {
      if (item.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
      if (item.stoneWeightMg < 0 || item.stoneWeightMg > item.grossWeightMg) {
        throw new Error("Stone weight must be between 0 and gross weight");
      }
      if (item.ratePerGramPaise <= 0) throw new Error("Rate per gram must be greater than zero");

      let gstBasisPoints = 0;
      if (args.isGst && item.taxConfigurationId) {
        if (!taxConfigs.has(item.taxConfigurationId)) {
          const config = await ctx.db.get(item.taxConfigurationId);
          if (!config || config.organizationId !== auth.organizationId) throw new Error("Tax configuration not found");
          taxConfigs.set(item.taxConfigurationId, config.cgstBasisPoints + config.sgstBasisPoints + config.igstBasisPoints);
        }
        gstBasisPoints = taxConfigs.get(item.taxConfigurationId)!;
      }

      const computed = computeSaleLine({
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
        otherDeductionMg: 0,
        ratePerGramPaise: item.ratePerGramPaise,
        wastageBasisPoints: item.wastageBasisPoints,
        makingChargePaise: item.makingChargePaise,
        stoneChargePaise: item.stoneChargePaise,
        gstBasisPoints,
      });
      computedLines.push({ item, computed });
    }

    const itemsSubtotalPaise = computedLines.reduce((sum, l) => sum + l.computed.taxableValuePaise, 0);
    const itemsTaxPaise = computedLines.reduce((sum, l) => sum + l.computed.lineTaxPaise, 0);

    let discountPaise = 0;
    if (args.discountMode === "percent") {
      discountPaise = basisPointsOf(itemsSubtotalPaise, args.discountValue);
    } else if (args.discountMode === "fixed") {
      discountPaise = Math.max(0, args.discountValue);
    }
    discountPaise = Math.min(discountPaise, itemsSubtotalPaise);

    const preRoundTotal = itemsSubtotalPaise - discountPaise + itemsTaxPaise;
    const { roundedTotalPaise, roundOffPaise } = roundOffToRupee(preRoundTotal);

    const branchId = await resolveBranchId(ctx, auth.organizationId, auth.branchId);
    const invoiceNumber = await allocateInvoiceNumber(
      ctx,
      auth.organizationId,
      branchId,
      args.documentType,
      ESTIMATE_PREFIX[args.documentType],
    );
    const now = Date.now();

    const saleId = await ctx.db.insert("sales", {
      organizationId: auth.organizationId,
      branchId,
      customerId: args.customerId,
      documentType: args.documentType,
      invoiceNumber,
      status: "finalized",
      isGst: args.isGst,
      subtotalPaise: itemsSubtotalPaise,
      discountPaise,
      taxPaise: itemsTaxPaise,
      roundOffPaise,
      totalPaise: roundedTotalPaise,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    for (const { item, computed } of computedLines) {
      await ctx.db.insert("saleItems", {
        organizationId: auth.organizationId,
        saleId,
        productId: item.productId,
        metalPurityId: item.metalPurityId,
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
        otherDeductionMg: 0,
        netWeightMg: computed.netWeightMg,
        ratePerGramPaise: item.ratePerGramPaise,
        wastageBasisPoints: item.wastageBasisPoints,
        makingChargePaise: item.makingChargePaise,
        stoneChargePaise: item.stoneChargePaise,
        taxConfigurationId: item.taxConfigurationId,
        lineTaxPaise: computed.lineTaxPaise,
        lineTotalPaise: computed.lineTotalPaise,
      });
    }

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: `${args.documentType}.create`,
      entityTable: "sales",
      entityId: saleId,
      metadata: { invoiceNumber, totalPaise: roundedTotalPaise, itemCount: args.items.length },
      createdAt: now,
    });

    return { saleId, duplicate: false };
  },
});

const RETURN_PREFIX: Record<string, string> = {
  sales_return: "SR-",
  credit_note: "CN-",
};

/**
 * Reverses a sold item: puts the physical box item back in stock and
 * credits the customer's ledger for the returned line's original value.
 * Eligibility is tracked implicitly through boxItem.status — once an item
 * is returned it flips back to "in_stock", which is exactly the state
 * listReturnableItems excludes, so the same line can't be returned twice.
 */
export const createReturn = mutation({
  args: {
    documentType: v.union(v.literal("sales_return"), v.literal("credit_note")),
    originalSaleId: v.id("sales"),
    saleItemIds: v.array(v.id("saleItems")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);

    if (args.saleItemIds.length === 0) throw new Error("Select at least one item to return");

    const existing = await ctx.db
      .query("sales")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { saleId: existing._id, duplicate: true };

    const originalSale = await ctx.db.get(args.originalSaleId);
    if (!originalSale || originalSale.organizationId !== auth.organizationId) {
      throw new Error("Original invoice not found");
    }
    const customer = await ctx.db.get(originalSale.customerId);
    if (!customer) throw new Error("Customer not found");

    const lines: Array<{ saleItem: Doc<"saleItems">; boxItem: Doc<"boxItems"> }> = [];
    for (const saleItemId of args.saleItemIds) {
      const saleItem = await ctx.db.get(saleItemId);
      if (!saleItem || saleItem.saleId !== args.originalSaleId) throw new Error("Return item not found on this invoice");
      if (!saleItem.boxItemId) throw new Error("This line has no physical item to return");
      const boxItem = await ctx.db.get(saleItem.boxItemId);
      if (!boxItem) throw new Error("Original item not found");
      if (boxItem.status !== "sold") throw new Error(`"${boxItem.label}" has already been returned or is not sold`);
      lines.push({ saleItem, boxItem });
    }

    const returnValuePaise = lines.reduce((sum, l) => sum + l.saleItem.lineTotalPaise, 0);

    const branchId = await resolveBranchId(ctx, auth.organizationId, originalSale.branchId);
    const invoiceNumber = await allocateInvoiceNumber(
      ctx,
      auth.organizationId,
      branchId,
      args.documentType,
      RETURN_PREFIX[args.documentType],
    );
    const now = Date.now();

    const returnId = await ctx.db.insert("sales", {
      organizationId: auth.organizationId,
      branchId,
      customerId: originalSale.customerId,
      documentType: args.documentType,
      invoiceNumber,
      status: "finalized",
      isGst: originalSale.isGst,
      subtotalPaise: returnValuePaise,
      discountPaise: 0,
      taxPaise: 0,
      roundOffPaise: 0,
      totalPaise: returnValuePaise,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    const boxDeltas = new Map<Id<"boxes">, number>();
    for (const { saleItem, boxItem } of lines) {
      await ctx.db.insert("saleItems", {
        organizationId: auth.organizationId,
        saleId: returnId,
        productId: saleItem.productId,
        boxItemId: saleItem.boxItemId,
        metalPurityId: saleItem.metalPurityId,
        grossWeightMg: saleItem.grossWeightMg,
        stoneWeightMg: saleItem.stoneWeightMg,
        otherDeductionMg: saleItem.otherDeductionMg,
        netWeightMg: saleItem.netWeightMg,
        ratePerGramPaise: saleItem.ratePerGramPaise,
        wastageBasisPoints: saleItem.wastageBasisPoints,
        makingChargePaise: saleItem.makingChargePaise,
        stoneChargePaise: saleItem.stoneChargePaise,
        taxConfigurationId: saleItem.taxConfigurationId,
        lineTaxPaise: saleItem.lineTaxPaise,
        lineTotalPaise: saleItem.lineTotalPaise,
      });

      await ctx.db.patch(boxItem._id, { status: "in_stock" });
      boxDeltas.set(boxItem.boxId, (boxDeltas.get(boxItem.boxId) ?? 0) + 1);

      await ctx.db.insert("stockMovements", {
        organizationId: auth.organizationId,
        productId: boxItem.productId,
        boxItemId: boxItem._id,
        direction: "in",
        netWeightMg: saleItem.netWeightMg,
        quantity: 1,
        sourceTable: "sales",
        sourceId: returnId,
        createdAt: now,
      });
    }

    for (const [boxId, delta] of boxDeltas) {
      const box = await ctx.db.get(boxId);
      if (box) await ctx.db.patch(boxId, { itemCount: (box.itemCount ?? 0) + delta });
    }

    const priorBalance = customer.currentBalancePaise ?? customer.openingBalancePaise;
    const newBalance = priorBalance - returnValuePaise;

    await ctx.db.insert("customerLedgerEntries", {
      organizationId: auth.organizationId,
      customerId: originalSale.customerId,
      sourceTable: "sales",
      sourceId: returnId,
      debitPaise: 0,
      creditPaise: returnValuePaise,
      balancePaise: newBalance,
      createdAt: now,
    });
    await ctx.db.patch(originalSale.customerId, { currentBalancePaise: newBalance });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: `${args.documentType}.create`,
      entityTable: "sales",
      entityId: returnId,
      metadata: { invoiceNumber, totalPaise: returnValuePaise, originalSaleId: args.originalSaleId },
      createdAt: now,
    });

    return { saleId: returnId, duplicate: false };
  },
});
