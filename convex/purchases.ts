import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { allocateInvoiceNumber, resolveBranchId } from "./lib/sequences";
import { computePurchaseLine } from "../src/lib/jewelry-calc";
import type { Doc, Id } from "./_generated/dataModel";

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

export const listByDocumentType = query({
  args: { documentType: v.union(v.literal("purchase_order"), v.literal("purchase_return")) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const rows = await ctx.db
      .query("purchases")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .take(200);
    const filtered = rows.filter((r) => r.documentType === args.documentType);
    const supplierIds = [...new Set(filtered.map((r) => r.supplierId))];
    const suppliers = await Promise.all(supplierIds.map((id) => ctx.db.get(id)));
    const nameById = new Map(supplierIds.map((id, i) => [id, suppliers[i]?.name ?? "—"]));
    return filtered.map((r) => ({ ...r, supplierName: nameById.get(r.supplierId) ?? "—" }));
  },
});

/** Finalized purchase invoices for a supplier, available as the source document for a return. */
export const listReturnableInvoices = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchases = await ctx.db
      .query("purchases")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .collect();
    return purchases.filter(
      (p) =>
        p.organizationId === auth.organizationId &&
        (p.documentType ?? "purchase_invoice") === "purchase_invoice" &&
        p.status === "finalized",
    );
  },
});

/** Purchased line items still "in_stock" — the only ones eligible to go back to the supplier. */
export const listReturnableItems = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    const items = await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
      .collect();
    const withBoxItem = await Promise.all(
      items.map(async (item) => ({ item, boxItem: item.boxItemId ? await ctx.db.get(item.boxItemId) : null })),
    );
    return withBoxItem
      .filter(({ boxItem }) => boxItem?.status === "in_stock")
      .map(({ item, boxItem }) => ({ ...item, label: boxItem?.label ?? item.label }));
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
      documentType: "purchase_invoice",
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

    const priorBalance = supplier.currentBalancePaise ?? supplier.openingBalancePaise;
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
    await ctx.db.patch(args.supplierId, { currentBalancePaise: newBalance });

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

const orderLineValidator = v.object({
  productId: v.id("products"),
  label: v.string(),
  metalPurityId: v.optional(v.id("metalPurities")),
  grossWeightMg: v.number(),
  stoneWeightMg: v.number(),
  ratePerGramPaise: v.number(),
  makingChargePaise: v.number(),
  stoneChargePaise: v.number(),
});

/**
 * A purchase order is a commitment to buy — no goods have arrived yet, so
 * unlike a purchase invoice it creates no box items, no stock movement, no
 * supplier ledger entry. Receiving the goods is still recorded as a normal
 * purchase invoice (no auto-conversion in this milestone).
 */
export const createPurchaseOrder = mutation({
  args: {
    supplierId: v.id("suppliers"),
    items: v.array(orderLineValidator),
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

    for (const item of args.items) {
      if (item.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
      if (item.stoneWeightMg < 0 || item.stoneWeightMg > item.grossWeightMg) {
        throw new Error("Stone weight must be between 0 and gross weight");
      }
      if (item.ratePerGramPaise <= 0) throw new Error("Rate per gram must be greater than zero");
      const product = await ctx.db.get(item.productId);
      if (!product || product.organizationId !== auth.organizationId) throw new Error("Product not found");
    }

    const computedLines = args.items.map((item) => ({ item, computed: computePurchaseLine(item) }));
    const subtotalPaise = computedLines.reduce((sum, l) => sum + l.computed.lineTotalPaise, 0);

    const branchId = await resolveBranchId(ctx, auth.organizationId, auth.branchId);
    const invoiceNumber = await allocateInvoiceNumber(ctx, auth.organizationId, branchId, "purchase_order", "PO-");
    const now = Date.now();

    const purchaseId = await ctx.db.insert("purchases", {
      organizationId: auth.organizationId,
      branchId,
      supplierId: args.supplierId,
      invoiceNumber,
      documentType: "purchase_order",
      status: "finalized",
      subtotalPaise,
      taxPaise: 0,
      totalPaise: subtotalPaise,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    for (const { item, computed } of computedLines) {
      await ctx.db.insert("purchaseItems", {
        organizationId: auth.organizationId,
        purchaseId,
        productId: item.productId,
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
    }

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase_order.create",
      entityTable: "purchases",
      entityId: purchaseId,
      metadata: { invoiceNumber, totalPaise: subtotalPaise, itemCount: args.items.length },
      createdAt: now,
    });

    return { purchaseId, duplicate: false };
  },
});

/**
 * Sends a received item back to the supplier: removes it from stock
 * (write-off — it has physically left the shop) and reduces what we owe
 * the supplier by the item's original purchase value. Eligibility is
 * tracked implicitly through boxItem.status, same pattern as sales returns.
 */
export const createPurchaseReturn = mutation({
  args: {
    originalPurchaseId: v.id("purchases"),
    purchaseItemIds: v.array(v.id("purchaseItems")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["purchase_manager"]);

    if (args.purchaseItemIds.length === 0) throw new Error("Select at least one item to return");

    const existing = await ctx.db
      .query("purchases")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { purchaseId: existing._id, duplicate: true };

    const originalPurchase = await ctx.db.get(args.originalPurchaseId);
    if (!originalPurchase || originalPurchase.organizationId !== auth.organizationId) {
      throw new Error("Original purchase not found");
    }
    const supplier = await ctx.db.get(originalPurchase.supplierId);
    if (!supplier) throw new Error("Supplier not found");

    const lines: Array<{ purchaseItem: Doc<"purchaseItems">; boxItem: Doc<"boxItems"> }> = [];
    for (const purchaseItemId of args.purchaseItemIds) {
      const purchaseItem = await ctx.db.get(purchaseItemId);
      if (!purchaseItem || purchaseItem.purchaseId !== args.originalPurchaseId) {
        throw new Error("Return item not found on this purchase");
      }
      if (!purchaseItem.boxItemId) throw new Error("This line has no physical item to return");
      const boxItem = await ctx.db.get(purchaseItem.boxItemId);
      if (!boxItem) throw new Error("Original item not found");
      if (boxItem.status !== "in_stock") throw new Error(`"${boxItem.label}" is not available to return`);
      lines.push({ purchaseItem, boxItem });
    }

    const returnValuePaise = lines.reduce((sum, l) => sum + l.purchaseItem.lineTotalPaise, 0);

    const branchId = await resolveBranchId(ctx, auth.organizationId, originalPurchase.branchId);
    const invoiceNumber = await allocateInvoiceNumber(ctx, auth.organizationId, branchId, "purchase_return", "PR-");
    const now = Date.now();

    const returnId = await ctx.db.insert("purchases", {
      organizationId: auth.organizationId,
      branchId,
      supplierId: originalPurchase.supplierId,
      invoiceNumber,
      documentType: "purchase_return",
      status: "finalized",
      subtotalPaise: returnValuePaise,
      taxPaise: 0,
      totalPaise: returnValuePaise,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    const boxDeltas = new Map<Id<"boxes">, number>();
    for (const { purchaseItem, boxItem } of lines) {
      await ctx.db.insert("purchaseItems", {
        organizationId: auth.organizationId,
        purchaseId: returnId,
        productId: purchaseItem.productId,
        boxItemId: purchaseItem.boxItemId,
        metalPurityId: purchaseItem.metalPurityId,
        label: purchaseItem.label,
        grossWeightMg: purchaseItem.grossWeightMg,
        stoneWeightMg: purchaseItem.stoneWeightMg,
        netWeightMg: purchaseItem.netWeightMg,
        ratePerGramPaise: purchaseItem.ratePerGramPaise,
        makingChargePaise: purchaseItem.makingChargePaise,
        stoneChargePaise: purchaseItem.stoneChargePaise,
        lineTotalPaise: purchaseItem.lineTotalPaise,
      });

      await ctx.db.patch(boxItem._id, { status: "written_off" });
      boxDeltas.set(boxItem.boxId, (boxDeltas.get(boxItem.boxId) ?? 0) + 1);

      await ctx.db.insert("stockMovements", {
        organizationId: auth.organizationId,
        productId: boxItem.productId,
        boxItemId: boxItem._id,
        direction: "out",
        netWeightMg: purchaseItem.netWeightMg,
        quantity: 1,
        sourceTable: "purchases",
        sourceId: returnId,
        createdAt: now,
      });
    }

    for (const [boxId, delta] of boxDeltas) {
      const box = await ctx.db.get(boxId);
      if (box) await ctx.db.patch(boxId, { itemCount: Math.max(0, (box.itemCount ?? 0) - delta) });
    }

    const priorBalance = supplier.currentBalancePaise ?? supplier.openingBalancePaise;
    const newBalance = priorBalance - returnValuePaise;

    await ctx.db.insert("supplierLedgerEntries", {
      organizationId: auth.organizationId,
      supplierId: originalPurchase.supplierId,
      sourceTable: "purchases",
      sourceId: returnId,
      debitPaise: returnValuePaise,
      creditPaise: 0,
      balancePaise: newBalance,
      createdAt: now,
    });
    await ctx.db.patch(originalPurchase.supplierId, { currentBalancePaise: newBalance });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase_return.create",
      entityTable: "purchases",
      entityId: returnId,
      metadata: { invoiceNumber, totalPaise: returnValuePaise, originalPurchaseId: args.originalPurchaseId },
      createdAt: now,
    });

    return { purchaseId: returnId, duplicate: false };
  },
});
