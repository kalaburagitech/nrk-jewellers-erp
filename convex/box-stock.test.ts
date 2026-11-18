/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/** Daily Sales shop with Box 100 (gold, 1000 g, 100 pcs) and Box 200 (silver, empty). */
async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const org = await ctx.db.insert("organizations", { name: "NRK", companyType: "daily_sales", createdAt: 1 });
    await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
    await ctx.db.insert("memberships", { userId, organizationId: org, role: "owner", status: "active", createdAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: org, name: "Asha", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplier = await ctx.db.insert("suppliers", { organizationId: org, name: "Wholesaler", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const product = await ctx.db.insert("products", { organizationId: org, name: "Gold chain", unit: "gram", isActive: true, createdAt: 1 });
    const gold22 = await ctx.db.insert("metalPurities", { organizationId: org, metal: "gold", label: "22K", purityBasisPoints: 9166, isActive: true });
    const silver925 = await ctx.db.insert("metalPurities", { organizationId: org, metal: "silver", label: "925", purityBasisPoints: 9250, isActive: true });
    return { userId, org, customer, supplier, product, gold22, silver925 };
  });
  const owner = t.withIdentity({ subject: `${data.userId}|s` });
  const box100 = await owner.mutation(api.boxes.createNext, { boxNumber: 100, metal: "gold", openingWeightMg: 1_000_000, openingPieces: 100, label: "Chains" });
  const box200 = await owner.mutation(api.boxes.createNext, { boxNumber: 200, metal: "silver" });
  const balance = async (boxId: Id<"boxes">) => {
    const box = (await owner.query(api.boxes.list, {})).find((b) => b._id === boxId)!;
    return { weightMg: box.weightMg, pieces: box.pieces };
  };
  return { t, owner, box100, box200, balance, ...data };
}
type F = Awaited<ReturnType<typeof fixture>>;

const boxLine = (f: F, over: Record<string, unknown> = {}) => ({
  boxId: f.box100,
  productId: f.product,
  metal: "gold" as const,
  metalPurityId: f.gold22,
  grossWeightMg: 10_000,
  netWeightMg: 9_000,
  pieces: 1,
  otherDeductionMg: 0,
  ratePerGramPaise: 600_000,
  wastageBasisPoints: 0,
  makingChargePaise: 0,
  stoneChargePaise: 0,
  ...over,
});
const billBody = (f: F, items: unknown[]) => ({
  customerId: f.customer, isGst: false, items: items as never, discountMode: "none" as const, discountValue: 0, payments: [],
});
const sale = (f: F, items: unknown[], key: string) => ({ ...billBody(f, items), idempotencyKey: key });

describe("box stock (weight pool)", () => {
  it("creates a box with opening weight and pieces, logged in the journal", async () => {
    const f = await fixture();
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
    const moves = await f.owner.query(api.boxes.movements, { boxId: f.box100 });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ direction: "in", netWeightMg: 1_000_000, quantity: 100, sourceTable: "box_opening" });
  });

  it("sale deducts the gross weight from the box and bills the net weight (client example)", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { makingChargeMode: "per_gram", makingChargeValue: 50_000 })], "s1"));
    // 10 g gross sold from Box 100 → 990 g, 99 pcs left.
    expect(await f.balance(f.box100)).toEqual({ weightMg: 990_000, pieces: 99 });
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    const item = invoice.items[0];
    expect(item).toMatchObject({ boxNumber: 100, metal: "gold", grossWeightMg: 10_000, netWeightMg: 9_000, stockWeightMg: 10_000, label: "Gold chain" });
    // Metal 9 g × ₹6,000 = ₹54,000; making ₹500/g × 9 g = ₹4,500.
    expect(item.makingChargePaise).toBe(450_000);
    expect(invoice.sale.totalPaise).toBe(5_400_000 + 450_000);
  });

  it("supports making charge as a percentage and line discount", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { makingChargeMode: "percent", makingChargeValue: 1000, lineDiscountPaise: 40_000 })], "s-pct"));
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    expect(invoice.items[0].makingChargePaise).toBe(540_000); // 10% of ₹54,000
    expect(invoice.sale.totalPaise).toBe(5_400_000 + 540_000 - 40_000);
  });

  it("cancelling the bill puts the exact weight and pieces back once", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [boxLine(f)], "s2"));
    await f.owner.mutation(api.sales.cancel, { saleId, reason: "mistake" });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
    await expect(f.owner.mutation(api.sales.cancel, { saleId, reason: "again" })).rejects.toThrow();
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
  });

  it("editing a bill applies only the net change, and a retried save never deducts twice", async () => {
    const f = await fixture();
    const args = sale(f, [boxLine(f)], "s3");
    const { saleId } = await f.owner.mutation(api.sales.create, args);
    await f.owner.mutation(api.sales.create, args); // same idempotency key
    expect(await f.balance(f.box100)).toEqual({ weightMg: 990_000, pieces: 99 });
    await f.owner.mutation(api.sales.update, { ...billBody(f, [boxLine(f, { grossWeightMg: 12_500, netWeightMg: 12_000, pieces: 2 })]), saleId, billDate: Date.now() });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 987_500, pieces: 98 });
  });

  it("rejects net > gross, the wrong metal's box, and overselling", async () => {
    const f = await fixture();
    await expect(f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { netWeightMg: 11_000 })], "e1"))).rejects.toThrow("cannot be more than its gross");
    await expect(f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { metal: "silver", metalPurityId: f.silver925 })], "e2"))).rejects.toThrow("holds Gold");
    await expect(f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { grossWeightMg: 1_000_001, netWeightMg: 1_000 })], "e3"))).rejects.toThrow("Not enough stock in Box 100");
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
  });

  it("a typed description with no item picked creates the item", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { productId: undefined, label: "Fancy Bangle" })], "s4"));
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    expect(invoice.items[0].label).toBe("Fancy Bangle");
    expect((await f.owner.query(api.products.list, {})).some((p) => p.name === "Fancy Bangle")).toBe(true);
  });

  it("sales return puts weight back into the chosen box; the invoice can't be cancelled until the return is", async () => {
    const f = await fixture();
    const { saleId } = await f.owner.mutation(api.sales.create, sale(f, [boxLine(f)], "s5"));
    const [line] = await f.owner.query(api.sales.listReturnableItems, { saleId });
    const { saleId: returnId } = await f.owner.mutation(api.sales.createReturn, {
      documentType: "sales_return", originalSaleId: saleId, saleItemIds: [line._id], boxAssignments: [{ saleItemId: line._id, boxId: f.box100 }], idempotencyKey: "r1",
    });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
    expect(await f.owner.query(api.sales.listReturnableItems, { saleId })).toHaveLength(0);
    await expect(f.owner.mutation(api.sales.cancel, { saleId, reason: "x" })).rejects.toThrow("was returned");
    await f.owner.mutation(api.sales.cancel, { saleId: returnId, reason: "undo return" });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 990_000, pieces: 99 });
    expect(await f.owner.query(api.sales.listReturnableItems, { saleId })).toHaveLength(1);
  });
});

describe("purchase into boxes", () => {
  const purchaseLine = (f: F, over: Record<string, unknown> = {}) => ({
    productId: f.product, boxId: f.box100, metal: "gold" as const, metalPurityId: f.gold22, pieces: 5, label: "Chain",
    grossWeightMg: 25_500, stoneWeightMg: 500, ratePerGramPaise: 680_000, makingChargePaise: 0, stoneChargePaise: 0, ...over,
  });
  const purchaseBody = (f: F, items: unknown[]) => ({ supplierId: f.supplier, items: items as never, gstBasisPoints: 0, amountPaidPaise: 0 });
  const purchase = (f: F, items: unknown[], key: string) => ({ ...purchaseBody(f, items), idempotencyKey: key });

  it("adds gross weight and pieces to the receiving box and removes them on cancel", async () => {
    const f = await fixture();
    const { purchaseId } = await f.owner.mutation(api.purchases.create, purchase(f, [purchaseLine(f)], "p1"));
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_025_500, pieces: 105 });
    await f.owner.mutation(api.purchases.cancel, { purchaseId, reason: "wrong" });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
  });

  it("refuses gold into a silver box", async () => {
    const f = await fixture();
    await expect(f.owner.mutation(api.purchases.create, purchase(f, [purchaseLine(f, { boxId: f.box200 })], "p2"))).rejects.toThrow("holds Silver");
  });

  it("can be edited after part of the box was sold, as long as the box stays above zero", async () => {
    const f = await fixture();
    const { purchaseId } = await f.owner.mutation(api.purchases.create, purchase(f, [purchaseLine(f, { boxId: f.box200, metal: "silver", metalPurityId: f.silver925 })], "p3"));
    await f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { boxId: f.box200, metal: "silver", metalPurityId: f.silver925 })], "s6"));
    expect(await f.balance(f.box200)).toEqual({ weightMg: 15_500, pieces: 4 });
    const edit = purchaseBody(f, [purchaseLine(f, { boxId: f.box200, metal: "silver", metalPurityId: f.silver925, ratePerGramPaise: 9_000 })]);
    await f.owner.mutation(api.purchases.update, { ...edit, purchaseId, billDate: Date.now() });
    expect(await f.balance(f.box200)).toEqual({ weightMg: 15_500, pieces: 4 });
    const shrink = purchaseBody(f, [purchaseLine(f, { boxId: f.box200, metal: "silver", metalPurityId: f.silver925, grossWeightMg: 5_000, stoneWeightMg: 0 })]);
    await expect(f.owner.mutation(api.purchases.update, { ...shrink, purchaseId, billDate: Date.now() })).rejects.toThrow("below zero");
  });

  it("purchase return takes the line's weight out of its box once", async () => {
    const f = await fixture();
    const { purchaseId } = await f.owner.mutation(api.purchases.create, purchase(f, [purchaseLine(f)], "p4"));
    const [line] = await f.owner.query(api.purchases.listReturnableItems, { purchaseId });
    await f.owner.mutation(api.purchases.createPurchaseReturn, { originalPurchaseId: purchaseId, purchaseItemIds: [line._id], idempotencyKey: "pr1" });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
    expect(await f.owner.query(api.purchases.listReturnableItems, { purchaseId })).toHaveLength(0);
  });
});

describe("stock operations", () => {
  it("adjusts with a reason and transfers between boxes of the same metal", async () => {
    const f = await fixture();
    await f.owner.mutation(api.stockAdjustments.adjustBox, { boxId: f.box100, addWeightMg: 50_000, deductWeightMg: 20_000, addPieces: 2, deductPieces: 1, reason: "Audit" });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_030_000, pieces: 101 });
    await expect(f.owner.mutation(api.stockAdjustments.adjustBox, { boxId: f.box100, addWeightMg: 0, deductWeightMg: 2_000_000, addPieces: 0, deductPieces: 0, reason: "x" })).rejects.toThrow("Not enough stock");

    const box101 = await f.owner.mutation(api.boxes.createNext, { boxNumber: 101, metal: "gold" });
    await f.owner.mutation(api.boxes.transferStock, { fromBoxId: f.box100, toBoxId: box101, weightMg: 30_000, pieces: 1 });
    expect(await f.balance(f.box100)).toEqual({ weightMg: 1_000_000, pieces: 100 });
    expect(await f.balance(box101)).toEqual({ weightMg: 30_000, pieces: 1 });
    await expect(f.owner.mutation(api.boxes.transferStock, { fromBoxId: f.box100, toBoxId: f.box200, weightMg: 1_000, pieces: 0 })).rejects.toThrow("holds Silver");
  });

  it("a box holding stock can't be deleted", async () => {
    const f = await fixture();
    await expect(f.owner.mutation(api.dataManagement.remove, { table: "boxes", id: f.box100 })).rejects.toThrow("still holds");
    await f.owner.mutation(api.dataManagement.remove, { table: "boxes", id: f.box200 });
  });

  it("an old box of separate pieces starts from the pieces' gross weight", async () => {
    const f = await fixture();
    const legacy = await f.t.run(async (ctx) => {
      const box = await ctx.db.insert("boxes", { organizationId: f.org, boxNumber: 300, itemCount: 2, isActive: true, createdAt: 1 });
      for (const grossWeightMg of [4_000, 6_000]) {
        await ctx.db.insert("boxItems", { organizationId: f.org, boxId: box, productId: f.product, label: "Ring", grossWeightMg, stoneWeightMg: 0, netWeightMg: grossWeightMg, status: "in_stock", createdAt: 1 });
      }
      return box;
    });
    expect(await f.balance(legacy)).toEqual({ weightMg: 10_000, pieces: 2 });
    await f.owner.mutation(api.sales.create, sale(f, [boxLine(f, { boxId: legacy, grossWeightMg: 3_000, netWeightMg: 3_000 })], "s7"));
    expect(await f.balance(legacy)).toEqual({ weightMg: 7_000, pieces: 1 });
  });
});
