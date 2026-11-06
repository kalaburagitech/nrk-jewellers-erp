import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { allocateInvoiceNumber, resolveBranchId } from "./lib/sequences";
import { computePurchaseLine } from "../src/lib/jewelry-calc";
import type { Id } from "./_generated/dataModel";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("purchases")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .take(200);
  },
});

export const getItems = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
      .collect();
  },
});

export const listBySupplier = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("purchases")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .order("desc")
      .collect();
  },
});

const purchaseLineValidator = v.object({
  productId: v.id("products"),
  boxId: v.id("boxes"),
  label: v.string(),
  metalPurityId: v.optional(v.id("metalPurities")),
  grossWeightMg: v.number(),
  stoneWeightMg: v.number(),
  ratePerGramPaise: v.number(),
  makingChargePaise: v.number(),
  stoneChargePaise: v.number(),
});

export const create = mutation({
  args: {
    supplierId: v.id("suppliers"),
    items: v.array(purchaseLineValidator),
    taxPaise: v.number(),
    amountPaidPaise: v.number(),
    paymentMode: v.optional(
      v.union(v.literal("cash"), v.literal("upi"), v.literal("card"), v.literal("cheque"), v.literal("bank_transfer")),
    ),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["purchase_manager"]);

    if (args.items.length === 0) throw new Error("At least one item is required");

    const existing = await ctx.db
      .query("purchases")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { purchaseId: existing._id, duplicate: true };

    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.organizationId !== auth.organizationId) throw new Error("Supplier not found");

    const boxes = new Map<Id<"boxes">, { itemCount?: number }>();
    for (const item of args.items) {
      if (item.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
      if (item.stoneWeightMg < 0 || item.stoneWeightMg > item.grossWeightMg) {
        throw new Error("Stone weight must be between 0 and gross weight");
      }
      if (item.ratePerGramPaise <= 0) throw new Error("Rate per gram must be greater than zero");
      const box = await ctx.db.get(item.boxId);
      if (!box || box.organizationId !== auth.organizationId) throw new Error("Box not found");
      boxes.set(item.boxId, box);
      const product = await ctx.db.get(item.productId);
      if (!product || product.organizationId !== auth.organizationId) throw new Error("Product not found");
    }

    const computedLines = args.items.map((item) => ({ item, computed: computePurchaseLine(item) }));
    const subtotalPaise = computedLines.reduce((sum, l) => sum + l.computed.lineTotalPaise, 0);
    const totalPaise = subtotalPaise + args.taxPaise;

    if (args.amountPaidPaise < 0 || args.amountPaidPaise > totalPaise) {
      throw new Error("Amount paid must be between 0 and the invoice total");
    }
    if (args.amountPaidPaise > 0 && !args.paymentMode) {
      throw new Error("Payment mode is required when recording a payment");
    }

    const branchId = await resolveBranchId(ctx, auth.organizationId, auth.branchId);
    const invoiceNumber = await allocateInvoiceNumber(ctx, auth.organizationId, branchId, "purchase_invoice", "PINV-");
    const now = Date.now();

    const purchaseId = await ctx.db.insert("purchases", {
      organizationId: auth.organizationId,
      branchId,
      supplierId: args.supplierId,
      invoiceNumber,
      status: "finalized",
      subtotalPaise,
      taxPaise: args.taxPaise,
      totalPaise,
      amountPaidPaise: args.amountPaidPaise,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    const boxItemDeltas = new Map<Id<"boxes">, number>();
    for (const { item, computed } of computedLines) {
      boxItemDeltas.set(item.boxId, (boxItemDeltas.get(item.boxId) ?? 0) + 1);
      const boxItemId = await ctx.db.insert("boxItems", {
        organizationId: auth.organizationId,
        boxId: item.boxId,
        productId: item.productId,
        label: item.label,
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
        netWeightMg: computed.netWeightMg,
        status: "in_stock",
        createdAt: now,
      });

      await ctx.db.insert("purchaseItems", {
        organizationId: auth.organizationId,
        purchaseId,
        productId: item.productId,
        boxId: item.boxId,
        boxItemId,
        metalPurityId: item.metalPurityId,
        label: item.label,
        grossWeightMg: item.grossWeightMg,
        stoneWeightMg: item.stoneWeightMg,
        netWeightMg: computed.netWeightMg,
        ratePerGramPaise: item.ratePerGramPaise,
        makingChargePaise: item.makingChargePaise,
        stoneChargePaise: item.stoneChargePaise,
        lineTotalPaise: computed.lineTotalPaise,
      });

      await ctx.db.insert("stockMovements", {
        organizationId: auth.organizationId,
        productId: item.productId,
        boxItemId,
        direction: "in",
        netWeightMg: computed.netWeightMg,
        quantity: 1,
        sourceTable: "purchases",
        sourceId: purchaseId,
        createdAt: now,
      });
    }

    for (const [boxId, delta] of boxItemDeltas) {
      const box = boxes.get(boxId);
      await ctx.db.patch(boxId, { itemCount: (box?.itemCount ?? 0) + delta });
    }

    const lastLedgerEntry = await ctx.db
      .query("supplierLedgerEntries")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .order("desc")
      .first();
    const priorBalance = lastLedgerEntry?.balancePaise ?? supplier.openingBalancePaise;
    const newBalance = priorBalance + totalPaise - args.amountPaidPaise;

    await ctx.db.insert("supplierLedgerEntries", {
      organizationId: auth.organizationId,
      supplierId: args.supplierId,
      sourceTable: "purchases",
      sourceId: purchaseId,
      debitPaise: args.amountPaidPaise,
      creditPaise: totalPaise,
      balancePaise: newBalance,
      createdAt: now,
    });

    if (args.amountPaidPaise > 0 && args.paymentMode) {
      await ctx.db.insert("payments", {
        organizationId: auth.organizationId,
        direction: "payment",
        partyType: "supplier",
        partyId: args.supplierId,
        sourceTable: "purchases",
        sourceId: purchaseId,
        mode: args.paymentMode,
        amountPaise: args.amountPaidPaise,
        createdByUserId: auth.userId,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase.create",
      entityTable: "purchases",
      entityId: purchaseId,
      metadata: { invoiceNumber, totalPaise, itemCount: args.items.length },
      createdAt: now,
    });

    return { purchaseId, duplicate: false };
  },
});
