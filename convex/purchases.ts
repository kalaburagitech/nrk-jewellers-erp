import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAuthContext, requireRole, type AuthContext } from "./lib/auth";
import { allocateInvoiceNumber, resolveBranchId } from "./lib/sequences";
import { computePurchaseLine, basisPointsOf } from "../src/lib/jewelry-calc";
import type { Doc, Id } from "./_generated/dataModel";
import { changeItemStock, isGstCompany } from "./lib/itemStock";
import { assertBoxMetal, changeBoxStock, ensureBoxEntry, entryForStockBack, getCompanyBox, type Metal } from "./lib/boxStock";
import { assertBookingYearOpen } from "./lib/accountingYears";

/** Purchase invoices only — purchase orders and purchase returns each have their own dedicated list page/query. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const rows = await ctx.db
      .query("purchases")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const purchases = rows.filter((r) => (r.documentType ?? "purchase_invoice") === "purchase_invoice");
    const [items, products, payments] = await Promise.all([
      ctx.db.query("purchaseItems").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("payments").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
    ]);
    const productById = new Map(products.map((product) => [String(product._id), product]));
    return purchases.map((purchase) => {
      const purchaseItems = items.filter((item) => item.purchaseId === purchase._id);
      const billPayments = payments.filter((payment) => payment.sourceTable === "purchases" && payment.sourceId === purchase._id);
      const modes = [...new Set(billPayments.map((payment) => payment.mode.replaceAll("_", " ")))];
      const breakup = new Map<string, number>();
      for (const payment of billPayments) breakup.set(payment.mode, (breakup.get(payment.mode) ?? 0) + payment.amountPaise);
      const descriptions = purchaseItems.map((item) => productById.get(String(item.productId))?.description?.trim() || productById.get(String(item.productId))?.customFields?.description?.trim())
        .filter((value): value is string => Boolean(value));
      return {
        ...purchase,
        reportItemDetails: purchaseItems.map((item) => `${item.label} · ${(item.netWeightMg / 1000).toFixed(3)} g`).join("; ") || "—",
        reportDescription: [...new Set(descriptions)].join("; ") || "—",
        reportPaymentType: modes.join(", ") || "—",
        reportPaymentBreakup: [...breakup.entries()].map(([mode, amount]) => `${mode.replaceAll("_", " ")}: ₹${(amount / 100).toFixed(2)}`).join("; ") || "—",
      };
    });
  },
});

export const generateBillImageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["purchase_manager"]);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getItems = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

/** Purchase bill print payload. Every record is checked against the active company. */
export const getPrintData = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId || purchase.status !== "finalized") {
      throw new Error("Purchase bill not found in this company.");
    }
    const [items, supplier, organization, payment] = await Promise.all([
      ctx.db.query("purchaseItems").withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.get(purchase.supplierId),
      ctx.db.get(auth.organizationId),
      ctx.db.query("payments").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.and(q.eq(q.field("sourceTable"), "purchases"), q.eq(q.field("sourceId"), args.purchaseId)))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).first(),
    ]);
    const logoUrl = organization?.invoiceLogoStorageId ? await ctx.storage.getUrl(organization.invoiceLogoStorageId) : null;
    return { purchase, items, supplier, organization, payment, logoUrl };
  },
});

/** The purchase, its items and its payment (if any) in one query — what the edit form needs to prefill. */
export const getForEdit = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    const items = await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.and(q.eq(q.field("sourceTable"), "purchases"), q.eq(q.field("sourceId"), args.purchaseId)))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const billImageUrl = purchase.billImageStorageId ? await ctx.storage.getUrl(purchase.billImageStorageId) : null;
    return { purchase, items, payment: payments[0] ?? null, payments, billImageUrl };
  },
});

export const listByDocumentType = query({
  args: { documentType: v.union(v.literal("purchase_order"), v.literal("purchase_return")) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const filtered = await ctx.db
      .query("purchases")
      .withIndex("by_org_and_type", (q) => q.eq("organizationId", auth.organizationId).eq("documentType", args.documentType))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(200);
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
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
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    const items = await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", args.purchaseId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const withBoxItem = await Promise.all(
      items.map(async (item) => ({ item, boxItem: item.boxItemId ? await ctx.db.get(item.boxItemId) : null })),
    );
    return withBoxItem
      // Older piece lines: the piece must still be in stock. Box-stock and GST lines: not already returned.
      .filter(({ item, boxItem }) => (item.boxItemId ? boxItem?.status === "in_stock" : !item.returnedAt))
      .map(({ item, boxItem }) => ({ ...item, label: boxItem?.label ?? item.label }));
  },
});

export const listBySupplier = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.deletedAt || supplier.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("purchases")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

// Each line's gross weight and pieces go into its box (both company types). A GST
// company line without a box adds them to loose item stock (productStock).
const purchaseLineValidator = v.object({
  productId: v.id("products"),
  boxId: v.optional(v.id("boxes")),
  pieces: v.optional(v.number()),
  metal: v.optional(v.union(v.literal("gold"), v.literal("silver"))),
  label: v.string(),
  metalPurityId: v.optional(v.id("metalPurities")),
  grossWeightMg: v.number(),
  stoneWeightMg: v.number(),
  ratePerGramPaise: v.number(),
  makingChargePaise: v.number(),
  stoneChargePaise: v.number(),
  lineDiscountPaise: v.optional(v.number()),
  // Fixed purchase price per piece (item master). Omitted/0 → net weight × rate per gram.
  unitPricePaise: v.optional(v.number()),
});

type PurchaseTransactionArgs = {
  supplierId: Id<"suppliers">;
  items: Array<{
    productId: Id<"products">;
    boxId?: Id<"boxes">;
    pieces?: number;
    metal?: Metal;
    label: string;
    metalPurityId?: Id<"metalPurities">;
    grossWeightMg: number;
    stoneWeightMg: number;
    ratePerGramPaise: number;
    makingChargePaise: number;
    stoneChargePaise: number;
    lineDiscountPaise?: number;
    unitPricePaise?: number;
  }>;
  gstBasisPoints: number;
  amountPaidPaise: number;
  paymentMode?: PaymentMode;
  /** Split payment (Vyapar "Add Payment type"). When given, it replaces amountPaidPaise + paymentMode. */
  payments?: { mode: PaymentMode; amountPaise: number }[];
  roundOff?: boolean;
  supplierBillNumber?: string;
  stateOfSupply?: string;
  notes?: string;
  billImageStorageId?: Id<"_storage">;
};
type PaymentMode = "cash" | "upi" | "card" | "cheque" | "bank_transfer";
const purchasePaymentMode = v.union(v.literal("cash"), v.literal("upi"), v.literal("card"), v.literal("cheque"), v.literal("bank_transfer"));

/**
 * Validates, computes and writes every effect of a purchase invoice (new
 * box items, stock, supplier ledger, payment) onto an already-existing
 * `purchases` row. Shared by `create` (row just inserted, blank) and
 * `update` (row's prior effects already reversed).
 */
async function applyPurchaseTransaction(
  ctx: MutationCtx,
  auth: AuthContext,
  purchaseId: Id<"purchases">,
  args: PurchaseTransactionArgs,
  billDate: number,
) {
  if (args.items.length === 0) throw new Error("At least one item is required");

  const supplier = await ctx.db.get(args.supplierId);
  if (!supplier || supplier.deletedAt || supplier.organizationId !== auth.organizationId) throw new Error("Supplier not found");

  const gstCompany = await isGstCompany(ctx, auth.organizationId);
  const metals: Array<Metal | undefined> = [];
  for (const item of args.items) {
    if (item.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
    if (item.stoneWeightMg < 0 || item.stoneWeightMg > item.grossWeightMg) {
      throw new Error("Stone weight must be between 0 and gross weight");
    }
    const unitPricePaise = item.unitPricePaise ?? 0;
    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) throw new Error("Purchase price must be a valid amount of zero or more");
    if (unitPricePaise === 0 && item.ratePerGramPaise <= 0) throw new Error("Enter the purchase price or the rate per gram for every item");
    if (gstCompany && !item.boxId && item.pieces !== undefined && (!Number.isSafeInteger(item.pieces) || item.pieces < 1)) throw new Error("Pieces must be 1 or more");
    if (item.pieces !== undefined && (!Number.isSafeInteger(item.pieces) || item.pieces < 0)) throw new Error("Pieces must be 0 or more");
    const product = await ctx.db.get(item.productId);
    if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Product not found");
    let metal = item.metal;
    if (item.metalPurityId) {
      const purity = await ctx.db.get(item.metalPurityId);
      if (!purity || purity.deletedAt || purity.organizationId !== auth.organizationId) throw new Error("Metal purity not found");
      if (metal && purity.metal !== metal) throw new Error(`Purity ${purity.label} is ${purity.metal}, but "${item.label}" is marked ${metal}.`);
      metal ??= purity.metal;
    }
    // Both company types receive into boxes; only a GST company may keep a line as loose item stock.
    if (!gstCompany && !item.boxId) throw new Error("Choose a box for every purchased item.");
    if (item.boxId) {
      const box = await getCompanyBox(ctx, auth.organizationId, item.boxId);
      // Strict routing: gold only into gold boxes, silver only into silver boxes.
      assertBoxMetal(box, metal);
      metal ??= box.metal;
    }
    metals.push(metal);
  }

  if (args.gstBasisPoints < 0 || args.gstBasisPoints > 10000) {
    throw new Error("GST % must be between 0 and 100");
  }

  for (const item of args.items) {
    if (item.lineDiscountPaise !== undefined && (!Number.isSafeInteger(item.lineDiscountPaise) || item.lineDiscountPaise < 0)) throw new Error("Line discount must be a valid amount of zero or more");
  }
  // A fixed purchase price is per piece, so it is multiplied by the line's pieces.
  const computedLines = args.items.map((item) => ({ item, computed: computePurchaseLine({ ...item, pieces: item.pieces ?? 1 }) }));
  const subtotalPaise = computedLines.reduce((sum, l) => sum + l.computed.lineTotalPaise, 0);
  const taxPaise = basisPointsOf(subtotalPaise, args.gstBasisPoints);
  const unrounded = subtotalPaise + taxPaise;
  // Round off to the nearest rupee, like the bill's printed total.
  const roundOffPaise = args.roundOff ? Math.round(unrounded / 100) * 100 - unrounded : 0;
  const totalPaise = unrounded + roundOffPaise;

  const payments = (args.payments ?? (args.amountPaidPaise > 0 && args.paymentMode ? [{ mode: args.paymentMode, amountPaise: args.amountPaidPaise }] : []))
    .filter((p) => p.amountPaise !== 0);
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amountPaise) || p.amountPaise < 0) throw new Error("Each payment must be a valid amount greater than zero");
  }
  const amountPaidPaise = args.payments ? payments.reduce((a, p) => a + p.amountPaise, 0) : args.amountPaidPaise;
  if (amountPaidPaise < 0 || amountPaidPaise > totalPaise) {
    throw new Error("Amount paid must be between 0 and the invoice total");
  }
  if (!args.payments && args.amountPaidPaise > 0 && !args.paymentMode) {
    throw new Error("Payment mode is required when recording a payment");
  }
  if (args.billImageStorageId) {
    const meta = await ctx.db.system.get(args.billImageStorageId);
    if (!meta) throw new Error("Bill image upload not found — please upload it again");
  }

  await ctx.db.patch(purchaseId, {
    supplierId: args.supplierId,
    subtotalPaise,
    taxPaise,
    roundOffPaise,
    totalPaise,
    amountPaidPaise,
    supplierBillNumber: args.supplierBillNumber?.trim().slice(0, 40) || undefined,
    stateOfSupply: args.stateOfSupply?.trim() || undefined,
    notes: args.notes?.trim().slice(0, 1000) || undefined,
    billImageStorageId: args.billImageStorageId,
    createdAt: billDate,
  });

  for (const [index, { item, computed }] of computedLines.entries()) {
    const pieces = item.pieces ?? 1;
    const boxEntry = item.boxId
      ? await ensureBoxEntry(ctx, {
          organizationId: auth.organizationId,
          boxId: item.boxId,
          productId: item.productId,
          details: { metalPurityId: item.metalPurityId, purchasePricePaise: item.unitPricePaise || undefined },
        })
      : null;
    await ctx.db.insert("purchaseItems", {
      organizationId: auth.organizationId,
      purchaseId,
      productId: item.productId,
      ...(item.boxId ? { boxId: item.boxId } : { toItemStock: true }),
      metal: metals[index],
      metalPurityId: item.metalPurityId,
      label: item.label,
      grossWeightMg: item.grossWeightMg,
      stoneWeightMg: item.stoneWeightMg,
      netWeightMg: computed.netWeightMg,
      ratePerGramPaise: item.ratePerGramPaise,
      makingChargePaise: item.makingChargePaise,
      stoneChargePaise: item.stoneChargePaise,
      lineDiscountPaise: item.lineDiscountPaise || undefined,
      lineTotalPaise: computed.lineTotalPaise,
      unitPricePaise: item.unitPricePaise || undefined,
      pieces,
      // Stock is kept in gross weight, so a sale can take the whole piece back out.
      stockWeightMg: item.grossWeightMg,
      boxEntryId: boxEntry?._id,
      stockNetWeightMg: boxEntry ? computed.netWeightMg : undefined,
    });
    if (item.boxId) {
      await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: item.boxId, boxEntryId: boxEntry?._id, weightDeltaMg: item.grossWeightMg, netDeltaMg: computed.netWeightMg, piecesDelta: pieces, productId: item.productId, sourceTable: "purchases", sourceId: purchaseId, at: billDate });
    } else {
      await changeItemStock(ctx, { organizationId: auth.organizationId, productId: item.productId, weightDeltaMg: item.grossWeightMg, piecesDelta: pieces, sourceTable: "purchases", sourceId: purchaseId, at: billDate });
    }
  }

  const priorBalance = supplier.currentBalancePaise ?? supplier.openingBalancePaise;
  const newBalance = priorBalance + totalPaise - amountPaidPaise;

  await ctx.db.insert("supplierLedgerEntries", {
    organizationId: auth.organizationId,
    supplierId: args.supplierId,
    sourceTable: "purchases",
    sourceId: purchaseId,
    debitPaise: amountPaidPaise,
    creditPaise: totalPaise,
    balancePaise: newBalance,
    createdAt: billDate,
  });
  await ctx.db.patch(args.supplierId, { currentBalancePaise: newBalance });

  for (const payment of payments) {
    await ctx.db.insert("payments", {
      organizationId: auth.organizationId,
      direction: "payment",
      partyType: "supplier",
      partyId: args.supplierId,
      sourceTable: "purchases",
      sourceId: purchaseId,
      mode: payment.mode,
      amountPaise: payment.amountPaise,
      createdByUserId: auth.userId,
      createdAt: billDate,
    });
  }

  return { totalPaise, itemCount: args.items.length };
}

/**
 * Reverses every effect a prior applyPurchaseTransaction wrote: deletes the
 * box items it created (only safe because `update` refuses to run this
 * unless every one of them is still physically in stock — see `update`),
 * offsets the supplier ledger, and removes the old payment row.
 */
async function reversePurchaseTransaction(ctx: MutationCtx, auth: AuthContext, purchase: Doc<"purchases">, retainLines = false, allowNegative = false) {
  const purchaseItems = await ctx.db
    .query("purchaseItems")
    .withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

  for (const item of purchaseItems) {
    if (item.toItemStock) {
      // Throws if those grams were already sold — sell-side must be reversed first.
      await changeItemStock(ctx, { organizationId: auth.organizationId, productId: item.productId, weightDeltaMg: -(item.stockWeightMg ?? item.netWeightMg), piecesDelta: -(item.pieces ?? 1), sourceTable: "purchases", sourceId: purchase._id, at: Date.now(), allowNegative });
    } else if (item.boxItemId) {
      // Line saved before box stock was a running balance: its one piece leaves the box.
      const boxItem = await ctx.db.get(item.boxItemId);
      if (boxItem) await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: boxItem.boxId, weightDeltaMg: -boxItem.grossWeightMg, piecesDelta: -1, productId: item.productId, sourceTable: "purchases", sourceId: purchase._id, at: Date.now() });
      await ctx.db.patch(item.boxItemId, { deletedAt: Date.now(), status: "written_off" });
    } else if (item.boxId) {
      // Throws if the box no longer holds that weight (it was sold or moved) — reverse that first.
      await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: item.boxId, boxEntryId: item.boxEntryId, weightDeltaMg: -(item.stockWeightMg ?? item.grossWeightMg), netDeltaMg: item.stockNetWeightMg !== undefined ? -item.stockNetWeightMg : undefined, piecesDelta: -(item.pieces ?? 1), productId: item.productId, sourceTable: "purchases", sourceId: purchase._id, at: Date.now(), allowNegative });
    }
    if (!retainLines) await ctx.db.patch(item._id, { deletedAt: Date.now() });
  }

  const supplier = await ctx.db.get(purchase.supplierId);
  if (supplier) {
    const priorBalance = supplier.currentBalancePaise ?? supplier.openingBalancePaise;
    const revertedBalance = priorBalance - purchase.totalPaise + purchase.amountPaidPaise;
    await ctx.db.insert("supplierLedgerEntries", {
      organizationId: auth.organizationId,
      supplierId: purchase.supplierId,
      sourceTable: "purchases",
      sourceId: purchase._id,
      debitPaise: purchase.totalPaise,
      creditPaise: purchase.amountPaidPaise,
      balancePaise: revertedBalance,
      createdAt: Date.now(),
    });
    await ctx.db.patch(purchase.supplierId, { currentBalancePaise: revertedBalance });
  }

  const oldPayments = await ctx.db
    .query("payments")
    .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
    .filter((q) => q.and(q.eq(q.field("sourceTable"), "purchases"), q.eq(q.field("sourceId"), purchase._id)))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  for (const payment of oldPayments) await ctx.db.patch(payment._id, { deletedAt: Date.now() });
}

export const create = mutation({
  args: {
    supplierId: v.id("suppliers"),
    items: v.array(purchaseLineValidator),
    gstBasisPoints: v.number(),
    amountPaidPaise: v.number(),
    paymentMode: v.optional(
      v.union(v.literal("cash"), v.literal("upi"), v.literal("card"), v.literal("cheque"), v.literal("bank_transfer")),
    ),
    payments: v.optional(v.array(v.object({ mode: purchasePaymentMode, amountPaise: v.number() }))),
    roundOff: v.optional(v.boolean()),
    supplierBillNumber: v.optional(v.string()),
    stateOfSupply: v.optional(v.string()),
    notes: v.optional(v.string()),
    billImageStorageId: v.optional(v.id("_storage")),
    billDate: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["purchase_manager"]);

    const existing = await ctx.db
      .query("purchases")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existing) return { purchaseId: existing._id, duplicate: true };

    const branchId = await resolveBranchId(ctx, auth.organizationId, auth.branchId);
    const invoiceNumber = await allocateInvoiceNumber(ctx, auth.organizationId, branchId, "purchase_invoice", "PINV-");
    const billDate = args.billDate ?? Date.now();
    await assertBookingYearOpen(ctx, auth.organizationId, billDate);

    const purchaseId = await ctx.db.insert("purchases", {
      organizationId: auth.organizationId,
      branchId,
      supplierId: args.supplierId,
      invoiceNumber,
      documentType: "purchase_invoice",
      status: "finalized",
      subtotalPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: billDate,
    });

    const result = await applyPurchaseTransaction(ctx, auth, purchaseId, args, billDate);

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase.create",
      entityTable: "purchases",
      entityId: purchaseId,
      metadata: { invoiceNumber, totalPaise: result.totalPaise, itemCount: result.itemCount },
      createdAt: Date.now(),
    });

    return { purchaseId, duplicate: false };
  },
});

/**
 * Owner/Admin only: edits an already-finalized purchase invoice. Refuses to
 * run if any item it received has already left stock (sold/transferred/
 * written off) — deleting and recreating that box item would silently
 * orphan whatever later transaction referenced it.
 */
export const update = mutation({
  args: {
    purchaseId: v.id("purchases"),
    supplierId: v.id("suppliers"),
    items: v.array(purchaseLineValidator),
    gstBasisPoints: v.number(),
    amountPaidPaise: v.number(),
    paymentMode: v.optional(
      v.union(v.literal("cash"), v.literal("upi"), v.literal("card"), v.literal("cheque"), v.literal("bank_transfer")),
    ),
    payments: v.optional(v.array(v.object({ mode: purchasePaymentMode, amountPaise: v.number() }))),
    roundOff: v.optional(v.boolean()),
    supplierBillNumber: v.optional(v.string()),
    stateOfSupply: v.optional(v.string()),
    notes: v.optional(v.string()),
    billImageStorageId: v.optional(v.id("_storage")),
    billDate: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);

    const purchase = await ctx.db.get(args.purchaseId);
    await assertBookingYearOpen(ctx, auth.organizationId, args.billDate);
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    if ((purchase.documentType ?? "purchase_invoice") !== "purchase_invoice") {
      throw new Error("Only a finalized purchase invoice can be edited");
    }
    if (purchase.status !== "finalized") throw new Error("Cannot edit a cancelled invoice");

    const existingItems = await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    for (const item of existingItems) {
      if (item.returnedAt) throw new Error(`"${item.label}" was returned to the supplier — cancel that return before editing this invoice`);
      if (!item.boxItemId) continue;
      const boxItem = await ctx.db.get(item.boxItemId);
      if (boxItem && boxItem.status !== "in_stock") {
        throw new Error(`"${boxItem.label}" has already left stock — this invoice can no longer be edited`);
      }
    }

    // Edit = net change per box: the reversal may dip below zero for a moment
    // (stock partly sold since), as long as the edited bill leaves every box
    // and item at zero or more. Any failure rolls the whole edit back.
    const stockOf = async (item: Doc<"purchaseItems">) => {
      if (item.boxId && !item.boxItemId) {
        const box = await ctx.db.get(item.boxId);
        return box ? { name: `Box ${box.boxNumber}`, weightMg: box.weightMg ?? 0, pieces: box.pieces ?? 0 } : null;
      }
      if (!item.toItemStock) return null;
      const row = await ctx.db.query("productStock").withIndex("by_org_and_product", (q) => q.eq("organizationId", auth.organizationId).eq("productId", item.productId)).first();
      return row ? { name: `"${item.label}"`, weightMg: row.weightMg, pieces: row.pieces } : null;
    };
    const before = await Promise.all(existingItems.map(stockOf));
    await reversePurchaseTransaction(ctx, auth, purchase, false, true);
    const result = await applyPurchaseTransaction(ctx, auth, args.purchaseId, args, args.billDate);
    for (const [index, item] of existingItems.entries()) {
      const after = await stockOf(item);
      const was = before[index];
      if (after && ((after.weightMg < 0 && after.weightMg < (was?.weightMg ?? 0)) || (after.pieces < 0 && after.pieces < (was?.pieces ?? 0)))) {
        throw new Error(`${after.name} has already sold part of this purchase — the edited bill would leave its stock below zero.`);
      }
    }

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase.update",
      entityTable: "purchases",
      entityId: args.purchaseId,
      metadata: { invoiceNumber: purchase.invoiceNumber, totalPaise: result.totalPaise, itemCount: result.itemCount },
      createdAt: Date.now(),
    });

    return { purchaseId: args.purchaseId };
  },
});

/**
 * Owner/Admin only: deletes a purchase (stock) bill — reverses its stock,
 * ledger and payment effects (same reversal `update` uses) and marks it
 * cancelled rather than removing the row, so the invoice number and audit
 * trail survive. Refuses if any received item has already left stock.
 */
export const cancel = mutation({
  args: { purchaseId: v.id("purchases"), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);

    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required to delete a purchase bill");

    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId) throw new Error("Not found");
    if (purchase.status !== "finalized") throw new Error("This bill is already cancelled");

    if (purchase.documentType === "purchase_order") {
      await ctx.db.patch(purchase._id, { status: "cancelled", deletedAt: Date.now(), cancelledAt: Date.now(), cancelReason: reason });
      await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: "purchase_order.soft_delete", entityTable: "purchases", entityId: purchase._id, metadata: { reason }, createdAt: Date.now() });
      return;
    }
    if (purchase.documentType === "purchase_return") {
      const items = await ctx.db.query("purchaseItems").withIndex("by_purchase", q => q.eq("purchaseId", purchase._id)).filter(q => q.eq(q.field("deletedAt"), undefined)).collect();
      for (const item of items) if (item.toItemStock) {
        // GST line: put the returned weight back and mark the original line returnable again.
        await changeItemStock(ctx, { organizationId: auth.organizationId, productId: item.productId, weightDeltaMg: item.stockWeightMg ?? item.netWeightMg, piecesDelta: item.pieces ?? 1, sourceTable: "purchases", sourceId: purchase._id, at: Date.now() });
        if (item.returnOfPurchaseItemId) await ctx.db.patch(item.returnOfPurchaseItemId, { returnedAt: undefined });
      } else if (item.boxItemId) {
        const stock = await ctx.db.get(item.boxItemId);
        if (!stock || stock.deletedAt || stock.status !== "written_off") throw new Error("Returned stock has changed. Reverse the later transaction first.");
        await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: stock.boxId, weightDeltaMg: stock.grossWeightMg, piecesDelta: 1, productId: stock.productId, sourceTable: "purchases", sourceId: purchase._id, at: Date.now() });
        await ctx.db.patch(stock._id, { status: "in_stock" });
      } else if (item.boxId) {
        // Box line: the returned weight goes back into its box; the original line becomes returnable again.
        const boxEntryId = await entryForStockBack(ctx, { organizationId: auth.organizationId, boxId: item.boxId, productId: item.productId, boxEntryId: item.boxEntryId });
        await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: item.boxId, boxEntryId, weightDeltaMg: item.stockWeightMg ?? item.grossWeightMg, netDeltaMg: item.stockNetWeightMg, piecesDelta: item.pieces ?? 0, productId: item.productId, sourceTable: "purchases", sourceId: purchase._id, at: Date.now() });
        if (item.returnOfPurchaseItemId) await ctx.db.patch(item.returnOfPurchaseItemId, { returnedAt: undefined });
      }
      const supplier = await ctx.db.get(purchase.supplierId);
      if (!supplier) throw new Error("Supplier not found");
      const balancePaise = (supplier.currentBalancePaise ?? supplier.openingBalancePaise) + purchase.totalPaise;
      await ctx.db.insert("supplierLedgerEntries", { organizationId: auth.organizationId, supplierId: supplier._id, sourceTable: "purchases", sourceId: purchase._id, debitPaise: 0, creditPaise: purchase.totalPaise, balancePaise, createdAt: Date.now() });
      await ctx.db.patch(supplier._id, { currentBalancePaise: balancePaise });
      await ctx.db.patch(purchase._id, { status: "cancelled", deletedAt: Date.now(), cancelledAt: Date.now(), cancelReason: reason });
      await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: "purchase_return.soft_delete", entityTable: "purchases", entityId: purchase._id, metadata: { reason }, createdAt: Date.now() });
      return;
    }
    const purchaseItems = await ctx.db
      .query("purchaseItems")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    for (const item of purchaseItems) {
      if (item.returnedAt) throw new Error(`"${item.label}" was returned to the supplier — cancel that return before deleting this bill`);
      if (!item.boxItemId) continue;
      const boxItem = await ctx.db.get(item.boxItemId);
      if (boxItem && boxItem.status !== "in_stock") {
        throw new Error(`"${boxItem.label}" has already left stock — this bill can no longer be deleted`);
      }
    }

    await reversePurchaseTransaction(ctx, auth, purchase, true);
    await ctx.db.patch(args.purchaseId, { status: "cancelled", deletedAt: Date.now(), cancelledAt: Date.now(), cancelReason: reason });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase.cancel",
      entityTable: "purchases",
      entityId: args.purchaseId,
      metadata: { invoiceNumber: purchase.invoiceNumber, totalPaise: purchase.totalPaise, reason },
      createdAt: Date.now(),
    });
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existing) return { purchaseId: existing._id, duplicate: true };

    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.deletedAt || supplier.organizationId !== auth.organizationId) throw new Error("Supplier not found");

    for (const item of args.items) {
      if (item.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
      if (item.stoneWeightMg < 0 || item.stoneWeightMg > item.grossWeightMg) {
        throw new Error("Stone weight must be between 0 and gross weight");
      }
      if (item.ratePerGramPaise <= 0) throw new Error("Rate per gram must be greater than zero");
      const product = await ctx.db.get(item.productId);
      if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Product not found");
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

/** Purchase orders have no stock or ledger effects, so their lines can be replaced safely. */
export const updatePurchaseOrder = mutation({
  args: {
    purchaseId: v.id("purchases"),
    supplierId: v.id("suppliers"),
    items: v.array(orderLineValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["purchase_manager"]);
    if (args.items.length === 0) throw new Error("At least one item is required");

    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase || purchase.deletedAt || purchase.organizationId !== auth.organizationId) throw new Error("Purchase order not found");
    if (purchase.documentType !== "purchase_order" || purchase.status !== "finalized") throw new Error("Only an active purchase order can be edited");
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.deletedAt || supplier.organizationId !== auth.organizationId) throw new Error("Supplier not found");

    for (const item of args.items) {
      if (item.grossWeightMg <= 0) throw new Error("Gross weight must be greater than zero");
      if (item.stoneWeightMg < 0 || item.stoneWeightMg > item.grossWeightMg) throw new Error("Stone weight must be between 0 and gross weight");
      if (item.ratePerGramPaise <= 0) throw new Error("Rate per gram must be greater than zero");
      const product = await ctx.db.get(item.productId);
      if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Product not found");
    }

    const computedLines = args.items.map((item) => ({ item, computed: computePurchaseLine(item) }));
    const subtotalPaise = computedLines.reduce((sum, line) => sum + line.computed.lineTotalPaise, 0);
    const now = Date.now();
    const existingItems = await ctx.db.query("purchaseItems").withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id)).filter((q) => q.eq(q.field("deletedAt"), undefined)).collect();
    for (const item of existingItems) await ctx.db.patch(item._id, { deletedAt: now });

    for (const { item, computed } of computedLines) {
      await ctx.db.insert("purchaseItems", {
        organizationId: auth.organizationId,
        purchaseId: purchase._id,
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

    await ctx.db.patch(purchase._id, {
      supplierId: args.supplierId,
      subtotalPaise,
      taxPaise: 0,
      totalPaise: subtotalPaise,
    });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "purchase_order.update",
      entityTable: "purchases",
      entityId: purchase._id,
      metadata: { invoiceNumber: purchase.invoiceNumber, totalPaise: subtotalPaise, itemCount: computedLines.length },
      createdAt: now,
    });
    return { purchaseId: purchase._id };
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existing) return { purchaseId: existing._id, duplicate: true };

    const originalPurchase = await ctx.db.get(args.originalPurchaseId);
    if (!originalPurchase || originalPurchase.deletedAt || originalPurchase.organizationId !== auth.organizationId) {
      throw new Error("Original purchase not found");
    }
    const supplier = await ctx.db.get(originalPurchase.supplierId);
    if (!supplier) throw new Error("Supplier not found");

    const lines: Array<{ purchaseItem: Doc<"purchaseItems">; boxItem: Doc<"boxItems"> }> = [];
    const itemStockLines: Doc<"purchaseItems">[] = [];
    for (const purchaseItemId of args.purchaseItemIds) {
      const purchaseItem = await ctx.db.get(purchaseItemId);
      if (!purchaseItem || purchaseItem.deletedAt || purchaseItem.purchaseId !== args.originalPurchaseId) {
        throw new Error("Return item not found on this purchase");
      }
      if (!purchaseItem.boxItemId) {
        // GST line (item stock) or box-stock line: tracked by returnedAt.
        if (purchaseItem.returnedAt) throw new Error(`"${purchaseItem.label}" has already been returned`);
        itemStockLines.push(purchaseItem);
        continue;
      }
      if (!purchaseItem.boxItemId) throw new Error("This line has no physical item to return");
      const boxItem = await ctx.db.get(purchaseItem.boxItemId);
      if (!boxItem) throw new Error("Original item not found");
      if (boxItem.status !== "in_stock") throw new Error(`"${boxItem.label}" is not available to return`);
      lines.push({ purchaseItem, boxItem });
    }

    const returnValuePaise =
      lines.reduce((sum, l) => sum + l.purchaseItem.lineTotalPaise, 0) +
      itemStockLines.reduce((sum, item) => sum + item.lineTotalPaise, 0);

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

      await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: boxItem.boxId, weightDeltaMg: -boxItem.grossWeightMg, piecesDelta: -1, productId: boxItem.productId, sourceTable: "purchases", sourceId: returnId, at: now });
      await ctx.db.patch(boxItem._id, { status: "written_off" });
    }

    for (const purchaseItem of itemStockLines) {
      const stockWeightMg = purchaseItem.stockWeightMg ?? purchaseItem.netWeightMg;
      const pieces = purchaseItem.pieces ?? 1;
      // Throws if those grams were already sold — nothing to send back.
      if (purchaseItem.boxId) await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: purchaseItem.boxId, boxEntryId: purchaseItem.boxEntryId, weightDeltaMg: -stockWeightMg, netDeltaMg: purchaseItem.stockNetWeightMg !== undefined ? -purchaseItem.stockNetWeightMg : undefined, piecesDelta: -pieces, productId: purchaseItem.productId, sourceTable: "purchases", sourceId: returnId, at: now });
      else await changeItemStock(ctx, { organizationId: auth.organizationId, productId: purchaseItem.productId, weightDeltaMg: -stockWeightMg, piecesDelta: -pieces, sourceTable: "purchases", sourceId: returnId, at: now });
      await ctx.db.insert("purchaseItems", {
        organizationId: auth.organizationId,
        purchaseId: returnId,
        productId: purchaseItem.productId,
        metalPurityId: purchaseItem.metalPurityId,
        label: purchaseItem.label,
        grossWeightMg: purchaseItem.grossWeightMg,
        stoneWeightMg: purchaseItem.stoneWeightMg,
        netWeightMg: purchaseItem.netWeightMg,
        ratePerGramPaise: purchaseItem.ratePerGramPaise,
        makingChargePaise: purchaseItem.makingChargePaise,
        stoneChargePaise: purchaseItem.stoneChargePaise,
        lineTotalPaise: purchaseItem.lineTotalPaise,
        ...(purchaseItem.boxId ? { boxId: purchaseItem.boxId } : { toItemStock: true }),
        metal: purchaseItem.metal,
        pieces,
        stockWeightMg,
        boxEntryId: purchaseItem.boxEntryId,
        stockNetWeightMg: purchaseItem.stockNetWeightMg,
        returnOfPurchaseItemId: purchaseItem._id,
      });
      await ctx.db.patch(purchaseItem._id, { returnedAt: now });
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
