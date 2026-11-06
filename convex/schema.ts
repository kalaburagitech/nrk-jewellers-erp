import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Units convention (see docs/ARCHITECTURE.md):
 *  - Money: integer paise (never floats).
 *  - Weight: integer milligrams (0.001g precision).
 *  - Percentages/rates needing fractions (wastage %, GST %): integer basis points (1 bp = 0.01%).
 */

export const ROLES = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("billing_operator"),
  v.literal("inventory_manager"),
  v.literal("purchase_manager"),
  v.literal("accountant"),
);

export default defineSchema({
  ...authTables,

  // ---------- Org / Access ----------
  organizations: defineTable({
    name: v.string(),
    legalName: v.optional(v.string()),
    gstin: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    loginImageStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  }),

  branches: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    isDefault: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  // One row per (user, organization) membership. Role lives here, not on the
  // auth user, so a person can belong to multiple orgs in the future without
  // restructuring.
  memberships: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    branchId: v.optional(v.id("branches")),
    role: ROLES,
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"])
    .index("by_user_and_org", ["userId", "organizationId"]),

  auditLogs: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    action: v.string(),
    entityTable: v.string(),
    entityId: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_entity", ["entityTable", "entityId"]),

  applicationSettings: defineTable({
    organizationId: v.id("organizations"),
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index("by_org_and_key", ["organizationId", "key"]),

  // ---------- Parties ----------
  customers: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    gstin: v.optional(v.string()),
    customerType: v.union(v.literal("cash"), v.literal("regular"), v.literal("credit")),
    creditLimitPaise: v.optional(v.number()),
    openingBalancePaise: v.number(),
    // Maintained running balance (= latest customerLedgerEntries.balancePaise),
    // updated by every mutation that writes a ledger entry — avoids reading
    // the ledger per customer just to show an outstanding figure.
    currentBalancePaise: v.optional(v.number()),
    notes: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_phone", ["organizationId", "phone"]),

  suppliers: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    gstin: v.optional(v.string()),
    openingBalancePaise: v.number(),
    currentBalancePaise: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  // ---------- Catalog / Inventory config ----------
  stockGroups: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    parentId: v.optional(v.id("stockGroups")),
  }).index("by_org", ["organizationId"]),

  stockCategories: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
  }).index("by_org", ["organizationId"]),

  metalPurities: defineTable({
    organizationId: v.id("organizations"),
    metal: v.union(v.literal("gold"), v.literal("silver")),
    label: v.string(), // "22K", "24K", "18K", "Silver 925"
    purityBasisPoints: v.number(), // e.g. 22K = 9166 (91.66%)
    isActive: v.boolean(),
  }).index("by_org", ["organizationId"]),

  products: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    sku: v.optional(v.string()),
    stockGroupId: v.optional(v.id("stockGroups")),
    stockCategoryId: v.optional(v.id("stockCategories")),
    metalPurityId: v.optional(v.id("metalPurities")),
    unit: v.union(v.literal("gram"), v.literal("kilogram"), v.literal("piece"), v.literal("carat")),
    hsnCode: v.optional(v.string()),
    reorderLevelMg: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_sku", ["organizationId", "sku"]),

  // ---------- Box management ----------
  boxes: defineTable({
    organizationId: v.id("organizations"),
    boxNumber: v.number(), // 101-200 seeded, unlimited thereafter
    label: v.optional(v.string()),
    // Maintained counter of in_stock boxItems, updated by every mutation
    // that adds/removes an item — avoids an N+1 count query per box on the
    // overview grid.
    itemCount: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_number", ["organizationId", "boxNumber"]),

  // Current location of each physical item. One row per item; moving it
  // updates this row and writes a stockMovements record — an item can never
  // be in two boxes at once because this is the single source of truth.
  boxItems: defineTable({
    organizationId: v.id("organizations"),
    boxId: v.id("boxes"),
    productId: v.id("products"),
    label: v.string(),
    grossWeightMg: v.number(),
    stoneWeightMg: v.number(),
    netWeightMg: v.number(),
    barcode: v.optional(v.string()),
    status: v.union(v.literal("in_stock"), v.literal("sold"), v.literal("transferred_out"), v.literal("written_off")),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_box", ["boxId"])
    .index("by_org_and_barcode", ["organizationId", "barcode"]),

  // Append-only ledger of every stock change. Every mutation that changes
  // inventory writes one of these in the same transaction — nothing
  // overwrites a quantity without leaving this trail.
  stockMovements: defineTable({
    organizationId: v.id("organizations"),
    productId: v.id("products"),
    boxItemId: v.optional(v.id("boxItems")),
    direction: v.union(v.literal("in"), v.literal("out")),
    netWeightMg: v.number(),
    quantity: v.number(),
    sourceTable: v.string(), // "purchases" | "sales" | "stockAdjustments" | "boxTransfers" ...
    sourceId: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_product", ["productId"])
    .index("by_source", ["sourceTable", "sourceId"]),

  // ---------- Metal rates ----------
  // Append-only. "Current rate" = latest row for that purity. Finalized
  // transactions snapshot the rate they used, so changing today's rate can
  // never alter a historical bill.
  metalRates: defineTable({
    organizationId: v.id("organizations"),
    metalPurityId: v.id("metalPurities"),
    ratePerGramPaise: v.number(),
    effectiveAt: v.number(),
    setByUserId: v.id("users"),
  })
    .index("by_org_and_purity", ["organizationId", "metalPurityId"])
    .index("by_org_and_time", ["organizationId", "effectiveAt"]),

  // ---------- Tax ----------
  taxConfigurations: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(), // "GST 3%", "GST 0.25%" etc.
    cgstBasisPoints: v.number(),
    sgstBasisPoints: v.number(),
    igstBasisPoints: v.number(),
    hsnCode: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_org", ["organizationId"]),

  // ---------- Sequencing ----------
  // One row per (org, branch, document type). Allocating the next number is
  // an atomic increment inside the owning mutation — never derived by
  // counting existing documents (racy under concurrent billing).
  invoiceSequences: defineTable({
    organizationId: v.id("organizations"),
    branchId: v.id("branches"),
    documentType: v.string(), // "sales_invoice" | "purchase_invoice" | "credit_note" ...
    prefix: v.string(),
    nextNumber: v.number(),
  }).index("by_org_branch_type", ["organizationId", "branchId", "documentType"]),

  // ---------- Purchases ----------
  purchases: defineTable({
    organizationId: v.id("organizations"),
    branchId: v.id("branches"),
    supplierId: v.id("suppliers"),
    invoiceNumber: v.string(),
    // Absent on every row created before this field existed — always treat
    // missing as "purchase_invoice" (the only document type until now).
    documentType: v.optional(
      v.union(v.literal("purchase_invoice"), v.literal("purchase_order"), v.literal("purchase_return")),
    ),
    status: v.union(v.literal("finalized"), v.literal("cancelled")),
    subtotalPaise: v.number(),
    taxPaise: v.number(),
    totalPaise: v.number(),
    amountPaidPaise: v.number(),
    idempotencyKey: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
  })
    .index("by_org", ["organizationId"])
    .index("by_supplier", ["supplierId"])
    .index("by_org_and_idempotency", ["organizationId", "idempotencyKey"]),

  purchaseItems: defineTable({
    organizationId: v.id("organizations"),
    purchaseId: v.id("purchases"),
    productId: v.id("products"),
    // Unset for a purchase order (goods not physically received yet) and
    // for a purchase return's own line records (the box item already
    // existed before the return; see boxItemId on the original purchase).
    boxId: v.optional(v.id("boxes")),
    boxItemId: v.optional(v.id("boxItems")),
    metalPurityId: v.optional(v.id("metalPurities")),
    label: v.string(),
    grossWeightMg: v.number(),
    stoneWeightMg: v.number(),
    netWeightMg: v.number(),
    ratePerGramPaise: v.number(),
    makingChargePaise: v.number(),
    stoneChargePaise: v.number(),
    lineTotalPaise: v.number(),
  }).index("by_purchase", ["purchaseId"]),

  // ---------- Sales ----------
  sales: defineTable({
    organizationId: v.id("organizations"),
    branchId: v.id("branches"),
    customerId: v.id("customers"),
    documentType: v.union(
      v.literal("sales_invoice"),
      v.literal("quotation"),
      v.literal("proforma_invoice"),
      v.literal("delivery_challan"),
      v.literal("sales_order"),
      v.literal("sales_return"),
      v.literal("credit_note"),
    ),
    invoiceNumber: v.string(),
    status: v.union(v.literal("finalized"), v.literal("cancelled")),
    isGst: v.boolean(),
    subtotalPaise: v.number(),
    discountPaise: v.number(),
    taxPaise: v.number(),
    roundOffPaise: v.number(),
    totalPaise: v.number(),
    amountPaidPaise: v.number(),
    idempotencyKey: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
  })
    .index("by_org", ["organizationId"])
    .index("by_customer", ["customerId"])
    .index("by_org_and_idempotency", ["organizationId", "idempotencyKey"]),

  saleItems: defineTable({
    organizationId: v.id("organizations"),
    saleId: v.id("sales"),
    productId: v.id("products"),
    boxItemId: v.optional(v.id("boxItems")),
    metalPurityId: v.optional(v.id("metalPurities")),
    grossWeightMg: v.number(),
    stoneWeightMg: v.number(),
    otherDeductionMg: v.number(),
    netWeightMg: v.number(),
    ratePerGramPaise: v.number(),
    wastageBasisPoints: v.number(),
    makingChargePaise: v.number(),
    stoneChargePaise: v.number(),
    taxConfigurationId: v.optional(v.id("taxConfigurations")),
    lineTaxPaise: v.number(),
    lineTotalPaise: v.number(),
  }).index("by_sale", ["saleId"]),

  // ---------- Payments & ledgers ----------
  payments: defineTable({
    organizationId: v.id("organizations"),
    direction: v.union(v.literal("receipt"), v.literal("payment")),
    partyType: v.union(v.literal("customer"), v.literal("supplier")),
    partyId: v.string(),
    sourceTable: v.optional(v.string()), // "sales" | "purchases" when tied to a document
    sourceId: v.optional(v.string()),
    mode: v.union(
      v.literal("cash"),
      v.literal("upi"),
      v.literal("card"),
      v.literal("cheque"),
      v.literal("bank_transfer"),
      v.literal("old_gold_exchange"),
    ),
    amountPaise: v.number(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_party", ["partyType", "partyId"]),

  // Old gold a customer trades in against a new jewellery bill (SRS §8).
  // Recorded as its own audit-tracked row (not hidden inside a generic
  // payment) and also inserted into `payments` with mode
  // "old_gold_exchange" so it still nets correctly against the bill total.
  oldGoldExchanges: defineTable({
    organizationId: v.id("organizations"),
    saleId: v.id("sales"),
    customerId: v.id("customers"),
    metalPurityId: v.id("metalPurities"),
    grossWeightMg: v.number(),
    meltingDeductionBasisPoints: v.number(),
    netWeightMg: v.number(),
    ratePerGramPaise: v.number(),
    exchangeValuePaise: v.number(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_sale", ["saleId"]),

  customerLedgerEntries: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    sourceTable: v.string(),
    sourceId: v.string(),
    debitPaise: v.number(),
    creditPaise: v.number(),
    balancePaise: v.number(), // running balance after this entry
    createdAt: v.number(),
  }).index("by_customer", ["customerId"]),

  supplierLedgerEntries: defineTable({
    organizationId: v.id("organizations"),
    supplierId: v.id("suppliers"),
    sourceTable: v.string(),
    sourceId: v.string(),
    debitPaise: v.number(),
    creditPaise: v.number(),
    balancePaise: v.number(),
    createdAt: v.number(),
  }).index("by_supplier", ["supplierId"]),
});
