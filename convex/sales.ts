import { readPreferences } from "./appPreferences";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { canOverridePrice, canViewCost, requireAuthContext, requireRole, type AuthContext } from "./lib/auth";
import { allocateInvoiceNumber, resolveBranchId } from "./lib/sequences";
import { computeOldGoldExchange, computeSaleLine, basisPointsOf, makingChargeFor, metalValuePaise, type MakingChargeMode } from "../src/lib/jewelry-calc";
import { gstRateBp, isInterState, splitTax, type TaxRates } from "../src/lib/gst-rate";
import type { Doc, Id } from "./_generated/dataModel";
import { assertBookingYearOpen } from "./lib/accountingYears";
import { changeItemStock, isGstCompanyType } from "./lib/itemStock";
import { assertBoxMetal, changeBoxStock, entryForRemoval, entryForStockBack, findBoxEntry, getCompanyBox, type Metal } from "./lib/boxStock";

/** Sales invoices only — quotations, proforma invoices, returns and credit notes each have their own dedicated list page/query. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_org_and_type", (q) => q.eq("organizationId", auth.organizationId).eq("documentType", "sales_invoice"))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const [items, products, payments] = await Promise.all([
      ctx.db.query("saleItems").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
      ctx.db.query("payments").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect(),
    ]);
    const productById = new Map(products.map((product) => [String(product._id), product]));
    return sales.map((sale) => {
      const saleItems = items.filter((item) => item.saleId === sale._id);
      const salePayments = payments.filter((payment) => payment.sourceTable === "sales" && payment.sourceId === sale._id);
      const paymentTypes = [...new Set(salePayments.map((payment) => payment.mode.replaceAll("_", " ")))];
      const breakup = new Map<string, number>();
      for (const payment of salePayments) breakup.set(payment.mode, (breakup.get(payment.mode) ?? 0) + payment.amountPaise);
      const itemDetails = saleItems.map((item) => {
        const product = productById.get(String(item.productId));
        return `${item.label ?? product?.name ?? "Item"} · ${item.netWeightMg ? (item.netWeightMg / 1000).toFixed(3) + " g" : ""}`.trim();
      });
      const descriptions = saleItems.map((item) => {
        const fields = productById.get(String(item.productId))?.customFields;
        return (productById.get(String(item.productId))?.description?.trim() || fields?.description?.trim());
      }).filter((value): value is string => Boolean(value));
      return {
        ...sale,
        reportItemDetails: itemDetails.join("; ") || "—",
        reportDescription: [...new Set(descriptions)].join("; ") || "—",
        reportPaymentType: paymentTypes.join(", ") || "—",
        reportPaymentBreakup: [...breakup.entries()].map(([mode, amount]) => `${mode.replaceAll("_", " ")}: ₹${(amount / 100).toFixed(2)}`).join("; ") || "—",
      };
    });
  },
});

export const getItems = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    const items = await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    // The cost snapshot is internal — only roles that may see purchase prices get it.
    return canViewCost(auth.role) ? items : items.map(withoutCost);
  },
});

function withoutCost<T extends { purchasePricePaise?: number }>(item: T): Omit<T, "purchasePricePaise"> {
  const { purchasePricePaise: _cost, ...rest } = item;
  void _cost;
  return rest;
}

export const getOldGoldExchange = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("oldGoldExchanges")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
  },
});

/** Everything a printable invoice needs, in one query. */
/**
 * The rate, making charge and wastage each item was last billed at, so the
 * New Bill screen can fill them in the moment an item is picked. One indexed
 * read per product (latest sale line) — fine at shop scale.
 */
export const lastPricesByProduct = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const products = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(2000);
    const result: Record<string, { ratePerGramPaise: number; makingChargePaise: number; wastageBasisPoints: number; metalPurityId?: Id<"metalPurities"> }> = {};
    for (const product of products) {
      const recent = await ctx.db
        .query("saleItems")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .order("desc")
        .filter((q) => q.and(q.eq(q.field("deletedAt"), undefined), q.gt(q.field("lineTotalPaise"), 0)))
        .take(5);
      for (const line of recent) {
        if (line.organizationId !== auth.organizationId) continue;
        const sale = await ctx.db.get(line.saleId);
        // Only real bills — not returns/credit notes or cancelled invoices.
        if (!sale || sale.deletedAt || sale.status !== "finalized" || sale.documentType !== "sales_invoice") continue;
        result[product._id] = {
          ratePerGramPaise: line.ratePerGramPaise,
          makingChargePaise: line.makingChargePaise,
          wastageBasisPoints: line.wastageBasisPoints,
          metalPurityId: line.metalPurityId,
        };
        break;
      }
    }
    return result;
  },
});

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
        .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.eq(q.field("deletedAt"), sale.cancelledAt ?? -1)))
      .collect(),
      ctx.db.get(sale.customerId),
      ctx.db.get(auth.organizationId),
      ctx.db
        .query("oldGoldExchanges")
        .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
        .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.eq(q.field("deletedAt"), sale.cancelledAt ?? -1)))
      .first(),
      ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.and(q.eq(q.field("sourceTable"), "sales"), q.eq(q.field("sourceId"), args.saleId)))
        .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.eq(q.field("deletedAt"), sale.cancelledAt ?? -1)))
      .collect(),
    ]);

    const items = await Promise.all(
      saleItems.map(async (item) => {
        const [product, boxItem, purity] = await Promise.all([
          ctx.db.get(item.productId),
          item.boxItemId ? ctx.db.get(item.boxItemId) : null,
          item.metalPurityId ? ctx.db.get(item.metalPurityId) : null,
        ]);
        const box = item.boxId ? await ctx.db.get(item.boxId) : boxItem ? await ctx.db.get(boxItem.boxId) : null;
        // Customer-facing: the cost snapshot never leaves the server here.
        return {
          ...withoutCost(item),
          productName: product?.name ?? "Item",
          sku: product?.sku,
          label: item.label ?? boxItem?.label ?? product?.name ?? "Item",
          stockNetWeightMg: boxItem?.netWeightMg,
          purityLabel: purity?.label ?? product?.purityOther,
          hsnCode: item.hsnCode ?? product?.hsnCode,
          // Older one-piece lines report the box the piece came from.
          boxId: item.boxId ?? box?._id,
          boxNumber: box?.boxNumber,
          metal: item.metal ?? purity?.metal ?? box?.metal,
        };
      }),
    );

    const logoUrl = organization?.invoiceLogoStorageId ? await ctx.storage.getUrl(organization.invoiceLogoStorageId) : null;

    // GST bills print CGST / SGST / IGST separately, split by the same rule the bill was charged with.
    let gst: { cgstPaise: number; sgstPaise: number; igstPaise: number; rates: TaxRates | null } | null = null;
    if (sale.isGst) {
      const interState = isInterState(sale.stateOfSupply || customer?.state, organization?.state);
      gst = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, rates: null };
      const rateKeys = new Set<string>();
      for (const item of saleItems) {
        const config = item.taxConfigurationId ? await ctx.db.get(item.taxConfigurationId) : null;
        if (!config || item.lineTaxPaise === 0) continue;
        const split = splitTax(item.lineTaxPaise, config, interState);
        gst.cgstPaise += split.cgstPaise;
        gst.sgstPaise += split.sgstPaise;
        gst.igstPaise += split.igstPaise;
        rateKeys.add(`${config.cgstBasisPoints}/${config.sgstBasisPoints}/${config.igstBasisPoints}`);
        gst.rates = { cgstBasisPoints: config.cgstBasisPoints, sgstBasisPoints: config.sgstBasisPoints, igstBasisPoints: config.igstBasisPoints };
      }
      // Lines at different rates: print the amounts without a single "@ x%".
      if (rateKeys.size > 1) gst.rates = null;
    }

    return { sale, items, customer, organization, logoUrl, oldGoldExchange, payments, gst };
  },
});

export const listByDocumentType = query({
  args: {
    documentType: v.union(
      v.literal("quotation"),
      v.literal("proforma_invoice"),
      v.literal("sales_order"),
      v.literal("delivery_challan"),
      v.literal("sales_return"),
      v.literal("credit_note"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const filtered = await ctx.db
      .query("sales")
      .withIndex("by_org_and_type", (q) => q.eq("organizationId", auth.organizationId).eq("documentType", args.documentType))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(200);
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
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
    if (!sale || sale.deletedAt || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    const items = await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const withBoxItem = await Promise.all(
      items.map(async (item) => ({ item, boxItem: item.boxItemId ? await ctx.db.get(item.boxItemId) : null, product: await ctx.db.get(item.productId) })),
    );
    return withBoxItem
      // Box lines: not returned yet. Older piece lines: the piece is still sold.
      .filter(({ item, boxItem }) => (item.boxId ? !item.returnedAt : boxItem?.status === "sold"))
      .map(({ item, boxItem, product }) => ({ ...item, label: item.label ?? boxItem?.label ?? product?.name ?? "Item", previousBoxId: item.boxId ?? boxItem?.boxId }));
  },
});

export const listByCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.deletedAt || customer.organizationId !== auth.organizationId) throw new Error("Not found");
    return await ctx.db
      .query("sales")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

// A line is either a box piece (boxItemId — both company types) or, in a GST
// company only, a typed item taken from loose item stock (productId + weights + pieces).
function checkedDiscount(paise: number | undefined) {
  if (paise === undefined) return undefined;
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("Line discount must be a valid amount of zero or more");
  return paise;
}

const metalValidator = v.union(v.literal("gold"), v.literal("silver"));
const makingModeValidator = v.union(v.literal("fixed"), v.literal("per_gram"), v.literal("percent"));

const saleLineValidator = v.object({
  // Daily Sales: the box the gross weight and pieces come out of.
  boxId: v.optional(v.id("boxes")),
  // Older clients: one piece from a box (sold whole, from that piece's box).
  boxItemId: v.optional(v.id("boxItems")),
  productId: v.optional(v.id("products")),
  // Description printed on the bill. With no productId it names a new item (created on save).
  label: v.optional(v.string()),
  metal: v.optional(metalValidator),
  grossWeightMg: v.optional(v.number()),
  // Box line: net weight typed on the bill (≤ gross). The bill is priced on it.
  netWeightMg: v.optional(v.number()),
  stoneWeightMg: v.optional(v.number()),
  pieces: v.optional(v.number()),
  makingChargeMode: v.optional(makingModeValidator),
  makingChargeValue: v.optional(v.number()),
  metalPurityId: v.optional(v.id("metalPurities")),
  otherDeductionMg: v.number(),
  ratePerGramPaise: v.number(),
  wastageBasisPoints: v.number(),
  makingChargePaise: v.number(),
  stoneChargePaise: v.number(),
  taxConfigurationId: v.optional(v.id("taxConfigurations")),
  lineDiscountPaise: v.optional(v.number()),
  // Fixed selling price per piece. Omitted/0 → priced by net weight × rate per gram.
  unitPricePaise: v.optional(v.number()),
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

type SaleTransactionArgs = {
  customerId: Id<"customers">;
  isGst: boolean;
  stateOfSupply?: string;
  items: Array<{
    boxId?: Id<"boxes">;
    boxItemId?: Id<"boxItems">;
    productId?: Id<"products">;
    label?: string;
    metal?: Metal;
    grossWeightMg?: number;
    netWeightMg?: number;
    stoneWeightMg?: number;
    pieces?: number;
    makingChargeMode?: MakingChargeMode;
    makingChargeValue?: number;
    metalPurityId?: Id<"metalPurities">;
    otherDeductionMg: number;
    ratePerGramPaise: number;
    wastageBasisPoints: number;
    makingChargePaise: number;
    stoneChargePaise: number;
    taxConfigurationId?: Id<"taxConfigurations">;
    lineDiscountPaise?: number;
    unitPricePaise?: number;
  }>;
  discountMode: "percent" | "fixed" | "none";
  discountValue: number;
  oldItemDeductionPaise?: number;
  oldItemDeductionNote?: string;
  payments: Array<{ mode: Doc<"payments">["mode"]; amountPaise: number }>;
  oldGoldExchange?: {
    metalPurityId: Id<"metalPurities">;
    grossWeightMg: number;
    meltingDeductionBasisPoints: number;
    ratePerGramPaise: number;
  };
};

/**
 * Validates, computes and writes every effect of a sale (items, stock,
 * customer ledger, payments, old gold exchange) onto an already-existing
 * `sales` row. Shared by `create` (row just inserted, blank) and `update`
 * (row's prior effects already reversed) so the two can never drift apart.
 */
async function applySaleTransaction(
  ctx: MutationCtx,
  auth: AuthContext,
  saleId: Id<"sales">,
  args: SaleTransactionArgs,
  billDate: number,
) {
  if (args.items.length === 0) throw new Error("At least one item is required");

  const customer = await ctx.db.get(args.customerId);
  if (!customer || customer.deletedAt || customer.organizationId !== auth.organizationId) throw new Error("Customer not found");
  // GST: IGST for a customer in another state, else CGST + SGST — never both.
  const interState = isInterState(args.stateOfSupply || customer.state, (await ctx.db.get(auth.organizationId))?.state);

  const taxConfigs = new Map<Id<"taxConfigurations">, number>();
  const company = await ctx.db.get(auth.organizationId);
  const gstCompany = isGstCompanyType(company?.companyType);
  const prefs = await readPreferences(ctx, auth.organizationId);
  const computedLines: Array<{
    item: SaleTransactionArgs["items"][number];
    // Box line (both company types): the box stock comes out of. Loose GST item-stock line: null.
    box: Doc<"boxes"> | null;
    // Older clients: the single box piece being sold.
    boxItem: Doc<"boxItems"> | null;
    // The item's row inside the box (its stock, saved price and cost), when the box holds that item.
    boxEntry: Doc<"boxEntries"> | null;
    costPerPiecePaise?: number;
    productId: Id<"products">;
    label: string;
    metal?: Metal;
    grossWeightMg: number;
    stoneWeightMg: number;
    pieces: number;
    product: Doc<"products">;
    priceOverridden: boolean;
    computed: ReturnType<typeof computeSaleLine>;
  }> = [];
  const overrides: Array<{ productId: Id<"products">; label: string; savedPricePaise: number | null; billedPricePaise: number | null }> = [];

  let productsByName: Map<string, Doc<"products">> | null = null;
  // Description typed without picking an item: reuse an item of that name, else create it (like a new customer).
  async function productForLabel(label: string, metalPurityId?: Id<"metalPurities">) {
    if (!productsByName) {
      const all = await ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect();
      productsByName = new Map(all.map((p) => [p.name.trim().toLowerCase(), p]));
    }
    const existing = productsByName.get(label.toLowerCase());
    if (existing) return existing;
    if (prefs.blockNewItemsFromTxn) throw new Error(`"${label}" is not in the Item List. Add it under Items first — new items from bills are turned off in Settings.`);
    const id = await ctx.db.insert("products", { organizationId: auth.organizationId, name: label, unit: "gram", metalPurityId, isActive: true, createdAt: Date.now() });
    const product = (await ctx.db.get(id))!;
    productsByName.set(label.toLowerCase(), product);
    return product;
  }

  for (const item of args.items) {
    const unitPricePaise = item.unitPricePaise ?? 0;
    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) throw new Error("Selling price must be a valid amount of zero or more");
    if (!Number.isSafeInteger(item.ratePerGramPaise) || item.ratePerGramPaise < 0) throw new Error("Rate per gram must be a valid amount");
    if (unitPricePaise === 0 && item.ratePerGramPaise <= 0) throw new Error("Enter the selling price or the rate per gram for every item");
    let box: Doc<"boxes"> | null = null;
    let boxItem: Doc<"boxItems"> | null = null;
    let product: Doc<"products"> | null = null;
    let grossWeightMg: number;
    let stoneWeightMg: number;
    let pieces: number;
    let label = item.label?.trim().slice(0, 80) ?? "";
    let netWeightMg: number;
    if (item.productId) {
      product = await ctx.db.get(item.productId);
      if (!product || product.deletedAt || product.organizationId !== auth.organizationId) throw new Error("Item not found");
    }
    if (item.boxItemId) {
      boxItem = await ctx.db.get(item.boxItemId);
      if (!boxItem || boxItem.deletedAt || boxItem.organizationId !== auth.organizationId) throw new Error("Item not found");
      if (boxItem.status !== "in_stock") throw new Error(`"${boxItem.label}" is not available for sale`);
      box = await getCompanyBox(ctx, auth.organizationId, boxItem.boxId, true);
      product = await ctx.db.get(boxItem.productId);
      grossWeightMg = boxItem.grossWeightMg;
      stoneWeightMg = boxItem.stoneWeightMg;
      pieces = 1;
      label ||= boxItem.label;
      if (!Number.isSafeInteger(item.otherDeductionMg) || item.otherDeductionMg < 0 || item.otherDeductionMg > boxItem.netWeightMg) {
        throw new Error(`Other deduction for "${label}" must be between 0 and its net weight.`);
      }
      netWeightMg = boxItem.netWeightMg - item.otherDeductionMg;
    } else {
      if (!gstCompany && !item.boxId) throw new Error("Choose the box for every item on a Daily Sales bill.");
      if (item.boxId) box = await getCompanyBox(ctx, auth.organizationId, item.boxId);
      if (!box && !product) throw new Error("Choose the item for every bill line.");
      if (!product) {
        if (!label) throw new Error("Enter the item description for every bill line.");
        product = await productForLabel(label, item.metalPurityId);
      }
      label ||= product.name;
      grossWeightMg = item.grossWeightMg ?? 0;
      pieces = item.pieces ?? (box ? 0 : 1);
      if (!Number.isSafeInteger(grossWeightMg) || grossWeightMg <= 0) throw new Error(`Enter the gross weight for "${label}".`);
      if (!Number.isSafeInteger(pieces) || pieces < (box ? 0 : 1)) throw new Error(`Pieces for "${label}" must be ${box ? "0" : "1"} or more.`);
      if (box) {
        // Box line: gross comes out of the box, the bill is priced on the net weight typed in.
        netWeightMg = item.netWeightMg ?? grossWeightMg;
        if (!Number.isSafeInteger(netWeightMg) || netWeightMg <= 0) throw new Error(`Enter the net weight for "${label}".`);
        if (netWeightMg > grossWeightMg) throw new Error(`Net weight of "${label}" cannot be more than its gross weight.`);
        stoneWeightMg = grossWeightMg - netWeightMg;
      } else {
        stoneWeightMg = item.stoneWeightMg ?? 0;
        if (!Number.isSafeInteger(stoneWeightMg) || stoneWeightMg < 0 || stoneWeightMg > grossWeightMg) throw new Error(`Stone weight for "${label}" must be between 0 and its gross weight.`);
        if (!Number.isSafeInteger(item.otherDeductionMg) || item.otherDeductionMg < 0 || item.otherDeductionMg > grossWeightMg - stoneWeightMg) {
          throw new Error(`Other deduction for "${label}" must be between 0 and its available net weight.`);
        }
        netWeightMg = grossWeightMg - stoneWeightMg - item.otherDeductionMg;
      }
    }
    if (!product) throw new Error("Item not found");
    // The item's row inside the box: its stock is what this line takes, and its details price the line.
    const boxEntry = box && !boxItem ? await findBoxEntry(ctx, box._id, product._id) : null;

    let metal = item.metal;
    if (item.metalPurityId) {
      const purity = await ctx.db.get(item.metalPurityId);
      if (!purity || purity.deletedAt || purity.organizationId !== auth.organizationId) throw new Error("Metal purity not found");
      if (metal && purity.metal !== metal) throw new Error(`Purity ${purity.label} is ${purity.metal}, but "${label}" is marked ${metal}.`);
      metal ??= purity.metal;
    }
    metal ??= box?.metal;
    if (box) assertBoxMetal(box, metal);

    let gstBasisPoints = 0;
    if (args.isGst && item.taxConfigurationId) {
      if (!taxConfigs.has(item.taxConfigurationId)) {
        const config = await ctx.db.get(item.taxConfigurationId);
        if (!config || config.deletedAt || config.organizationId !== auth.organizationId) throw new Error("Tax configuration not found");
        taxConfigs.set(item.taxConfigurationId, gstRateBp(config, interState));
      }
      gstBasisPoints = taxConfigs.get(item.taxConfigurationId)!;
    }

    // Billing at anything other than the item's saved selling price (including
    // by rate per gram when it has one) is a price override: Owner/Admin only, audit-logged.
    const savedPricePaise = boxEntry ? boxEntry.salePricePaise : product.salePricePaise;
    const priceOverridden = savedPricePaise !== undefined && savedPricePaise > 0 ? unitPricePaise !== savedPricePaise : unitPricePaise > 0;
    if (priceOverridden) {
      if (!canOverridePrice(auth.role)) {
        throw new Error(
          savedPricePaise
            ? `Only the Owner or an Admin can change the saved selling price of "${label}".`
            : `Only the Owner or an Admin can set a fixed price for "${label}" — it has no saved selling price.`,
        );
      }
      overrides.push({ productId: product._id, label, savedPricePaise: savedPricePaise ?? null, billedPricePaise: unitPricePaise || null });
    }

    let makingChargePaise = item.makingChargePaise;
    if (item.makingChargeMode) {
      const value = item.makingChargeValue ?? 0;
      if (!Number.isSafeInteger(value) || value < 0 || (item.makingChargeMode === "percent" && value > 10000)) throw new Error(`Making charge for "${label}" must be a valid amount${item.makingChargeMode === "percent" ? " between 0 and 100%" : ""}.`);
      // % making is on the metal value: fixed price × pieces, else net weight × rate.
      const metalValue = unitPricePaise > 0 ? unitPricePaise * pieces : metalValuePaise(netWeightMg, item.ratePerGramPaise);
      makingChargePaise = makingChargeFor(item.makingChargeMode, value, netWeightMg, metalValue);
    }
    if (!Number.isSafeInteger(makingChargePaise) || makingChargePaise < 0) throw new Error(`Making charge for "${label}" must be zero or more.`);

    const computed = computeSaleLine({
      unitPricePaise,
      pieces,
      grossWeightMg,
      stoneWeightMg,
      stockNetWeightMg: netWeightMg,
      otherDeductionMg: 0,
      ratePerGramPaise: item.ratePerGramPaise,
      wastageBasisPoints: item.wastageBasisPoints,
      makingChargePaise,
      stoneChargePaise: item.stoneChargePaise,
      gstBasisPoints,
      lineDiscountPaise: checkedDiscount(item.lineDiscountPaise),
    });
    const costPerPiecePaise = boxEntry ? boxEntry.purchasePricePaise : product.purchasePricePaise;
    computedLines.push({ item, box, boxItem, boxEntry, product, productId: product._id, label, metal, grossWeightMg, stoneWeightMg, pieces, priceOverridden, costPerPiecePaise, computed });
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
    if (!purity || purity.deletedAt || purity.organizationId !== auth.organizationId) throw new Error("Metal purity not found");
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

  const oldItemDeductionPaise = args.oldItemDeductionPaise ?? 0;
  if (!Number.isSafeInteger(oldItemDeductionPaise) || oldItemDeductionPaise < 0) {
    throw new Error("Old item deduction must be a valid amount of zero or more.");
  }
  const beforeOldItemDeductionPaise = itemsSubtotalPaise - discountPaise + itemsTaxPaise;
  if (oldItemDeductionPaise > beforeOldItemDeductionPaise) {
    throw new Error("Old item deduction cannot exceed the bill amount after discount.");
  }

  const preRoundTotal = beforeOldItemDeductionPaise - oldItemDeductionPaise;
  const roundedTotalPaise = preRoundTotal;
  const roundOffPaise = 0;

  const paymentsTotalPaise = args.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const amountPaidPaise = paymentsTotalPaise + (oldGoldComputed?.exchangeValuePaise ?? 0);
  if (amountPaidPaise < 0 || amountPaidPaise > roundedTotalPaise) {
    throw new Error("Total payments (including any old gold exchange) cannot exceed the invoice total");
  }
  for (const p of args.payments) {
    if (p.amountPaise <= 0) throw new Error("Each payment split must be greater than zero");
  }

  await ctx.db.patch(saleId, {
    customerId: args.customerId,
    isGst: args.isGst,
    stateOfSupply: args.stateOfSupply?.trim() || undefined,
    subtotalPaise: itemsSubtotalPaise,
    discountPaise,
    oldItemDeductionPaise,
    oldItemDeductionNote: oldItemDeductionPaise > 0 ? args.oldItemDeductionNote?.trim().slice(0, 80) || undefined : undefined,
    taxPaise: itemsTaxPaise,
    roundOffPaise,
    totalPaise: roundedTotalPaise,
    amountPaidPaise,
    createdAt: billDate,
  });

  for (const { item, box, boxItem, boxEntry, product, productId, label, metal, grossWeightMg, stoneWeightMg, pieces, priceOverridden, costPerPiecePaise, computed } of computedLines) {
    // Stock comes out of the item's row in the box (or the box's unassigned older stock when that row is empty).
    const stockEntry = box ? await entryForRemoval(ctx, box, boxEntry, grossWeightMg, pieces) : null;
    await ctx.db.insert("saleItems", {
      organizationId: auth.organizationId,
      saleId,
      productId,
      boxItemId: boxItem ? boxItem._id : undefined,
      // Box and item-stock lines record what left stock, so a reversal puts back exactly that.
      ...(box ? { boxId: box._id, pieces, stockWeightMg: grossWeightMg, boxEntryId: stockEntry?._id, stockNetWeightMg: stockEntry ? computed.netWeightMg : undefined } : { fromItemStock: true, pieces, stockWeightMg: grossWeightMg }),
      label,
      metal,
      hsnCode: boxEntry?.hsnCode,
      // Fall back to the item's saved purity so the invoice always shows it.
      metalPurityId: item.metalPurityId ?? product.metalPurityId,
      grossWeightMg,
      stoneWeightMg,
      otherDeductionMg: item.otherDeductionMg,
      netWeightMg: computed.netWeightMg,
      ratePerGramPaise: item.ratePerGramPaise,
      wastageBasisPoints: item.wastageBasisPoints,
      makingChargePaise: computed.makingChargePaise,
      makingChargeMode: item.makingChargeMode,
      makingChargeValue: item.makingChargeMode ? item.makingChargeValue ?? 0 : undefined,
      stoneChargePaise: item.stoneChargePaise,
      taxConfigurationId: item.taxConfigurationId,
      lineTaxPaise: computed.lineTaxPaise,
      lineDiscountPaise: computed.lineDiscountPaise || undefined,
      lineTotalPaise: computed.lineTotalPaise,
      unitPricePaise: item.unitPricePaise || undefined,
      // Cost at the time of sale (per-piece purchase price × pieces), for profit reports.
      purchasePricePaise: costPerPiecePaise !== undefined ? costPerPiecePaise * pieces : undefined,
      priceOverridden: priceOverridden || undefined,
    });

    const allowNegative = !prefs.stopSaleOnNegativeStock;
    if (!box) {
      // Loose GST line: the bill is priced on net weight, but the whole piece
      // (gross weight) leaves item stock.
      await changeItemStock(ctx, { organizationId: auth.organizationId, productId, weightDeltaMg: -grossWeightMg, piecesDelta: -pieces, sourceTable: "sales", sourceId: saleId, at: billDate, allowNegative });
      continue;
    }
    // Box line: the gross weight (and pieces) leave the box. Must run before
    // an old piece is marked sold — a box without a running balance yet is
    // valued from its in-stock pieces.
    await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: box._id, boxEntryId: stockEntry?._id, weightDeltaMg: -grossWeightMg, netDeltaMg: stockEntry ? -computed.netWeightMg : undefined, piecesDelta: -pieces, productId, sourceTable: "sales", sourceId: saleId, at: billDate, allowNegative });
    if (boxItem) await ctx.db.patch(boxItem._id, { status: "sold" });
  }

  for (const o of overrides) {
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "sale.price_override",
      entityTable: "sales",
      entityId: saleId,
      metadata: o,
      createdAt: Date.now(),
    });
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
    createdAt: billDate,
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
      createdAt: billDate,
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
      createdAt: billDate,
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
      createdAt: billDate,
    });
  }

  return { totalPaise: roundedTotalPaise, itemCount: args.items.length };
}

/**
 * Reverses every effect a prior applySaleTransaction call wrote for this
 * sale: physical items go back in stock, the customer ledger gets an
 * offsetting entry, and the old payment/old-gold rows are removed. Used
 * only by `update`, right before re-running applySaleTransaction with the
 * edited values — never exposed directly, since an un-reapplied reversal
 * would leave the sale row's totals stale.
 */
async function reverseSaleTransaction(ctx: MutationCtx, auth: AuthContext, sale: Doc<"sales">, retainLines = false, reversedAt = Date.now()) {
  const saleItems = await ctx.db
    .query("saleItems")
    .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

  for (const item of saleItems) {
    if (item.boxId) {
      // Daily Sales line: put the gross weight and pieces back into its box.
      const boxEntryId = await entryForStockBack(ctx, { organizationId: auth.organizationId, boxId: item.boxId, productId: item.productId, boxEntryId: item.boxEntryId });
      await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: item.boxId, boxEntryId, weightDeltaMg: item.stockWeightMg ?? item.grossWeightMg, netDeltaMg: item.stockNetWeightMg, piecesDelta: item.pieces ?? 0, productId: item.productId, sourceTable: "sales", sourceId: sale._id, at: reversedAt });
      if (item.boxItemId) await ctx.db.patch(item.boxItemId, { status: "in_stock" });
    } else if (item.boxItemId) {
      // Line saved before box stock was a running balance: one whole piece.
      const boxItem = await ctx.db.get(item.boxItemId);
      if (boxItem && boxItem.status === "sold") {
        await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: boxItem.boxId, weightDeltaMg: boxItem.grossWeightMg, piecesDelta: 1, productId: boxItem.productId, sourceTable: "sales", sourceId: sale._id, at: reversedAt });
        await ctx.db.patch(boxItem._id, { status: "in_stock" });
      }
    }
    if (item.fromItemStock) {
      // GST line: put the sold weight and pieces back into item stock.
      await changeItemStock(ctx, { organizationId: auth.organizationId, productId: item.productId, weightDeltaMg: item.stockWeightMg ?? item.netWeightMg, piecesDelta: item.pieces ?? 1, sourceTable: "sales", sourceId: sale._id, at: reversedAt });
    }
    if (!retainLines) await ctx.db.patch(item._id, { deletedAt: reversedAt });
  }

  const customer = await ctx.db.get(sale.customerId);
  if (customer) {
    const priorBalance = customer.currentBalancePaise ?? customer.openingBalancePaise;
    const revertedBalance = priorBalance - sale.totalPaise + sale.amountPaidPaise;
    await ctx.db.insert("customerLedgerEntries", {
      organizationId: auth.organizationId,
      customerId: sale.customerId,
      sourceTable: "sales",
      sourceId: sale._id,
      debitPaise: sale.amountPaidPaise,
      creditPaise: sale.totalPaise,
      balancePaise: revertedBalance,
      createdAt: reversedAt,
    });
    await ctx.db.patch(sale.customerId, { currentBalancePaise: revertedBalance });
  }

  const oldPayments = await ctx.db
    .query("payments")
    .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
    .filter((q) => q.and(q.eq(q.field("sourceTable"), "sales"), q.eq(q.field("sourceId"), sale._id)))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  for (const payment of oldPayments) await ctx.db.patch(payment._id, { deletedAt: reversedAt });

  const oldExchange = await ctx.db
    .query("oldGoldExchanges")
    .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
  if (oldExchange) {
    const exchangePayments = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.and(q.eq(q.field("sourceTable"), "old_gold_exchanges"), q.eq(q.field("sourceId"), oldExchange._id)))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    for (const payment of exchangePayments) await ctx.db.patch(payment._id, { deletedAt: reversedAt });
    await ctx.db.patch(oldExchange._id, { deletedAt: reversedAt });
  }
}

export const create = mutation({
  args: {
    invoiceNumber: v.optional(v.string()),
    customerId: v.id("customers"),
    isGst: v.boolean(),
    stateOfSupply: v.optional(v.string()), // bill's place of supply; decides IGST vs CGST + SGST
    items: v.array(saleLineValidator),
    discountMode: v.union(v.literal("percent"), v.literal("fixed"), v.literal("none")),
    discountValue: v.number(), // basis points if percent, paise if fixed
    oldItemDeductionPaise: v.optional(v.number()),
    oldItemDeductionNote: v.optional(v.string()),
    payments: v.array(paymentSplitValidator),
    oldGoldExchange: v.optional(oldGoldExchangeValidator),
    billDate: v.optional(v.number()),
    idempotencyKey: v.string(),
    // The held bill this sale was finished from; it is removed once the sale is booked.
    heldBillId: v.optional(v.id("heldBills")),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["billing_operator"]);
    const company = await ctx.db.get(auth.organizationId);
    if (company?.companyType === "daily_sales" && args.isGst) throw new Error("GST invoices belong in a GST company. Switch companies before creating this bill.");
    if ((company?.companyType === "gst_gold" || company?.companyType === "gst_silver") && !args.isGst) throw new Error("This is a GST company. GST billing must stay enabled.");

    const existing = await ctx.db
      .query("sales")
      .withIndex("by_org_and_idempotency", (q) =>
        q.eq("organizationId", auth.organizationId).eq("idempotencyKey", args.idempotencyKey),
      )
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existing) return { saleId: existing._id, duplicate: true };

    const branchId = await resolveBranchId(ctx, auth.organizationId, auth.branchId);
    let invoiceNumber = args.invoiceNumber?.trim();
    if (invoiceNumber && !/^\d+$/.test(invoiceNumber)) throw new Error("Invoice number must contain digits only.");
    if (!invoiceNumber) {
      // Auto-numbering path: the while-loop below already guarantees the generated
      // number isn't in `usedNumbers`, so skip the redundant assertUniqueInvoice
      // scan afterwards — this table scan is the only one needed.
      const existingNumbers = (await ctx.db.query("sales").withIndex("by_org", q => q.eq("organizationId", auth.organizationId)).collect()).map(row => row.invoiceNumber);
      const usedNumbers = new Set(existingNumbers.map((number) => number.toLowerCase()));
      const highestSerial = existingNumbers.reduce((highest, number) => {
        if (!/^\d+$/.test(number)) return highest;
        const serial = Number(number);
        return Number.isSafeInteger(serial) ? Math.max(highest, serial) : highest;
      }, 0);
      do {
        invoiceNumber = await allocateInvoiceNumber(ctx, auth.organizationId, branchId, "sales_invoice", "");
      } while (usedNumbers.has(invoiceNumber.toLowerCase()) || Number(invoiceNumber) <= highestSerial);
    } else {
      await assertUniqueInvoice(ctx, auth.organizationId, invoiceNumber);
    }
    const billDate = args.billDate ?? Date.now();
    await assertBookingYearOpen(ctx, auth.organizationId, billDate);

    const saleId = await ctx.db.insert("sales", {
      organizationId: auth.organizationId,
      branchId,
      customerId: args.customerId,
      documentType: "sales_invoice",
      invoiceNumber,
      status: "finalized",
      isGst: args.isGst,
      subtotalPaise: 0,
      discountPaise: 0,
      oldItemDeductionPaise: 0,
      taxPaise: 0,
      roundOffPaise: 0,
      totalPaise: 0,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: billDate,
    });

    const result = await applySaleTransaction(ctx, auth, saleId, args, billDate);

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "sale.create",
      entityTable: "sales",
      entityId: saleId,
      metadata: { invoiceNumber, totalPaise: result.totalPaise, itemCount: result.itemCount },
      createdAt: Date.now(),
    });

    if (args.heldBillId) {
      const held = await ctx.db.get(args.heldBillId);
      if (held && held.organizationId === auth.organizationId) await ctx.db.delete(held._id);
    }

    return { saleId, duplicate: false };
  },
});

/**
 * Owner/Admin only: edits an already-finalized sales invoice. Reverses the
 * original stock and ledger effects, then reapplies the edited values —
 * so stock counts and the customer's balance always reflect the latest
 * edit, never a stale mix of old and new.
 */
export const update = mutation({
  args: {
    invoiceNumber: v.optional(v.string()),
    saleId: v.id("sales"),
    customerId: v.id("customers"),
    isGst: v.boolean(),
    stateOfSupply: v.optional(v.string()), // bill's place of supply; decides IGST vs CGST + SGST
    items: v.array(saleLineValidator),
    discountMode: v.union(v.literal("percent"), v.literal("fixed"), v.literal("none")),
    discountValue: v.number(),
    oldItemDeductionPaise: v.optional(v.number()),
    oldItemDeductionNote: v.optional(v.string()),
    payments: v.array(paymentSplitValidator),
    oldGoldExchange: v.optional(oldGoldExchangeValidator),
    billDate: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const company = await ctx.db.get(auth.organizationId);
    if (company?.companyType === "daily_sales" && args.isGst) throw new Error("GST invoices belong in a GST company. Switch companies before editing this bill.");
    if ((company?.companyType === "gst_gold" || company?.companyType === "gst_silver") && !args.isGst) throw new Error("This is a GST company. GST billing must stay enabled.");

    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.deletedAt || sale.organizationId !== auth.organizationId) throw new Error("Not found");
    if (sale.documentType !== "sales_invoice") throw new Error("Only a finalized sales invoice can be edited");
    if (sale.status !== "finalized") throw new Error("Cannot edit a cancelled invoice");
    await assertBookingYearOpen(ctx, auth.organizationId, args.billDate);

    if (args.invoiceNumber !== undefined) {
      const invoiceNumber = args.invoiceNumber.trim();
      if (!invoiceNumber) throw new Error("Invoice number is required");
      if (invoiceNumber !== sale.invoiceNumber && !/^\d+$/.test(invoiceNumber)) throw new Error("New invoice numbers must contain digits only.");
      await assertUniqueInvoice(ctx, auth.organizationId, invoiceNumber, sale._id);
      await ctx.db.patch(sale._id, { invoiceNumber });
    }
    await assertNoReturnedLines(ctx, sale._id);
    await reverseSaleTransaction(ctx, auth, sale);
    const result = await applySaleTransaction(ctx, auth, args.saleId, args, args.billDate);

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "sale.update",
      entityTable: "sales",
      entityId: args.saleId,
      metadata: { invoiceNumber: sale.invoiceNumber, totalPaise: result.totalPaise, itemCount: result.itemCount },
      createdAt: Date.now(),
    });

    return { saleId: args.saleId };
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
  lineDiscountPaise: v.optional(v.number()),
});

const ESTIMATE_PREFIX: Record<string, string> = {
  quotation: "QUO-",
  proforma_invoice: "PI-",
  sales_order: "SO-",
  delivery_challan: "DC-",
};

/**
 * Quotations, proforma invoices, sale orders and delivery challans are non-binding documents: no stock
 * leaves a box, no customer ledger entry is written, no payment is
 * recorded. They reuse the sales/saleItems tables (boxItemId stays unset)
 * purely so printing, sharing and listing can reuse the same code as a
 * real invoice.
 */
export const createEstimate = mutation({
  args: {
    documentType: v.union(v.literal("quotation"), v.literal("proforma_invoice"), v.literal("sales_order"), v.literal("delivery_challan")),
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existing) return { saleId: existing._id, duplicate: true };

    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.deletedAt || customer.organizationId !== auth.organizationId) throw new Error("Customer not found");
    const interState = isInterState(customer.state, (await ctx.db.get(auth.organizationId))?.state);

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
          if (!config || config.deletedAt || config.organizationId !== auth.organizationId) throw new Error("Tax configuration not found");
          taxConfigs.set(item.taxConfigurationId, gstRateBp(config, interState));
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
        lineDiscountPaise: checkedDiscount(item.lineDiscountPaise),
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
    const roundedTotalPaise = preRoundTotal;
  const roundOffPaise = 0;

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
      oldItemDeductionPaise: 0,
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
        lineDiscountPaise: computed.lineDiscountPaise || undefined,
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
    boxAssignments: v.array(v.object({ saleItemId: v.id("saleItems"), boxId: v.id("boxes") })),
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existing) return { saleId: existing._id, duplicate: true };

    const originalSale = await ctx.db.get(args.originalSaleId);
    if (!originalSale || originalSale.deletedAt || originalSale.organizationId !== auth.organizationId) {
      throw new Error("Original invoice not found");
    }
    const customer = await ctx.db.get(originalSale.customerId);
    if (!customer) throw new Error("Customer not found");

    if (args.boxAssignments.length !== args.saleItemIds.length || new Set(args.boxAssignments.map((assignment) => assignment.saleItemId)).size !== args.saleItemIds.length) {
      throw new Error("Choose a physical box for each item being returned.");
    }
    const boxBySaleItem = new Map(args.boxAssignments.map((assignment) => [assignment.saleItemId, assignment.boxId]));
    const lines: Array<{ saleItem: Doc<"saleItems">; boxItem: Doc<"boxItems"> | null; box: Doc<"boxes"> }> = [];
    for (const saleItemId of args.saleItemIds) {
      const saleItem = await ctx.db.get(saleItemId);
      if (!saleItem || saleItem.deletedAt || saleItem.saleId !== args.originalSaleId) throw new Error("Return item not found on this invoice");
      let boxItem: Doc<"boxItems"> | null = null;
      if (saleItem.boxId) {
        if (saleItem.returnedAt) throw new Error(`"${saleItem.label ?? "This item"}" has already been returned`);
      } else {
        if (!saleItem.boxItemId) throw new Error("This line has no box stock to return");
        boxItem = await ctx.db.get(saleItem.boxItemId);
        if (!boxItem) throw new Error("Original item not found");
        if (boxItem.status !== "sold") throw new Error(`"${boxItem.label}" has already been returned or is not sold`);
      }
      const boxId = boxBySaleItem.get(saleItemId);
      if (!boxId) throw new Error("Select an active box in this company for every returned item.");
      const box = await getCompanyBox(ctx, auth.organizationId, boxId);
      assertBoxMetal(box, saleItem.metal);
      lines.push({ saleItem, boxItem, box });
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
      oldItemDeductionPaise: 0,
      taxPaise: 0,
      roundOffPaise: 0,
      totalPaise: returnValuePaise,
      amountPaidPaise: 0,
      idempotencyKey: args.idempotencyKey,
      createdByUserId: auth.userId,
      createdAt: now,
    });

    for (const { saleItem, boxItem, box } of lines) {
      const stockWeightMg = saleItem.boxId ? saleItem.stockWeightMg ?? saleItem.grossWeightMg : boxItem!.grossWeightMg;
      const pieces = saleItem.boxId ? saleItem.pieces ?? 0 : 1;
      const boxEntryId = await entryForStockBack(ctx, { organizationId: auth.organizationId, boxId: box._id, productId: saleItem.productId, boxEntryId: saleItem.boxEntryId });
      await ctx.db.insert("saleItems", {
        organizationId: auth.organizationId,
        saleId: returnId,
        productId: saleItem.productId,
        boxItemId: saleItem.boxItemId,
        // The return line records the box the stock went back into, so cancelling the return takes it out of that box.
        boxId: box._id,
        pieces,
        stockWeightMg,
        boxEntryId,
        stockNetWeightMg: boxEntryId ? saleItem.stockNetWeightMg : undefined,
        returnOfSaleItemId: saleItem._id,
        label: saleItem.label ?? boxItem?.label,
        metal: saleItem.metal,
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
        lineDiscountPaise: saleItem.lineDiscountPaise,
        lineTotalPaise: saleItem.lineTotalPaise,
      });
      // Stock first: an old box without a running balance is valued from its in-stock pieces.
      await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: box._id, boxEntryId, weightDeltaMg: stockWeightMg, netDeltaMg: boxEntryId ? saleItem.stockNetWeightMg : undefined, piecesDelta: pieces, productId: saleItem.productId, sourceTable: "sales", sourceId: returnId, at: now });
      if (boxItem) await ctx.db.patch(boxItem._id, { boxId: box._id, status: "in_stock" });
      await ctx.db.patch(saleItem._id, { returnedAt: now });
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

/** A bill whose items came back through a sales return can't be edited or cancelled until that return is cancelled. */
async function assertNoReturnedLines(ctx: MutationCtx, saleId: Id<"sales">) {
  const lines = await ctx.db.query("saleItems").withIndex("by_sale", (q) => q.eq("saleId", saleId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect();
  for (const line of lines) {
    // Older one-piece lines were returned by putting the piece back in stock.
    const piece = line.boxItemId && !line.boxId ? await ctx.db.get(line.boxItemId) : null;
    if (line.returnedAt || (piece && piece.status !== "sold")) {
      throw new Error(`"${line.label ?? piece?.label ?? "An item"}" on this bill was returned. Cancel that return first.`);
    }
  }
}

async function assertUniqueInvoice(ctx: MutationCtx, organizationId: Id<"organizations">, number: string, except?: Id<"sales">) {
  if (number.length > 60) throw new Error("Invoice number must be 60 characters or fewer");
  const rows = await ctx.db.query("sales").withIndex("by_org", q => q.eq("organizationId", organizationId))
      .collect();
  if (rows.some(row => row._id !== except && row.invoiceNumber.toLowerCase() === number.toLowerCase())) throw new Error("Invoice number already exists");
}
export const cancel = mutation({
  args: { saleId: v.id("sales"), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx); requireRole(auth, []);
    const sale = await ctx.db.get(args.saleId);
    if (!sale || sale.deletedAt || sale.organizationId !== auth.organizationId) throw new Error("Invoice not found");
    if (sale.status !== "finalized") throw new Error("This document is already deleted");
    if (!args.reason.trim()) throw new Error("Please enter a reason");
    if (sale.documentType !== "sales_invoice") {
      if (sale.documentType === "sales_return" || sale.documentType === "credit_note") {
        const items = await ctx.db.query("saleItems").withIndex("by_sale", q => q.eq("saleId", sale._id)).filter(q => q.eq(q.field("deletedAt"), undefined)).collect();
        const now = Date.now();
        for (const item of items) {
          if (item.boxId) {
            // Take the returned weight back out of the box it went into (throws if it has since been sold).
            await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: item.boxId, boxEntryId: item.boxEntryId, weightDeltaMg: -(item.stockWeightMg ?? item.grossWeightMg), netDeltaMg: item.stockNetWeightMg !== undefined ? -item.stockNetWeightMg : undefined, piecesDelta: -(item.pieces ?? 0), productId: item.productId, sourceTable: "sales", sourceId: sale._id, at: now });
            if (item.boxItemId) await ctx.db.patch(item.boxItemId, { status: "sold" });
            if (item.returnOfSaleItemId) await ctx.db.patch(item.returnOfSaleItemId, { returnedAt: undefined });
          } else if (item.boxItemId) {
            const stock = await ctx.db.get(item.boxItemId);
            if (!stock || stock.deletedAt || stock.status !== "in_stock") throw new Error("Returned stock has already moved. Reverse the later transaction first.");
            await changeBoxStock(ctx, { organizationId: auth.organizationId, boxId: stock.boxId, weightDeltaMg: -stock.grossWeightMg, piecesDelta: -1, productId: stock.productId, sourceTable: "sales", sourceId: sale._id, at: now });
            await ctx.db.patch(stock._id, { status: "sold" });
          }
        }
        const customer = await ctx.db.get(sale.customerId);
        if (!customer) throw new Error("Customer not found");
        const balancePaise = (customer.currentBalancePaise ?? customer.openingBalancePaise) + sale.totalPaise;
        await ctx.db.insert("customerLedgerEntries", { organizationId: auth.organizationId, customerId: sale.customerId, sourceTable: "sales", sourceId: sale._id, debitPaise: sale.totalPaise, creditPaise: 0, balancePaise, createdAt: Date.now() });
        await ctx.db.patch(sale.customerId, { currentBalancePaise: balancePaise });
      }
      await ctx.db.patch(sale._id, { status: "cancelled", cancelledAt: Date.now(), deletedAt: Date.now(), cancelReason: args.reason });
      await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: "sale.soft_delete", entityTable: "sales", entityId: sale._id, metadata: { reason: args.reason }, createdAt: Date.now() });
      return;
    }
    await assertNoReturnedLines(ctx, sale._id);
    // Older piece lines: the piece must still be sold (not already brought back some other way).
    const items = await ctx.db.query("saleItems").withIndex("by_sale", q => q.eq("saleId", sale._id)).filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const legacyLines = items.filter((item) => item.boxItemId && !item.boxId);
    if (legacyLines.length) {
      const [returns, creditNotes] = await Promise.all([
        ctx.db.query("sales").withIndex("by_org_and_type", q => q.eq("organizationId", auth.organizationId).eq("documentType", "sales_return")).collect(),
        ctx.db.query("sales").withIndex("by_org_and_type", q => q.eq("organizationId", auth.organizationId).eq("documentType", "credit_note")).collect(),
      ]);
      const activeReturnIds = new Set([...returns, ...creditNotes].filter(row => !row.deletedAt && row.status === "finalized").map(row => row._id as string));
      for (const item of legacyLines) {
        const stock = await ctx.db.get(item.boxItemId!);
        const returnedIn = await ctx.db.query("stockMovements").withIndex("by_org", q => q.eq("organizationId", auth.organizationId))
          .filter(q => q.and(q.eq(q.field("boxItemId"), item.boxItemId), q.eq(q.field("direction"), "in"), q.eq(q.field("sourceTable"), "sales"))).collect();
        if (!stock || stock.status !== "sold" || returnedIn.some(m => activeReturnIds.has(m.sourceId))) throw new Error("This invoice has returned or changed stock; reverse the related transaction first");
      }
    }
    const cancelledAt = Date.now();
    await reverseSaleTransaction(ctx, auth, sale, true, cancelledAt);
    await ctx.db.patch(sale._id, { status: "cancelled", cancelledAt, deletedAt: cancelledAt, cancelReason: args.reason.trim() });
    await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: "sale.cancel", entityTable: "sales", entityId: sale._id, metadata: { reason: args.reason }, createdAt: Date.now() });
  },
});
