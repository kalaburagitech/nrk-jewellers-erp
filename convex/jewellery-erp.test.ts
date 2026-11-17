/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Owner of a Daily Sales shop and a GST shop (Karnataka), plus a billing
 * operator in each — used to check cost visibility and price-override rules.
 */
async function fixture(active: "daily" | "gst") {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const cashierId = await ctx.db.insert("users", { name: "Cashier" });
    const daily = await ctx.db.insert("organizations", { name: "NRK Daily", companyType: "daily_sales", state: "Karnataka", createdAt: 1 });
    const gst = await ctx.db.insert("organizations", { name: "NRK Karakalli Jewellers", companyType: "gst_gold", state: "Karnataka", gstin: "29ABCDE1234F1Z5", createdAt: 2 });
    for (const org of [daily, gst]) {
      await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
      await ctx.db.insert("memberships", { userId: ownerId, organizationId: org, role: "owner", status: "active", createdAt: 1 });
      await ctx.db.insert("memberships", { userId: cashierId, organizationId: org, role: "billing_operator", status: "active", createdAt: 1 });
    }
    const org = active === "gst" ? gst : daily;
    await ctx.db.insert("currentOrganizations", { userId: ownerId, organizationId: org, updatedAt: 1 });
    await ctx.db.insert("currentOrganizations", { userId: cashierId, organizationId: org, updatedAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: org, name: "Asha", state: "Karnataka", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplier = await ctx.db.insert("suppliers", { organizationId: org, name: "Balaji Ornaments", state: "Karnataka", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const gst3 = await ctx.db.insert("taxConfigurations", { organizationId: org, name: "GST 3%", cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 0, hsnCode: "7113", isActive: true });
    const box101 = await ctx.db.insert("boxes", { organizationId: daily, boxNumber: 101, label: "Ring Box", category: "Ring Box", itemCount: 0, isActive: true, createdAt: 1 });
    return { ownerId, cashierId, daily, gst, org, customer, supplier, gst3, box101 };
  });
  return {
    t,
    owner: t.withIdentity({ subject: `${data.ownerId}|s` }),
    cashier: t.withIdentity({ subject: `${data.cashierId}|s` }),
    ...data,
  };
}

const goldRing = {
  name: "Gold Ring",
  sku: "GR-101",
  unit: "piece" as const,
  purityKarat: "22K" as const,
  grossWeightMg: 10000,
  stoneWeightMg: 1000,
  netWeightMg: 9000,
  purchasePricePaise: 5_000_000, // ₹50,000
  sellingPricePaise: 5_500_000, // ₹55,000
  hsnCode: "7113",
};
const noCharges = { otherDeductionMg: 0, ratePerGramPaise: 0, wastageBasisPoints: 0, makingChargePaise: 0, stoneChargePaise: 0 };
const noDiscount = { discountMode: "none" as const, discountValue: 0, payments: [] };

describe("TEST 1 — create a jewellery item with box, purity, weights and both prices", () => {
  it("saves Gold Ring with 22K purity, box 101, 10/9/1 g and ₹50,000 / ₹55,000, and puts opening stock in box 101", async () => {
    const f = await fixture("daily");
    const productId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101, taxConfigurationId: f.gst3, openingStock: 1 });
    const product = (await f.owner.query(api.products.list, {})).find((p) => p._id === productId)!;
    expect(product).toMatchObject({ name: "Gold Ring", purityKarat: "22K", grossWeightMg: 10000, stoneWeightMg: 1000, netWeightMg: 9000, purchasePricePaise: 5_000_000, sellingPricePaise: 5_500_000, defaultBoxId: f.box101 });
    // The karat resolves to a gold purity row, so rates/reports keep working.
    const purities = await f.owner.query(api.metalPurities.list, {});
    expect(purities.find((p) => p._id === product.metalPurityId)).toMatchObject({ label: "22K", metal: "gold" });
    const pieces = await f.owner.query(api.boxes.getItems, { boxId: f.box101 });
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ productId, grossWeightMg: 10000, stoneWeightMg: 1000, netWeightMg: 9000 });
  });

  it("rejects inconsistent weights and negative prices", async () => {
    const f = await fixture("daily");
    await expect(f.owner.mutation(api.products.create, { ...goldRing, stoneWeightMg: 12000, netWeightMg: undefined })).rejects.toThrow(/Stone weight cannot be more/);
    await expect(f.owner.mutation(api.products.create, { ...goldRing, netWeightMg: 9500 })).rejects.toThrow(/Net weight cannot be more/);
    await expect(f.owner.mutation(api.products.create, { ...goldRing, sellingPricePaise: -1 })).rejects.toThrow(/Selling price/);
    await expect(f.owner.mutation(api.products.create, { ...goldRing, openingStock: 2 })).rejects.toThrow(/box for the opening stock/);
  });
});

describe("TEST 2 & 3 — sales pick up saved item details and allow several items per invoice", () => {
  it("bills Gold Ring at its saved selling price, snapshots cost/HSN, and adds a second item on the same invoice", async () => {
    const f = await fixture("daily");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101, openingStock: 1 });
    const chainId = await f.owner.mutation(api.products.create, { name: "Gold Chain", unit: "gram", purityKarat: "22K", grossWeightMg: 8000, stoneWeightMg: 0, defaultBoxId: f.box101, openingStock: 1 });
    const pieces = await f.owner.query(api.boxes.getItems, { boxId: f.box101 });
    const ring = pieces.find((p) => p.productId === ringId)!;
    const chain = pieces.find((p) => p.productId === chainId)!;

    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "two-items",
      items: [
        { ...noCharges, boxItemId: ring._id, unitPricePaise: 5_500_000 },
        { ...noCharges, boxItemId: chain._id, ratePerGramPaise: 700_000, makingChargePaise: 100_000 }, // rate/gram item (no saved price)
      ],
    });
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    expect(invoice.items).toHaveLength(2);
    const ringLine = invoice.items.find((i) => i.productId === ringId)!;
    expect(ringLine).toMatchObject({ unitPricePaise: 5_500_000, lineTotalPaise: 5_500_000, grossWeightMg: 10000, stoneWeightMg: 1000, netWeightMg: 9000, boxNumber: 101, purityLabel: "22K", hsnCode: "7113" });
    // Customer-facing invoice payload never carries the cost.
    expect("purchasePricePaise" in ringLine).toBe(false);
    // 8 g × ₹7,000 + ₹1,000 making
    expect(invoice.items.find((i) => i.productId === chainId)!.lineTotalPaise).toBe(5_700_000);
    expect(invoice.sale.totalPaise).toBe(11_200_000);
    expect(invoice.sale.discountPaise).toBe(0);
    // Owner sees the cost snapshot for profit; the counter does not.
    const ownerLines = await f.owner.query(api.sales.getItems, { saleId });
    expect(ownerLines.find((i) => i.productId === ringId)!.purchasePricePaise).toBe(5_000_000);
    const cashierLines = await f.cashier.query(api.sales.getItems, { saleId });
    expect(cashierLines.every((i) => i.purchasePricePaise === undefined)).toBe(true);
  });

  it("hides purchase price from the billing counter and only lets Owner/Admin override the selling price (audited)", async () => {
    const f = await fixture("daily");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101, openingStock: 2 });
    const cashierView = (await f.cashier.query(api.products.list, {})).find((p) => p._id === ringId)!;
    expect(cashierView.sellingPricePaise).toBe(5_500_000);
    expect(cashierView.purchasePricePaise).toBeUndefined();

    const [a, b] = await f.owner.query(api.boxes.getItems, { boxId: f.box101 });
    await expect(f.cashier.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "cashier-override",
      items: [{ ...noCharges, boxItemId: a._id, unitPricePaise: 5_000_000 }],
    })).rejects.toThrow(/Only the Owner or an Admin/);
    // Billing it by rate/gram instead is also an override.
    await expect(f.cashier.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "cashier-rate",
      items: [{ ...noCharges, boxItemId: a._id, ratePerGramPaise: 100 }],
    })).rejects.toThrow(/Only the Owner or an Admin/);
    // Saved price is fine for the counter.
    await f.cashier.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "cashier-ok",
      items: [{ ...noCharges, boxItemId: a._id, unitPricePaise: 5_500_000 }],
    });

    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "owner-override",
      items: [{ ...noCharges, boxItemId: b._id, unitPricePaise: 5_200_000 }],
    });
    const logs = await f.t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.find((l) => l.action === "sale.price_override" && l.entityId === saleId)?.metadata).toMatchObject({ savedPricePaise: 5_500_000, billedPricePaise: 5_200_000 });
  });
});

describe("TEST 4 — purchase picks up the saved purchase price", () => {
  it("prices a purchase line at unit price × pieces and puts the piece into the chosen box", async () => {
    const f = await fixture("daily");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101 });
    const { purchaseId } = await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 300, amountPaidPaise: 0, idempotencyKey: "pur-ring",
      items: [{ productId: ringId, boxId: f.box101, label: "Gold Ring", grossWeightMg: 10000, stoneWeightMg: 1000, ratePerGramPaise: 0, makingChargePaise: 0, stoneChargePaise: 0, unitPricePaise: 5_000_000 }],
    });
    const items = await f.owner.query(api.purchases.getItems, { purchaseId });
    expect(items[0]).toMatchObject({ unitPricePaise: 5_000_000, lineTotalPaise: 5_000_000, netWeightMg: 9000 });
    const purchase = await f.t.run((ctx) => ctx.db.get(purchaseId));
    expect(purchase).toMatchObject({ subtotalPaise: 5_000_000, taxPaise: 150_000, totalPaise: 5_150_000, isInterState: false });
    expect(await f.owner.query(api.boxes.getItems, { boxId: f.box101 })).toHaveLength(1);
    // Supplier ledger still updated.
    const supplier = await f.t.run((ctx) => ctx.db.get(f.supplier));
    expect(supplier?.currentBalancePaise).toBe(5_150_000);
  });

  it("still requires either a purchase price or a rate per gram", async () => {
    const f = await fixture("daily");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101 });
    await expect(f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "pur-none",
      items: [{ productId: ringId, boxId: f.box101, label: "Gold Ring", grossWeightMg: 10000, stoneWeightMg: 1000, ratePerGramPaise: 0, makingChargePaise: 0, stoneChargePaise: 0 }],
    })).rejects.toThrow(/purchase price or the rate per gram/);
  });
});

describe("TEST 5 — GST calculation and reports", () => {
  it("splits intra-state GST into CGST+SGST, inter-state into IGST, and reports output, input and HSN", async () => {
    const f = await fixture("gst");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, taxConfigurationId: f.gst3, openingStock: 3 });
    const sell = (key: string, stateOfSupply: string) =>
      f.owner.mutation(api.sales.create, {
        ...noDiscount, customerId: f.customer, isGst: true, idempotencyKey: key, stateOfSupply,
        items: [{ ...noCharges, productId: ringId, grossWeightMg: 10000, stoneWeightMg: 1000, pieces: 1, unitPricePaise: 5_500_000, taxConfigurationId: f.gst3 }],
      });
    const intra = await sell("intra", "Karnataka");
    const inter = await sell("inter", "Maharashtra");
    const intraLines = await f.owner.query(api.sales.getItems, { saleId: intra.saleId });
    expect(intraLines[0]).toMatchObject({ lineTaxPaise: 165_000, lineCgstPaise: 82_500, lineSgstPaise: 82_500, lineIgstPaise: 0 });
    const interLines = await f.owner.query(api.sales.getItems, { saleId: inter.saleId });
    expect(interLines[0]).toMatchObject({ lineTaxPaise: 165_000, lineCgstPaise: 0, lineSgstPaise: 0, lineIgstPaise: 165_000 });

    await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 300, amountPaidPaise: 0, idempotencyKey: "gst-pur",
      items: [{ productId: ringId, label: "Gold Ring", pieces: 1, grossWeightMg: 10000, stoneWeightMg: 1000, ratePerGramPaise: 0, makingChargePaise: 0, stoneChargePaise: 0, unitPricePaise: 5_000_000 }],
    });

    const report = await f.owner.query(api.gst.report, { startDate: 0, endDate: Date.now() + 1000 });
    expect(report.sales).toHaveLength(2);
    expect(report.output).toMatchObject({ taxableValuePaise: 11_000_000, cgstPaise: 82_500, sgstPaise: 82_500, igstPaise: 165_000 });
    expect(report.input).toMatchObject({ taxableValuePaise: 5_000_000, cgstPaise: 75_000, sgstPaise: 75_000, igstPaise: 0 });
    expect(report.net).toMatchObject({ cgstPaise: 7_500, sgstPaise: 7_500, igstPaise: 165_000 });
    expect(report.hsnSummary).toEqual([expect.objectContaining({ hsnCode: "7113", ratePercent: 3, pieces: 2, taxableValuePaise: 11_000_000 })]);
    expect(report.company).toMatchObject({ gstin: "29ABCDE1234F1Z5", state: "Karnataka" });
  });
});

describe("TEST 6 — stock deduction and restoration", () => {
  it("GST company: deducts 10 g gross, 9 g net and 1 g stone separately, and restores them on cancel", async () => {
    const f = await fixture("gst");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, openingStock: 2 });
    const before = (await f.owner.query(api.itemStock.list, {})).find((s) => s.productId === ringId)!;
    expect(before).toMatchObject({ grossWeightMg: 20000, stoneWeightMg: 2000, netWeightMg: 18000, pieces: 2 });
    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: true, idempotencyKey: "stock-1",
      items: [{ ...noCharges, productId: ringId, grossWeightMg: 10000, stoneWeightMg: 1000, pieces: 1, unitPricePaise: 5_500_000 }],
    });
    expect((await f.owner.query(api.itemStock.list, {})).find((s) => s.productId === ringId)).toMatchObject({ grossWeightMg: 10000, stoneWeightMg: 1000, netWeightMg: 9000, pieces: 1 });
    await f.owner.mutation(api.sales.cancel, { saleId, reason: "Customer returned" });
    expect((await f.owner.query(api.itemStock.list, {})).find((s) => s.productId === ringId)).toMatchObject({ grossWeightMg: 20000, stoneWeightMg: 2000, netWeightMg: 18000, pieces: 2 });
  });

  it("Daily company: the sold piece leaves box 101 and comes back on cancel; a purchase cancel removes its piece", async () => {
    const f = await fixture("daily");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101, openingStock: 1 });
    const [piece] = await f.owner.query(api.boxes.getItems, { boxId: f.box101 });
    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "box-sale",
      items: [{ ...noCharges, boxItemId: piece._id, unitPricePaise: 5_500_000 }],
    });
    expect(await f.owner.query(api.boxes.getItems, { boxId: f.box101 })).toHaveLength(0);
    expect((await f.owner.query(api.products.getStockSummary, { productId: ringId })).pieces).toBe(0);
    await f.owner.mutation(api.sales.cancel, { saleId, reason: "Mistake" });
    expect(await f.owner.query(api.boxes.getItems, { boxId: f.box101 })).toHaveLength(1);

    const { purchaseId } = await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "box-pur",
      items: [{ productId: ringId, boxId: f.box101, label: "Gold Ring 2", grossWeightMg: 10000, stoneWeightMg: 1000, ratePerGramPaise: 0, makingChargePaise: 0, stoneChargePaise: 0, unitPricePaise: 5_000_000 }],
    });
    expect(await f.owner.query(api.boxes.getItems, { boxId: f.box101 })).toHaveLength(2);
    await f.owner.mutation(api.purchases.cancel, { purchaseId, reason: "Wrong bill" });
    expect(await f.owner.query(api.boxes.getItems, { boxId: f.box101 })).toHaveLength(1);
  });

  it("Adjust Item writes real, audited stock changes", async () => {
    const f = await fixture("daily");
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101 });
    await f.owner.mutation(api.products.adjustStock, { productId: ringId, direction: "add", pieces: 3, reason: "Counter recount" });
    expect((await f.owner.query(api.products.getStockSummary, { productId: ringId })).pieces).toBe(3);
    await f.owner.mutation(api.products.adjustStock, { productId: ringId, direction: "reduce", pieces: 1, reason: "Damaged" });
    const summary = await f.owner.query(api.products.getStockSummary, { productId: ringId });
    expect(summary).toMatchObject({ pieces: 2, grossWeightMg: 20000, netWeightMg: 18000 });
    await expect(f.owner.mutation(api.products.adjustStock, { productId: ringId, direction: "reduce", pieces: 5, reason: "x" })).rejects.toThrow(/Only 2 piece/);
  });
});

describe("TEST 7 — box management relationship", () => {
  it("keeps the item ↔ box link, stores box details, and never creates boxes or pieces when an item is edited", async () => {
    const f = await fixture("daily");
    const chainBox = await f.owner.mutation(api.boxes.createNext, { boxNumber: 102, label: "Chain Box", category: "Chain Box", boxType: "Display Tray", description: "Top counter" });
    const ringId = await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101, openingStock: 1 });
    const summary = await f.owner.query(api.products.getStockSummary, { productId: ringId });
    expect(summary.boxes).toEqual([expect.objectContaining({ boxNumber: 101, label: "Ring Box", pieces: 1 })]);

    const boxCountBefore = (await f.owner.query(api.boxes.list, {})).length;
    await f.owner.mutation(api.products.update, { id: ringId, ...goldRing, sellingPricePaise: 5_600_000, defaultBoxId: chainBox });
    expect((await f.owner.query(api.boxes.list, {})).length).toBe(boxCountBefore);
    expect(await f.owner.query(api.boxes.getItems, { boxId: f.box101 })).toHaveLength(1); // existing piece not moved or duplicated
    expect(await f.owner.query(api.boxes.getItems, { boxId: chainBox })).toHaveLength(0);
    const box = (await f.owner.query(api.boxes.list, {})).find((b) => b._id === chainBox);
    expect(box).toMatchObject({ category: "Chain Box", boxType: "Display Tray", description: "Top counter", isActive: true });

    // Box with pieces cannot be marked inactive; an empty one can.
    await expect(f.owner.mutation(api.boxes.update, { boxId: f.box101, boxNumber: 101, label: "Ring Box", isActive: false })).rejects.toThrow(/Move or sell/);
    await f.owner.mutation(api.boxes.update, { boxId: chainBox, boxNumber: 102, label: "Chain Box", isActive: false });
    // Old "number + label only" edits keep the other details.
    await f.owner.mutation(api.boxes.update, { boxId: chainBox, boxNumber: 102, label: "Chains" });
    expect((await f.owner.query(api.boxes.list, {})).find((b) => b._id === chainBox)).toMatchObject({ label: "Chains", category: "Chain Box", isActive: false });

    // Billing search finds the piece by item code and reports its box.
    const hits = await f.owner.query(api.boxes.searchItems, { term: "gr-101" });
    expect(hits[0]).toMatchObject({ boxNumber: 101, productName: "Gold Ring" });
    expect(hits[0].boxItem.productId).toBe(ringId);
  });
});

describe("TEST 8 — Daily Sales is not part of the GST module, and its records are kept", () => {
  it("excludes non-GST (Daily Sales) bills from GST reports while the sales stay in the sales list", async () => {
    const f = await fixture("daily");
    await f.owner.mutation(api.products.create, { ...goldRing, defaultBoxId: f.box101, openingStock: 1 });
    const [piece] = await f.owner.query(api.boxes.getItems, { boxId: f.box101 });
    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...noDiscount, customerId: f.customer, isGst: false, idempotencyKey: "daily-bill",
      items: [{ ...noCharges, boxItemId: piece._id, unitPricePaise: 5_500_000 }],
    });
    const report = await f.owner.query(api.gst.report, { startDate: 0, endDate: Date.now() + 1000 });
    expect(report.sales).toHaveLength(0);
    expect(report.output.taxableValuePaise).toBe(0);
    const sales = await f.owner.query(api.sales.list, {});
    expect(sales.map((s) => s._id as Id<"sales">)).toContain(saleId);
  });
});
