/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/** A GST jewellery shop with an owner and a billing operator. */
async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const operatorId = await ctx.db.insert("users", { name: "Counter" });
    const org = await ctx.db.insert("organizations", { name: "NRK GST", companyType: "gst_gold", state: "Karnataka", gstin: "29ABCDE1234F1Z5", createdAt: 1 });
    await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
    await ctx.db.insert("memberships", { userId: ownerId, organizationId: org, role: "owner", status: "active", createdAt: 1 });
    await ctx.db.insert("memberships", { userId: operatorId, organizationId: org, role: "billing_operator", status: "active", createdAt: 1 });
    for (const userId of [ownerId, operatorId]) await ctx.db.insert("currentOrganizations", { userId, organizationId: org, updatedAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: org, name: "Asha", state: "Karnataka", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const outsider = await ctx.db.insert("customers", { organizationId: org, name: "Ravi", state: "Kerala", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplier = await ctx.db.insert("suppliers", { organizationId: org, name: "Wholesaler", state: "Karnataka", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const gst3 = await ctx.db.insert("taxConfigurations", { organizationId: org, name: "GST 3%", cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 300, isActive: true });
    return { ownerId, operatorId, org, customer, outsider, supplier, gst3 };
  });
  return {
    t,
    owner: t.withIdentity({ subject: `${data.ownerId}|s` }),
    operator: t.withIdentity({ subject: `${data.operatorId}|s` }),
    ...data,
  };
}

const bill = { discountMode: "none" as const, discountValue: 0, payments: [] };
const priced = { otherDeductionMg: 0, ratePerGramPaise: 0, wastageBasisPoints: 0, makingChargePaise: 0, stoneChargePaise: 0 };

async function ringInBox(f: Awaited<ReturnType<typeof fixture>>, opening = 2) {
  const boxId = await f.owner.mutation(api.boxes.createNext, { boxNumber: 201, label: "22K rings", category: "Ring Box", boxType: "Display Tray", description: "Front counter" });
  const productId = await f.owner.mutation(api.products.create, {
    name: "Ladies Ring", unit: "piece", sku: "LR-01", hsnCode: "7113", purityKarat: "22K",
    grossWeightMg: 5000, stoneWeightMg: 500, wastageBasisPoints: 800, makingChargePaise: 50000,
    salePricePaise: 4_000_000, purchasePricePaise: 3_500_000, taxConfigurationId: f.gst3,
    defaultBoxId: boxId, openingPieces: opening,
  });
  const pieces = await f.owner.query(api.boxes.getItems, { boxId });
  return { boxId, productId, pieces };
}

describe("Item master", () => {
  it("saves karat purity, stone weight, wastage and box, and puts opening pieces into the box", async () => {
    const f = await fixture();
    const { boxId, productId, pieces } = await ringInBox(f);
    const product = await f.t.run((ctx) => ctx.db.get(productId));
    expect(product).toMatchObject({ grossWeightMg: 5000, stoneWeightMg: 500, netWeightMg: 4500, wastageBasisPoints: 800, defaultBoxId: boxId });
    const purity = await f.t.run((ctx) => ctx.db.get(product!.metalPurityId!));
    expect(purity).toMatchObject({ metal: "gold", label: "22K", purityBasisPoints: 9160 });
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ grossWeightMg: 5000, stoneWeightMg: 500, netWeightMg: 4500 });
    const box = await f.t.run((ctx) => ctx.db.get(boxId));
    expect(box).toMatchObject({ itemCount: 2, category: "Ring Box", boxType: "Display Tray", description: "Front counter" });
    // Same karat again reuses the purity row.
    const second = await f.owner.mutation(api.products.create, { name: "Chain", unit: "piece", purityKarat: "22K" });
    expect((await f.t.run((ctx) => ctx.db.get(second)))?.metalPurityId).toBe(product!.metalPurityId);
  });

  it("supports an 'Other' purity and rejects impossible weights", async () => {
    const f = await fixture();
    const id = await f.owner.mutation(api.products.create, { name: "Antique pendant", unit: "piece", purityOther: "23K hallmark" });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.purityOther).toBe("23K hallmark");
    await expect(f.owner.mutation(api.products.create, { name: "Bad", unit: "piece", grossWeightMg: 1000, stoneWeightMg: 2000 })).rejects.toThrow();
    await expect(f.owner.mutation(api.products.create, { name: "Bad 2", unit: "piece", wastageBasisPoints: 20000 })).rejects.toThrow();
  });

  it("hides the purchase price from the billing counter", async () => {
    const f = await fixture();
    const { productId } = await ringInBox(f, 0);
    const forOperator = (await f.operator.query(api.products.list)).find((p) => p._id === productId);
    expect(forOperator?.purchasePricePaise).toBeUndefined();
    expect(forOperator?.salePricePaise).toBe(4_000_000);
    const forOwner = (await f.owner.query(api.products.list)).find((p) => p._id === productId);
    expect(forOwner?.purchasePricePaise).toBe(3_500_000);
    expect(await f.operator.query(api.products.myPricingAccess)).toEqual({ canViewCost: false, canOverridePrice: false });
  });
});

describe("Box management", () => {
  it("won't deactivate a box that still holds pieces", async () => {
    const f = await fixture();
    const { boxId } = await ringInBox(f);
    await expect(f.owner.mutation(api.boxes.update, { boxId, boxNumber: 201, isActive: false })).rejects.toThrow();
    const empty = await f.owner.mutation(api.boxes.createNext, { boxNumber: 300, category: "Chain Box" });
    await f.owner.mutation(api.boxes.update, { boxId: empty, boxNumber: 300, isActive: false });
    expect((await f.t.run((ctx) => ctx.db.get(empty)))?.isActive).toBe(false);
  });

  it("finds pieces across boxes by item code", async () => {
    const f = await fixture();
    await ringInBox(f);
    const hits = await f.owner.query(api.boxes.searchItems, { term: "LR-01" });
    expect(hits.length).toBe(2);
    expect(hits[0]).toMatchObject({ boxNumber: 201, boxLabel: "22K rings" });
  });
});

describe("Sales billing at the saved selling price", () => {
  it("bills at the item's price per piece, keeps cost off the invoice, and stores a cost snapshot", async () => {
    const f = await fixture();
    const { pieces } = await ringInBox(f);
    const { saleId } = await f.operator.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "s1",
      items: [{ ...priced, boxItemId: pieces[0]._id, unitPricePaise: 4_000_000, taxConfigurationId: f.gst3, lineDiscountPaise: 100_000 }],
    });
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    // ₹40,000 − ₹1,000 line discount = ₹39,000 taxable, 3% GST = ₹1,170.
    expect(invoice.sale).toMatchObject({ subtotalPaise: 3_900_000, taxPaise: 117_000 });
    expect(invoice.items[0]).toMatchObject({ unitPricePaise: 4_000_000, boxNumber: 201, purityLabel: "22K", hsnCode: "7113", sku: "LR-01" });
    expect("purchasePricePaise" in invoice.items[0]).toBe(false);
    expect(((await f.owner.query(api.sales.getItems, { saleId }))[0] as { purchasePricePaise?: number }).purchasePricePaise).toBe(3_500_000);
    expect("purchasePricePaise" in (await f.operator.query(api.sales.getItems, { saleId }))[0]).toBe(false);
  });

  it("lets only the Owner/Admin change the price, and audit-logs it", async () => {
    const f = await fixture();
    const { pieces } = await ringInBox(f);
    await expect(f.operator.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "s-op",
      items: [{ ...priced, boxItemId: pieces[0]._id, unitPricePaise: 3_000_000, taxConfigurationId: f.gst3 }],
    })).rejects.toThrow(/Only the Owner or an Admin/);
    // Billing by rate per gram instead of the saved price is an override too.
    await expect(f.operator.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "s-op2",
      items: [{ ...priced, ratePerGramPaise: 700_000, boxItemId: pieces[0]._id, taxConfigurationId: f.gst3 }],
    })).rejects.toThrow(/Only the Owner or an Admin/);

    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "s-own",
      items: [{ ...priced, boxItemId: pieces[0]._id, unitPricePaise: 3_800_000, taxConfigurationId: f.gst3 }],
    });
    const [item] = await f.owner.query(api.sales.getItems, { saleId });
    expect(item).toMatchObject({ priceOverridden: true, unitPricePaise: 3_800_000, lineTaxPaise: 114_000, lineTotalPaise: 3_914_000 });
    const logs = await f.t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.find((l) => l.action === "sale.price_override")?.metadata).toMatchObject({ savedPricePaise: 4_000_000, billedPricePaise: 3_800_000 });
  });
});

describe("Purchase at a fixed price per piece", () => {
  it("uses the purchase price per piece instead of weight × rate", async () => {
    const f = await fixture();
    const { boxId, productId } = await ringInBox(f, 0);
    const { purchaseId } = await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 300, amountPaidPaise: 0, idempotencyKey: "p1",
      items: [{ productId, boxId, label: "Ladies Ring", grossWeightMg: 5000, stoneWeightMg: 500, ratePerGramPaise: 0, unitPricePaise: 3_500_000, makingChargePaise: 0, stoneChargePaise: 0 }],
    });
    const [line] = await f.owner.query(api.purchases.getItems, { purchaseId });
    expect(line).toMatchObject({ unitPricePaise: 3_500_000, lineTotalPaise: 3_500_000 });
    await expect(f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "p2",
      items: [{ productId, boxId, label: "No price", grossWeightMg: 5000, stoneWeightMg: 0, ratePerGramPaise: 0, makingChargePaise: 0, stoneChargePaise: 0 }],
    })).rejects.toThrow();
  });
});

describe("GST module summary", () => {
  it("splits CGST/SGST vs IGST and nets input tax against output tax", async () => {
    const f = await fixture();
    const { boxId, productId, pieces } = await ringInBox(f);
    await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 300, amountPaidPaise: 0, idempotencyKey: "p-sum",
      items: [{ productId, boxId, label: "Ladies Ring", grossWeightMg: 5000, stoneWeightMg: 500, ratePerGramPaise: 0, unitPricePaise: 1_000_000, makingChargePaise: 0, stoneChargePaise: 0 }],
    });
    await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "s-local",
      items: [{ ...priced, boxItemId: pieces[0]._id, unitPricePaise: 4_000_000, taxConfigurationId: f.gst3 }],
    });
    await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.outsider, isGst: true, stateOfSupply: "Kerala", idempotencyKey: "s-kerala",
      items: [{ ...priced, boxItemId: pieces[1]._id, unitPricePaise: 4_000_000, taxConfigurationId: f.gst3 }],
    });
    const s = await f.owner.query(api.gstReports.moduleSummary, { startDate: 0, endDate: Date.now() + 86_400_000 });
    expect(s.company).toMatchObject({ gstin: "29ABCDE1234F1Z5", state: "Karnataka" });
    expect(s.invoiceCount).toBe(2);
    expect(s.output).toMatchObject({ taxablePaise: 8_000_000, cgstPaise: 60_000, sgstPaise: 60_000, igstPaise: 120_000 });
    expect(s.input).toMatchObject({ taxablePaise: 1_000_000, cgstPaise: 15_000, sgstPaise: 15_000 });
    expect(s.payable).toMatchObject({ cgstPaise: 45_000, sgstPaise: 45_000, igstPaise: 120_000 });
    expect(s.hsn.find((h) => h.hsn === "7113")).toBeTruthy();
    const codes = await f.owner.query(api.gstReports.hsnCodes);
    expect(codes.codes.find((c) => c.hsnCode === "7113")?.items).toContain("Ladies Ring");
  });
});
