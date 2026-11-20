/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Owner of a Daily Sales shop and a GST shop; the GST shop is active. Each
 * company has its own box 101 — they must never mix.
 */
async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const daily = await ctx.db.insert("organizations", { name: "Daily shop", companyType: "daily_sales", state: "Karnataka", createdAt: 1 });
    const gst = await ctx.db.insert("organizations", { name: "GST shop", companyType: "gst_gold", state: "Karnataka", createdAt: 2 });
    for (const org of [daily, gst]) {
      await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
      await ctx.db.insert("memberships", { userId, organizationId: org, role: "owner", status: "active", createdAt: 1 });
    }
    await ctx.db.insert("currentOrganizations", { userId, organizationId: gst, updatedAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: gst, name: "Asha", state: "Karnataka", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplier = await ctx.db.insert("suppliers", { organizationId: gst, name: "Wholesaler", state: "Karnataka", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const ring = await ctx.db.insert("products", { organizationId: gst, name: "Gold Ring", unit: "piece", purchasePricePaise: 600000, isActive: true, createdAt: 1 });
    const gst3 = await ctx.db.insert("taxConfigurations", { organizationId: gst, name: "GST 3%", cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 300, isActive: true });
    const gstBox = await ctx.db.insert("boxes", { organizationId: gst, boxNumber: 101, label: "GST rings", itemCount: 0, isActive: true, createdAt: 1 });
    const dailyBox = await ctx.db.insert("boxes", { organizationId: daily, boxNumber: 101, label: "Daily rings", itemCount: 0, isActive: true, createdAt: 1 });
    return { userId, daily, gst, customer, supplier, ring, gst3, gstBox, dailyBox };
  });
  return { t, owner: t.withIdentity({ subject: `${data.userId}|s` }), ...data };
}

const line = { otherDeductionMg: 0, ratePerGramPaise: 700000, wastageBasisPoints: 0, makingChargePaise: 0, stoneChargePaise: 0 };
const bill = { discountMode: "none" as const, discountValue: 0, payments: [] };
const boxBalance = async (f: Awaited<ReturnType<typeof fixture>>, boxId: string) => {
  const box = (await f.owner.query(api.boxes.list, {})).find((b) => b._id === boxId)!;
  return { weightMg: box.weightMg, pieces: box.pieces };
};
const purchaseLine = { label: "Gold Ring", grossWeightMg: 10000, stoneWeightMg: 1000, ratePerGramPaise: 600000, makingChargePaise: 0, stoneChargePaise: 0 };

describe("GST company box management (same as Daily Sales)", () => {
  it("puts a GST purchase into a box, counts it in GST stock, bills it from the box, and restores it on cancel", async () => {
    const f = await fixture();
    const { purchaseId } = await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 300, amountPaidPaise: 0, idempotencyKey: "p-box",
      items: [{ ...purchaseLine, productId: f.ring, boxId: f.gstBox }],
    });
    // The box holds the purchase's gross weight and pieces.
    expect(await boxBalance(f, f.gstBox)).toEqual({ weightMg: 10000, pieces: 1 });
    // GST stock = loose item stock + what is in boxes (gross weight).
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({ weightMg: 10000, pieces: 1, boxPieces: 1, loosePieces: 0 });
    expect((await f.owner.query(api.stockReports.itemStock, {})).find((r) => r.id === f.ring)).toMatchObject({ weightMg: 10000, pieces: 1 });
    const [purchaseItem] = await f.owner.query(api.purchases.getItems, { purchaseId });
    expect(purchaseItem).toMatchObject({ boxId: f.gstBox });
    expect(purchaseItem.toItemStock).toBeUndefined();

    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "s-box",
      items: [{ ...line, boxId: f.gstBox, productId: f.ring, grossWeightMg: 10000, netWeightMg: 9000, pieces: 1, taxConfigurationId: f.gst3 }],
    });
    expect(await boxBalance(f, f.gstBox)).toEqual({ weightMg: 0, pieces: 0 });
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({ weightMg: 0, pieces: 0 });
    const invoice = await f.owner.query(api.sales.getInvoiceData, { saleId });
    // 9 g net × ₹7,000 = ₹63,000 + 3% GST (CGST + SGST, same state).
    expect(invoice.sale).toMatchObject({ subtotalPaise: 6_300_000, taxPaise: 189_000, isGst: true });
    // The printed bill splits it into CGST 1.5% + SGST 1.5%, no IGST.
    expect(invoice.gst).toEqual({ cgstPaise: 94_500, sgstPaise: 94_500, igstPaise: 0, rates: { cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 300 } });

    await f.owner.mutation(api.sales.cancel, { saleId, reason: "Returned" });
    expect(await boxBalance(f, f.gstBox)).toEqual({ weightMg: 10000, pieces: 1 });
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({ weightMg: 10000, pieces: 1 });

    await f.owner.mutation(api.purchases.cancel, { purchaseId, reason: "Wrong bill" });
    expect(await boxBalance(f, f.gstBox)).toEqual({ weightMg: 0, pieces: 0 });
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({ weightMg: 0, pieces: 0 });
  });

  it("keeps the two companies' boxes separate, even with the same box number", async () => {
    const f = await fixture();
    await expect(f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "p-daily-box",
      items: [{ ...purchaseLine, productId: f.ring, boxId: f.dailyBox }],
    })).rejects.toThrow(/Box not found/);
    const boxes = await f.owner.query(api.boxes.list, {});
    expect(boxes.map((b) => b.label)).toEqual(["GST rings"]);
  });

  it("bills a box piece and a loose line together", async () => {
    const f = await fixture();
    await f.owner.mutation(api.itemStock.adjust, { productId: f.ring, direction: "in", weightMg: 10000, pieces: 1, reason: "Old GST stock" });
    await f.owner.mutation(api.stockAdjustments.adjustBox, {
      boxId: f.gstBox, addWeightMg: 10000, deductWeightMg: 0, addPieces: 1, deductPieces: 0, reason: "Ring A", productId: f.ring,
    });
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({
      weightMg: 20000, pieces: 2, looseWeightMg: 10000, loosePieces: 1, boxPieces: 1,
    });

    expect(await boxBalance(f, f.gstBox)).toEqual({ weightMg: 10000, pieces: 1 });
    await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "mixed",
      items: [
        { ...line, boxId: f.gstBox, productId: f.ring, grossWeightMg: 10000, netWeightMg: 9500, pieces: 1 },
        { ...line, productId: f.ring, grossWeightMg: 10000, stoneWeightMg: 0, pieces: 1 },
      ],
    });
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({ weightMg: 0, pieces: 0, boxPieces: 0, loosePieces: 0 });
  });

  it("adjusts GST box stock the same way as Daily Sales", async () => {
    const f = await fixture();
    await f.owner.mutation(api.stockAdjustments.adjustBox, {
      boxId: f.gstBox, addWeightMg: 6000, deductWeightMg: 0, addPieces: 2, deductPieces: 0, reason: "Counted stock", productId: f.ring,
    });
    expect(await boxBalance(f, f.gstBox)).toEqual({ weightMg: 6000, pieces: 2 });
    expect((await f.owner.query(api.itemStock.list, {})).find((r) => r.productId === f.ring)).toMatchObject({ pieces: 2, boxPieces: 2 });
  });

  it("still requires a box for every Daily Sales purchase line", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const current = await ctx.db.query("currentOrganizations").first();
      await ctx.db.patch(current!._id, { organizationId: f.daily });
      await ctx.db.insert("suppliers", { organizationId: f.daily, name: "Daily supplier", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    });
    const dailyRing = await f.owner.mutation(api.products.create, { name: "Daily ring", unit: "piece" });
    const [supplier] = await f.owner.query(api.suppliers.list, {});
    await expect(f.owner.mutation(api.purchases.create, {
      supplierId: supplier._id, gstBasisPoints: 0, amountPaidPaise: 0, idempotencyKey: "daily-nobox",
      items: [{ ...purchaseLine, productId: dailyRing }],
    })).rejects.toThrow(/Choose a box/);
  });
});
