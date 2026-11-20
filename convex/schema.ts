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
  // View-only staff: can open every screen but every write is rejected server-side (see requireAuthContext).
  v.literal("staff"),
);

// GST registration status of a customer/supplier — drives invoice wording, not tax computation (tax rates are picked per line via taxConfigurations).
export const GST_TYPE = v.union(
  v.literal("unregistered_consumer"),
  v.literal("regular"),
  v.literal("composition"),
  v.literal("sez"),
  v.literal("overseas"),
  v.literal("deemed_export"),
  v.literal("tax_deductor"),
  v.literal("tax_collector_ecommerce"),
  v.literal("uin_holder"),
);

export default defineSchema({
  ...authTables,

  girviLoans: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"), ticketNumber: v.string(), customerName: v.string(), phone: v.string(),
    metal: v.union(v.literal("gold"), v.literal("silver")), description: v.string(), weightMg: v.number(), pieceCount: v.optional(v.number()), storageLocation: v.string(),
    accountId: v.id("bankAccounts"), principalPaise: v.number(), monthlyInterestBasisPoints: v.number(), principalRepaidPaise: v.number(), interestReceivedPaise: v.number(),
    issuedAt: v.number(), dueAt: v.number(), status: v.union(v.literal("active"), v.literal("released"), v.literal("cancelled")),
    releasedAt: v.optional(v.number()), createdByUserId: v.id("users"), createdAt: v.number(),
  }).index("by_org", ["organizationId"]),
  girviReceipts: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"), loanId: v.id("girviLoans"), principalPaise: v.number(), interestPaise: v.number(), createdAt: v.number(), createdByUserId: v.id("users"),
  }).index("by_org", ["organizationId"]).index("by_loan", ["loanId"]),
  // ---------- Org / Access ----------
  organizations: defineTable({
    deletedAt: v.optional(v.number()),
    name: v.string(),
    legalName: v.optional(v.string()),
    gstin: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    state: v.optional(v.string()),
    // Short business-type line and italic motto shown under the name on the printed invoice header (e.g. "Gold and Silver Merchants" / "The Name of Purity").
    tagline: v.optional(v.string()),
    motto: v.optional(v.string()),
    companyType: v.optional(v.union(v.literal("daily_sales"), v.literal("gst_gold"), v.literal("gst_silver"))),
    loginImageStorageId: v.optional(v.id("_storage")),
    appIconStorageId: v.optional(v.id("_storage")),
    invoiceLogoStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  }),

  branches: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
    isDefault: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  // One row per (user, organization) membership. Role lives here, not on the
  // auth user, so a person can belong to multiple orgs in the future without
  // restructuring.
  memberships: defineTable({
    deletedAt: v.optional(v.number()),
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

  currentOrganizations: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  accountingYears: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(v.literal("open"), v.literal("closed")),
    closedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  auditLogs: defineTable({
    deletedAt: v.optional(v.number()),
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
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index("by_org_and_key", ["organizationId", "key"]),

  // Hashed per-user app unlock PINs. The secret hash stays server-side and is
  // never included in the public access/profile queries.
  // Settings → Auto Backup: JSON backups saved on schedule (newest 10 kept per company).
  autoBackups: defineTable({
    organizationId: v.id("organizations"),
    storageId: v.id("_storage"),
    sizeBytes: v.number(),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  appSecurity: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    pinSalt: v.string(),
    pinHash: v.string(),
    failedAttempts: v.optional(v.number()),
    lockedUntil: v.optional(v.number()),
    // Settings → "Enable Passcode" off: the app opens without asking (PIN kept for turning it back on).
    disabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"]),

  // ---------- Parties ----------
  customers: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    shippingAddress: v.optional(v.string()),
    gstin: v.optional(v.string()),
    gstType: v.optional(GST_TYPE),
    state: v.optional(v.string()),
    partyGroup: v.optional(v.string()), // Vyapar party grouping, e.g. "Wholesale"; unset = "General"
    customerType: v.union(v.literal("cash"), v.literal("regular"), v.literal("credit")),
    creditLimitPaise: v.optional(v.number()),
    openingBalancePaise: v.number(),
    openingBalanceDateMs: v.optional(v.number()),
    // Maintained running balance (= latest customerLedgerEntries.balancePaise),
    // updated by every mutation that writes a ledger entry — avoids reading
    // the ledger per customer just to show an outstanding figure.
    currentBalancePaise: v.optional(v.number()),
    // Deadline for the customer's current outstanding balance — surfaced on
    // the Outstanding Balances page so staff know who to remind and when.
    dueDateMs: v.optional(v.number()),
    notes: v.optional(v.string()),
    customFields: v.optional(v.record(v.string(), v.string())),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_phone", ["organizationId", "phone"]),

  suppliers: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    shippingAddress: v.optional(v.string()),
    gstin: v.optional(v.string()),
    gstType: v.optional(GST_TYPE),
    state: v.optional(v.string()),
    partyGroup: v.optional(v.string()), // Vyapar party grouping, e.g. "Wholesale"; unset = "General"
    creditLimitPaise: v.optional(v.number()),
    customFields: v.optional(v.record(v.string(), v.string())),
    openingBalancePaise: v.number(),
    openingBalanceDateMs: v.optional(v.number()),
    currentBalancePaise: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  // ---------- Catalog / Inventory config ----------
  stockGroups: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
    parentId: v.optional(v.id("stockGroups")),
  }).index("by_org", ["organizationId"]),

  stockCategories: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
  }).index("by_org", ["organizationId"]),

  metalPurities: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    metal: v.union(v.literal("gold"), v.literal("silver")),
    label: v.string(), // "22K", "24K", "18K", "Silver 925"
    purityBasisPoints: v.number(), // e.g. 22K = 9166 (91.66%)
    isActive: v.boolean(),
  }).index("by_org", ["organizationId"]),

  products: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    sku: v.optional(v.string()),
    // "service" items (making-charge-only labor, polish, repair) carry no weight/stock — billed as a flat charge with no box piece behind them.
    itemType: v.optional(v.union(v.literal("product"), v.literal("service"))),
    stockGroupId: v.optional(v.id("stockGroups")),
    stockCategoryId: v.optional(v.id("stockCategories")),
    metalPurityId: v.optional(v.id("metalPurities")),
    unit: v.union(v.literal("gram"), v.literal("kilogram"), v.literal("piece"), v.literal("carat")),
    hsnCode: v.optional(v.string()),
    customFields: v.optional(v.record(v.string(), v.string())),
    reorderLevelMg: v.optional(v.number()),
    // Item form "Pricing" tab. All optional: jewellery is usually billed by
    // today's metal rate, so these are defaults/reference, not required.
    salePricePaise: v.optional(v.number()),
    salePriceIncludesTax: v.optional(v.boolean()),
    saleDiscountMode: v.optional(v.union(v.literal("percent"), v.literal("amount"))),
    saleDiscountValue: v.optional(v.number()), // basis points for percent, paise for amount
    wholesalePricePaise: v.optional(v.number()),
    wholesaleMinQty: v.optional(v.number()),
    purchasePricePaise: v.optional(v.number()),
    purchasePriceIncludesTax: v.optional(v.boolean()),
    taxConfigurationId: v.optional(v.id("taxConfigurations")),
    // Jewellery defaults for the item (per piece).
    grossWeightMg: v.optional(v.number()),
    netWeightMg: v.optional(v.number()),
    makingChargePaise: v.optional(v.number()),
    stoneWeightMg: v.optional(v.number()),
    wastageBasisPoints: v.optional(v.number()),
    // Purity typed in by hand ("Other") when it isn't one of the standard karats.
    purityOther: v.optional(v.string()),
    // Box this item is normally kept in (purchases/opening stock default to it).
    defaultBoxId: v.optional(v.id("boxes")),
    // Item form "Stock" tab.
    openingAtPricePaise: v.optional(v.number()),
    openingAsOfMs: v.optional(v.number()),
    location: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_sku", ["organizationId", "sku"]),

  // ---------- GST item stock ----------
  // GST companies don't use boxes: stock is kept per item (product) as a
  // running weight + piece balance. Every change is also written to
  // stockMovements (with no boxId) for history. See convex/lib/itemStock.ts.
  productStock: defineTable({
    organizationId: v.id("organizations"),
    productId: v.id("products"),
    weightMg: v.number(),
    pieces: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_product", ["organizationId", "productId"]),

  // ---------- Box management ----------
  boxes: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    boxNumber: v.number(), // 101-200 seeded, unlimited thereafter
    label: v.optional(v.string()), // box name
    category: v.optional(v.string()), // Ring Box, Chain Box, Necklace Box…
    boxType: v.optional(v.string()), // Display tray, Locker, Counter…
    description: v.optional(v.string()),
    // Which metal the box holds. Gold lines can only go into / come out of a
    // gold box (and silver likewise). Unset on boxes made before this existed.
    metal: v.optional(v.union(v.literal("gold"), v.literal("silver"))),
    // Running stock balance of the box: gross weight and piece count. Sales
    // deduct, purchases add, adjustments/transfers move it — always through
    // lib/boxStock.ts, which also writes a stockMovements row. Unset on boxes
    // that still hold only old per-piece stock (boxItems); see readBoxBalance.
    weightMg: v.optional(v.number()),
    pieces: v.optional(v.number()),
    location: v.optional(v.string()), // godown / shelf, e.g. "Main Shop"
    // Mirrors `pieces` once the box has a running balance (older screens read it).
    itemCount: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_and_number", ["organizationId", "boxNumber"]),

  // Items inside a box. A box (unique number) can hold several items — e.g.
  // a Necklace box with a few small rings — and each item in a box carries
  // its own billing details and its own stock (gross weight, net weight,
  // pieces). One row per (box, item). The box's weightMg/pieces stay the
  // total: the sum of its entries plus any older stock not yet assigned to
  // an item. Changed only through lib/boxStock.ts.
  boxEntries: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    boxId: v.id("boxes"),
    productId: v.id("products"),
    hsnCode: v.optional(v.string()),
    metalPurityId: v.optional(v.id("metalPurities")),
    description: v.optional(v.string()),
    stockGroupId: v.optional(v.id("stockGroups")),
    wastageBasisPoints: v.optional(v.number()),
    makingChargeMode: v.optional(v.union(v.literal("fixed"), v.literal("per_gram"), v.literal("percent"))),
    makingChargeValue: v.optional(v.number()), // paise, paise per gram, or basis points
    // Selling / purchase price per piece. Blank → billed by net weight × rate.
    salePricePaise: v.optional(v.number()),
    purchasePricePaise: v.optional(v.number()),
    saleDiscountMode: v.optional(v.union(v.literal("percent"), v.literal("amount"))),
    saleDiscountValue: v.optional(v.number()), // basis points for percent, paise for amount
    taxConfigurationId: v.optional(v.id("taxConfigurations")),
    // Running stock of this item in this box.
    weightMg: v.number(), // gross
    netWeightMg: v.number(),
    pieces: v.number(),
    createdAt: v.number(),
  })
    .index("by_box", ["boxId"])
    .index("by_box_and_product", ["boxId", "productId"])
    .index("by_org", ["organizationId"]),

  // Current location of each physical item. One row per item; moving it
  // updates this row and writes a stockMovements record — an item can never
  // be in two boxes at once because this is the single source of truth.
  boxItems: defineTable({
    deletedAt: v.optional(v.number()),
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
    .index("by_product", ["productId"])
    .index("by_box", ["boxId"])
    .index("by_org_and_barcode", ["organizationId", "barcode"]),

  // Append-only ledger of every stock change. Every mutation that changes
  // inventory writes one of these in the same transaction — nothing
  // overwrites a quantity without leaving this trail.
  stockMovements: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    // Unset for box-level movements that aren't about one item (opening
    // stock, adjustments, transfers).
    productId: v.optional(v.id("products")),
    boxItemId: v.optional(v.id("boxItems")),
    // Physical location at the time of this movement. Kept on the ledger so
    // transfers and sales remain attributable after the item changes boxes.
    boxId: v.optional(v.id("boxes")),
    // Item-in-box row the movement belongs to (unset: box-level / older stock).
    boxEntryId: v.optional(v.id("boxEntries")),
    direction: v.union(v.literal("in"), v.literal("out")),
    // Weight moved. Box stock moves by gross weight; older piece rows used net.
    netWeightMg: v.number(),
    quantity: v.number(),
    sourceTable: v.string(), // purchases, sales, stock_adjustments, box_transfers, box_opening, etc.
    sourceId: v.string(),
    note: v.optional(v.string()), // adjustment reason / transfer remark
    createdAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_product", ["productId"])
    .index("by_box", ["boxId"])
    .index("by_source", ["sourceTable", "sourceId"]),

  // ---------- Metal rates ----------
  // Append-only. "Current rate" = latest row for that purity. Finalized
  // transactions snapshot the rate they used, so changing today's rate can
  // never alter a historical bill.
  metalRates: defineTable({
    deletedAt: v.optional(v.number()),
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
    deletedAt: v.optional(v.number()),
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
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    branchId: v.id("branches"),
    documentType: v.string(), // "sales_invoice" | "purchase_invoice" | "credit_note" ...
    prefix: v.string(),
    nextNumber: v.number(),
  }).index("by_org_branch_type", ["organizationId", "branchId", "documentType"]),

  // ---------- Purchases ----------
  purchases: defineTable({
    deletedAt: v.optional(v.number()),
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
    // Vyapar purchase form extras (all optional for older bills).
    supplierBillNumber: v.optional(v.string()), // the number printed on the supplier's own bill
    stateOfSupply: v.optional(v.string()),
    roundOffPaise: v.optional(v.number()),
    notes: v.optional(v.string()), // description / terms & conditions
    billImageStorageId: v.optional(v.id("_storage")), // photo or scan of the supplier's bill
    idempotencyKey: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
  })
    .index("by_org", ["organizationId"])
    .index("by_supplier", ["supplierId"])
    .index("by_org_and_idempotency", ["organizationId", "idempotencyKey"])
    .index("by_org_and_type", ["organizationId", "documentType"])
    .index("by_org_and_time", ["organizationId", "createdAt"]),

  purchaseItems: defineTable({
    deletedAt: v.optional(v.number()),
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
    lineDiscountPaise: v.optional(v.number()),
    lineTotalPaise: v.number(),
    // Fixed purchase price per piece, when the line wasn't priced by rate per gram.
    unitPricePaise: v.optional(v.number()),
    // GST company line: added to item stock (productStock) instead of a box.
    toItemStock: v.optional(v.boolean()),
    pieces: v.optional(v.number()),
    // Weight actually added to item stock for this line (the gross weight).
    // Absent on lines saved before stock moved to gross weight — those
    // added their net weight, so reversals fall back to netWeightMg.
    stockWeightMg: v.optional(v.number()),
    // Gold / silver, for the gold & silver subtotals and box routing.
    metal: v.optional(v.union(v.literal("gold"), v.literal("silver"))),
    // The item-in-box row this line's stock went into, and the net weight it added.
    boxEntryId: v.optional(v.id("boxEntries")),
    stockNetWeightMg: v.optional(v.number()),
    // Line sent back to the supplier by a purchase return (item-stock and box-stock lines).
    returnedAt: v.optional(v.number()),
    // On a purchase return's GST line: the original invoice line it sends back.
    returnOfPurchaseItemId: v.optional(v.id("purchaseItems")),
  }).index("by_purchase", ["purchaseId"]).index("by_product", ["productId"]).index("by_org", ["organizationId"]),

  // ---------- Sales ----------
  sales: defineTable({
    deletedAt: v.optional(v.number()),
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
    stateOfSupply: v.optional(v.string()), // decides IGST vs CGST + SGST; unset = customer's state
    subtotalPaise: v.number(),
    discountPaise: v.number(),
    oldItemDeductionPaise: v.optional(v.number()),
    // What the old item deduction was for (e.g. "old ring"), printed beside the amount.
    oldItemDeductionNote: v.optional(v.string()),
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
    .index("by_org_and_idempotency", ["organizationId", "idempotencyKey"])
    .index("by_org_and_type", ["organizationId", "documentType"])
    .index("by_org_and_time", ["organizationId", "createdAt"]),

  saleItems: defineTable({
    deletedAt: v.optional(v.number()),
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
    lineDiscountPaise: v.optional(v.number()),
    lineTotalPaise: v.number(),
    // Fixed selling price per piece (item master), when not priced by rate per gram.
    unitPricePaise: v.optional(v.number()),
    // Internal cost snapshot (item purchase price × pieces) for profit reports — never printed or sent to the billing counter.
    purchasePricePaise: v.optional(v.number()),
    // Billed price differs from the item's saved selling price (Owner/Admin only, audit-logged).
    priceOverridden: v.optional(v.boolean()),
    // GST company line: typed in manually and deducted from item stock (productStock), not a box piece.
    fromItemStock: v.optional(v.boolean()),
    pieces: v.optional(v.number()),
    // Weight taken out of item stock (the gross weight). Absent on older
    // lines, which deducted their net weight — reversals fall back to that.
    stockWeightMg: v.optional(v.number()),
    // Daily Sales line: the box its gross weight and pieces were taken from.
    boxId: v.optional(v.id("boxes")),
    // The item-in-box row it was taken from, and the net weight taken.
    boxEntryId: v.optional(v.id("boxEntries")),
    stockNetWeightMg: v.optional(v.number()),
    // HSN code at the time of sale (from the item's row in the box).
    hsnCode: v.optional(v.string()),
    metal: v.optional(v.union(v.literal("gold"), v.literal("silver"))),
    // Description printed on the bill (defaults to the item name).
    label: v.optional(v.string()),
    // How the making charge was entered; makingChargePaise is the result.
    makingChargeMode: v.optional(v.union(v.literal("fixed"), v.literal("per_gram"), v.literal("percent"))),
    makingChargeValue: v.optional(v.number()), // paise, paise per gram, or basis points
    // Box line brought back by a sales return / credit note.
    returnedAt: v.optional(v.number()),
    // On a return's line: the invoice line it brings back.
    returnOfSaleItemId: v.optional(v.id("saleItems")),
  }).index("by_sale", ["saleId"]).index("by_product", ["productId"]).index("by_org", ["organizationId"]),

  // ---------- Payments & ledgers ----------
  payments: defineTable({
    deletedAt: v.optional(v.number()),
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
    .index("by_party", ["partyType", "partyId"])
    .index("by_org_and_time", ["organizationId", "createdAt"]),

  // Old gold a customer trades in against a new jewellery bill (SRS §8).
  // Recorded as its own audit-tracked row (not hidden inside a generic
  // payment) and also inserted into `payments` with mode
  // "old_gold_exchange" so it still nets correctly against the bill total.
  oldGoldExchanges: defineTable({
    deletedAt: v.optional(v.number()),
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
    deletedAt: v.optional(v.number()),
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
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    supplierId: v.id("suppliers"),
    sourceTable: v.string(),
    sourceId: v.string(),
    debitPaise: v.number(),
    creditPaise: v.number(),
    balancePaise: v.number(),
    createdAt: v.number(),
  }).index("by_supplier", ["supplierId"]),

  // ---------- Cash & Bank ----------
  // "Cash in hand" is just an account with type "cash" — same shape as a bank
  // account, so the ledger and balance logic below never has to special-case it.
  bankAccounts: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    name: v.string(),
    type: v.union(v.literal("cash"), v.literal("bank")),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    openingBalancePaise: v.number(),
    // Maintained running balance (= latest cashBankLedgerEntries.balancePaise)
    // — same pattern as customers/suppliers' currentBalancePaise.
    currentBalancePaise: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  cashBankLedgerEntries: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    accountId: v.id("bankAccounts"),
    sourceTable: v.string(), // "cash_bank_opening" | "cash_bank_transaction" | "cash_bank_transfer" | "expenses"
    sourceId: v.string(),
    description: v.string(),
    debitPaise: v.number(),
    creditPaise: v.number(),
    balancePaise: v.number(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_account", ["accountId"]),

  // ---------- Expenses ----------
  // Shop running costs (rent, salary, electricity) — kept separate from
  // supplier purchases, which are always inventory. Category is free text
  // (not a managed list) so staff aren't blocked creating a new one.
  expenses: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    category: v.string(),
    amountPaise: v.number(),
    paymentAccountId: v.optional(v.id("bankAccounts")),
    description: v.optional(v.string()),
    expenseDate: v.number(),
    status: v.union(v.literal("recorded"), v.literal("deleted")),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  // ---------- Other income, capital, loans, fixed assets ----------
  // Money that isn't a sale, purchase or expense. Feeds Profit & Loss
  // (other income, loan interest) and the Balance Sheet (capital, loans,
  // fixed assets). Posts to a cash/bank account like expenses do.
  accountEntries: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    kind: v.union(
      v.literal("other_income"),
      v.literal("capital_in"),
      v.literal("drawings"),
      v.literal("loan_taken"),
      v.literal("loan_repaid"),
      v.literal("loan_interest"),
      v.literal("fixed_asset"),
    ),
    name: v.string(), // income category, lender, or asset name
    amountPaise: v.number(),
    entryDate: v.number(),
    paymentAccountId: v.optional(v.id("bankAccounts")),
    description: v.optional(v.string()),
    status: v.union(v.literal("recorded"), v.literal("deleted")),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_org", ["organizationId"]),

  // ---------- E-Way Bill ----------
  // We have no GSP/government API access, so this is "Part A" document data
  // entry only — staff still generate the actual EWB on ewaybillgst.gov.in
  // and paste the number back in. One row per sale; updating re-saves it.
  ewayBills: defineTable({
    deletedAt: v.optional(v.number()),
    organizationId: v.id("organizations"),
    saleId: v.id("sales"),
    transportMode: v.union(v.literal("road"), v.literal("rail"), v.literal("air"), v.literal("ship")),
    vehicleNumber: v.optional(v.string()),
    transporterName: v.optional(v.string()),
    transporterGstin: v.optional(v.string()),
    approxDistanceKm: v.optional(v.number()),
    ewayBillNumber: v.optional(v.string()),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_sale", ["saleId"]),

  // ---------- Held bills ----------
  // A New Bill parked mid-way ("Hold") so the counter can bill another customer
  // and come back to it. Nothing is booked: no invoice number, stock or money
  // moves until it is opened and saved as a real bill, which removes it.
  heldBills: defineTable({
    organizationId: v.id("organizations"),
    customerName: v.string(),
    itemCount: v.number(),
    totalPaise: v.number(),
    draft: v.string(), // the bill form as JSON, restored when the bill is reopened
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_org", ["organizationId"]),
});
