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
