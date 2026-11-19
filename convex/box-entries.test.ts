/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Items inside a box: Box 105 (gold) holds Necklaces and Small Rings, each
 * with its own HSN, prices and stock. The Item List only names the items.
 */
async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const org = await ctx.db.insert("organizations", { name: "NRK", companyType: "daily_sales", createdAt: 1 });
    await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
    await ctx.db.insert("memberships", { userId, organizationId: org, role: "owner", status: "active", createdAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: org, name: "Asha", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplier = await ctx.db.insert("suppliers", { organizationId: org, name: "Wholesaler", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const ringCat = await ctx.db.insert("stockCategories", { organizationId: org, name: "Ring" });
    const necklace = await ctx.db.insert("products", { organizationId: org, name: "Necklace", unit: "piece", isActive: true, createdAt: 1 });
    const ring = await ctx.db.insert("products", { organizationId: org, name: "Small Ring", unit: "piece", stockCategoryId: ringCat, isActive: true, createdAt: 1 });
    const gold22 = await ctx.db.insert("metalPurities", { organizationId: org, metal: "gold", label: "22K", purityBasisPoints: 9166, isActive: true });
    const gst3 = await ctx.db.insert("taxConfigurations", { organizationId: org, name: "GST 3%", cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 0, isActive: true });
    return { userId, org, customer, supplier, necklace, ring, gold22, gst3 };
  });
  const owner = t.withIdentity({ subject: `${data.userId}|s` });
  const box105 = await owner.mutation(api.boxes.createNext, { boxNumber: 105, metal: "gold", label: "Necklaces" });
  const box110 = await owner.mutation(api.boxes.createNext, { boxNumber: 110, metal: "gold" });
  const necklaceEntry = await owner.mutation(api.boxEntries.add, {
    boxId: box105, productId: data.necklace, metalPurityId: data.gold22, hsnCode: "7113", wastageBasisPoints: 800,
    makingChargeMode: "per_gram", makingChargeValue: 30_000, taxConfigurationId: data.gst3,
    grossWeightMg: 250_000, netWeightMg: 240_000, pieces: 10,
  });
  const ringEntry = await owner.mutation(api.boxEntries.add, {
    boxId: box105, productId: data.ring, metalPurityId: data.gold22, hsnCode: "711319", salePricePaise: 400_000, purchasePricePaise: 350_000,
    saleDiscountMode: "percent", saleDiscountValue: 200, grossWeightMg: 40_000, netWeightMg: 38_000, pieces: 20,
  });
  const box = async (boxId: Id<"boxes">) => (await owner.query(api.boxes.list, {})).find((b) => b._id === boxId)!;
  const entry = async (boxId: Id<"boxes">, productId: Id<"products">) => (await box(boxId)).entries.find((e) => e.productId === productId);
  return { t, owner, box105, box110, necklaceEntry, ringEntry, box, entry, ...data };
}
type F = Awaited<ReturnType<typeof fixture>>;

const ringLine = (f: F, over: Record<string, unknown> = {}) => ({
  boxId: f.box105, productId: f.ring, metal: "gold" as const, metalPurityId: f.gold22,
  grossWeightMg: 4_000, netWeightMg: 3_800, pieces: 2, otherDeductionMg: 0, ratePerGramPaise: 600_000,
  unitPricePaise: 400_000, wastageBasisPoints: 0, makingChargePaise: 0, stoneChargePaise: 0, ...over,
});
const sale = (f: F, items: unknown[], key: string) => ({
  customerId: f.customer, isGst: false, items: items as never, discountMode: "none" as const, discountValue: 0, payments: [], idempotencyKey: key,
});

describe("items inside a box", () => {
  it("a box holds several items, each with its own details and stock; the box total is their sum", async () => {
    const f = await fixture();
    const b = await f.box(f.box105);
    expect({ weightMg: b.weightMg, pieces: b.pieces }).toEqual({ weightMg: 290_000, pieces: 30 });
    expect(b.entries).toHaveLength(2);
    const ring = b.entries.find((e) => e.productId === f.ring)!;
    expect(ring).toMatchObject({ productName: "Small Ring", categoryName: "Ring", hsnCode: "711319", salePricePaise: 400_000, purchasePricePaise: 350_000, weightMg: 40_000, netWeightMg: 38_000, pieces: 20 });
    await expect(f.owner.mutation(api.boxEntries.add, { boxId: f.box105, productId: f.ring, grossWeightMg: 0, netWeightMg: 0, pieces: 0 })).rejects.toThrow("already in Box 105");
  });

  it("a sale takes gross, net and pieces out of that item only, snapshots its HSN and cost, and cancel puts it back", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [ringLine(f)], "s1"));
    expect(await f.entry(f.box105, f.ring)).toMatchObject({ weightMg: 36_000, netWeightMg: 34_200, pieces: 18 });
    expect(await f.entry(f.box105, f.necklace)).toMatchObject({ weightMg: 250_000, pieces: 10 });
    const b = await f.box(f.box105);
    expect({ weightMg: b.weightMg, pieces: b.pieces }).toEqual({ weightMg: 286_000, pieces: 28 });
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    expect(invoice.items[0]).toMatchObject({ hsnCode: "711319", unitPricePaise: 400_000 });
    const [line] = await f.t.run(async (ctx) => ctx.db.query("saleItems").collect());
    expect(line.purchasePricePaise).toBe(700_000); // ₹3,500 × 2 pcs from the box's purchase price
    await f.owner.mutation(api.sales.cancel, { saleId, reason: "mistake" });
    expect(await f.entry(f.box105, f.ring)).toMatchObject({ weightMg: 40_000, netWeightMg: 38_000, pieces: 20 });
  });

  it("can't sell more of an item than the box holds of it", async () => {
    const f = await fixture();
    await expect(f.owner.mutation(api.sales.create, sale(f, [ringLine(f, { grossWeightMg: 50_000, netWeightMg: 50_000, pieces: 1 })], "s2"))).rejects.toThrow("Not enough");
  });

  it("the saved sale price is the box item's: only Owner/Admin may bill another price", async () => {
    const f = await fixture();
    const staffId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { name: "Counter" });
      await ctx.db.insert("memberships", { userId: id, organizationId: f.org, role: "billing_operator", status: "active", createdAt: 1 });
      return id;
    });
    const staff = f.t.withIdentity({ subject: `${staffId}|s` });
    await expect(staff.mutation(api.sales.create, sale(f, [ringLine(f, { unitPricePaise: 300_000 })], "s3"))).rejects.toThrow("Only the Owner or an Admin");
    await staff.mutation(api.sales.create, sale(f, [ringLine(f)], "s4"));
  });

  it("a sales return goes back into the item's row in the chosen box (added there with the same details)", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [ringLine(f)], "s5"));
    const [line] = await f.owner.query(api.sales.listReturnableItems, { saleId });
    await f.owner.mutation(api.sales.createReturn, {
      documentType: "sales_return", originalSaleId: saleId, saleItemIds: [line._id], boxAssignments: [{ saleItemId: line._id, boxId: f.box110 }], idempotencyKey: "r1",
    });
    expect(await f.entry(f.box110, f.ring)).toMatchObject({ weightMg: 4_000, netWeightMg: 3_800, pieces: 2, hsnCode: "711319", salePricePaise: 400_000 });
  });

  it("a purchase adds into the item's row (creating it for a new item) and cancelling takes it out", async () => {
    const f = await fixture();
    const line = { productId: f.necklace, boxId: f.box105, metal: "gold" as const, metalPurityId: f.gold22, pieces: 2, label: "Necklace", grossWeightMg: 50_000, stoneWeightMg: 2_000, ratePerGramPaise: 600_000, makingChargePaise: 0, stoneChargePaise: 0 };
    const { purchaseId } = await f.owner.mutation(api.purchases.create, { supplierId: f.supplier, items: [line], gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "p1" });
    expect(await f.entry(f.box105, f.necklace)).toMatchObject({ weightMg: 300_000, netWeightMg: 288_000, pieces: 12 });
    await f.owner.mutation(api.purchases.cancel, { purchaseId, reason: "wrong" });
    expect(await f.entry(f.box105, f.necklace)).toMatchObject({ weightMg: 250_000, netWeightMg: 240_000, pieces: 10 });
    await f.owner.mutation(api.purchases.create, { supplierId: f.supplier, items: [{ ...line, boxId: f.box110 }], gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "p2" });
    expect(await f.entry(f.box110, f.necklace)).toMatchObject({ weightMg: 50_000, netWeightMg: 48_000, pieces: 2 });
  });

  it("transfers one item to another box, carrying its details; adjustments change one item", async () => {
    const f = await fixture();
    await f.owner.mutation(api.boxes.transferStock, { fromBoxId: f.box105, toBoxId: f.box110, productId: f.ring, weightMg: 10_000, pieces: 5 });
    expect(await f.entry(f.box105, f.ring)).toMatchObject({ weightMg: 30_000, netWeightMg: 28_500, pieces: 15 });
    expect(await f.entry(f.box110, f.ring)).toMatchObject({ weightMg: 10_000, netWeightMg: 9_500, pieces: 5, hsnCode: "711319", salePricePaise: 400_000 });
    await f.owner.mutation(api.stockAdjustments.adjustBox, { boxId: f.box105, productId: f.necklace, addWeightMg: 0, deductWeightMg: 5_000, addPieces: 0, deductPieces: 0, reason: "reweighed" });
    expect(await f.entry(f.box105, f.necklace)).toMatchObject({ weightMg: 245_000, pieces: 10 });
  });

  it("box-level stock can't be taken from what the items account for; an item is removed only when empty", async () => {
    const f = await fixture();
    await expect(f.owner.mutation(api.stockAdjustments.adjustBox, { boxId: f.box105, addWeightMg: 0, deductWeightMg: 1_000, addPieces: 0, deductPieces: 0, reason: "x" })).rejects.toThrow("choose which item");
    await expect(f.owner.mutation(api.boxEntries.remove, { entryId: f.ringEntry })).rejects.toThrow("still has");
    await f.owner.mutation(api.boxEntries.update, { entryId: f.ringEntry, hsnCode: "7113", salePricePaise: 450_000 });
    expect(await f.entry(f.box105, f.ring)).toMatchObject({ hsnCode: "7113", salePricePaise: 450_000, weightMg: 40_000 });
  });

  it("setup copies an item's saved details into its default box and assigns a single-item box's older stock", async () => {
    const f = await fixture();
    const { product, oldBox } = await f.t.run(async (ctx) => {
      const oldBox = await ctx.db.insert("boxes", { organizationId: f.org, boxNumber: 300, metal: "gold", weightMg: 100_000, pieces: 10, itemCount: 10, isActive: true, createdAt: 1 });
      const product = await ctx.db.insert("products", { organizationId: f.org, name: "Chain", unit: "piece", hsnCode: "7113", salePricePaise: 900_000, defaultBoxId: oldBox, isActive: true, createdAt: 1 });
      return { product, oldBox };
    });
    expect(await f.owner.mutation(api.boxEntries.setupFromItemList, {})).toEqual({ itemsAdded: 1, stockAssigned: 1 });
    expect(await f.entry(oldBox, product)).toMatchObject({ hsnCode: "7113", salePricePaise: 900_000, weightMg: 100_000, netWeightMg: 100_000, pieces: 10 });
    expect(await f.owner.mutation(api.boxEntries.setupFromItemList, {})).toEqual({ itemsAdded: 0, stockAssigned: 0 });
  });
});
