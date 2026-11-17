/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/** Owner of two companies: a Daily Sales shop (active) with a box piece, and a GST company. */
async function fixture(active: "daily" | "gst" = "gst") {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const daily = await ctx.db.insert("organizations", { name: "Daily shop", companyType: "daily_sales", createdAt: 1 });
    const gst = await ctx.db.insert("organizations", { name: "GST shop", companyType: "gst_gold", createdAt: 2 });
    for (const org of [daily, gst]) {
      await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
      await ctx.db.insert("memberships", { userId, organizationId: org, role: "owner", status: "active", createdAt: 1 });
    }
    const org = active === "gst" ? gst : daily;
    await ctx.db.insert("currentOrganizations", { userId, organizationId: org, updatedAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: org, name: "Asha", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplier = await ctx.db.insert("suppliers", { organizationId: org, name: "Wholesaler", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const product = await ctx.db.insert("products", { organizationId: org, name: "Gold chain", unit: "gram", isActive: true, createdAt: 1 });
    const box = await ctx.db.insert("boxes", { organizationId: daily, boxNumber: 101, itemCount: 1, isActive: true, createdAt: 1 });
    const dailyProduct = active === "daily" ? product : await ctx.db.insert("products", { organizationId: daily, name: "Ring", unit: "gram", isActive: true, createdAt: 1 });
    const boxItem = await ctx.db.insert("boxItems", { organizationId: daily, boxId: box, productId: dailyProduct, label: "Ring", grossWeightMg: 2000, stoneWeightMg: 0, netWeightMg: 2000, status: "in_stock", createdAt: 1 });
    return { userId, daily, gst, customer, supplier, product, box, boxItem };
  });
  return { t, owner: t.withIdentity({ subject: `${data.userId}|s` }), ...data };
}

const line = { otherDeductionMg: 0, ratePerGramPaise: 600000, wastageBasisPoints: 0, makingChargePaise: 0, stoneChargePaise: 0 };
const bill = { discountMode: "none" as const, discountValue: 0, payments: [] };

describe("GST item stock", () => {
  it("adds stock by hand, sells a manual line from it, and restores it on cancel", async () => {
    const f = await fixture("gst");
    // Gross, stone and net are separate balances: stock in 10g gross with 0.5g stone (9.5g net).
    await f.owner.mutation(api.itemStock.adjust, { productId: f.product, direction: "in", grossWeightMg: 10000, stoneWeightMg: 500, pieces: 2, reason: "Opening" });
    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "gst-1",
      items: [{ ...line, productId: f.product, grossWeightMg: 4000, stoneWeightMg: 500, pieces: 1 }],
    });
    let stock = await f.owner.query(api.itemStock.list, {});
    expect(stock[0]).toMatchObject({ grossWeightMg: 6000, stoneWeightMg: 0, netWeightMg: 6000, weightMg: 6000, pieces: 1 });

    await expect(f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: true, idempotencyKey: "gst-2",
      items: [{ ...line, productId: f.product, grossWeightMg: 9000, stoneWeightMg: 0, pieces: 1 }],
    })).rejects.toThrow(/Not enough Gross Stock/);

    await f.owner.mutation(api.sales.cancel, { saleId, reason: "Mistake" });
    stock = await f.owner.query(api.itemStock.list, {});
    expect(stock[0]).toMatchObject({ grossWeightMg: 10000, stoneWeightMg: 500, netWeightMg: 9500, pieces: 2 });
  });

  it("keeps boxes out of GST bills and manual lines out of Daily Sales bills", async () => {
    const gst = await fixture("gst");
    await expect(gst.owner.mutation(api.sales.create, {
      ...bill, customerId: gst.customer, isGst: true, idempotencyKey: "box-in-gst", items: [{ ...line, boxItemId: gst.boxItem }],
    })).rejects.toThrow(/not boxes/);

    const daily = await fixture("daily");
    await expect(daily.owner.mutation(api.sales.create, {
      ...bill, customerId: daily.customer, isGst: false, idempotencyKey: "manual-in-daily",
      items: [{ ...line, productId: daily.product, grossWeightMg: 1000, stoneWeightMg: 0 }],
    })).rejects.toThrow(/pick each piece from a box/);
    await expect(daily.owner.mutation(api.itemStock.adjust, { productId: daily.product, direction: "in", weightMg: 1000, pieces: 1, reason: "" })).rejects.toThrow(/GST companies/);
  });

  it("puts GST purchases into item stock without a box, and takes them back out on cancel", async () => {
    const f = await fixture("gst");
    const { purchaseId } = await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier, gstBasisPoints: 300, amountPaidPaise: 0, idempotencyKey: "p-1",
      items: [{ productId: f.product, label: "Chain", pieces: 1, grossWeightMg: 5000, stoneWeightMg: 0, ratePerGramPaise: 500000, makingChargePaise: 0, stoneChargePaise: 0 }],
    });
    expect((await f.owner.query(api.itemStock.list, {}))[0]).toMatchObject({ weightMg: 5000, pieces: 1 });
    await f.owner.mutation(api.purchases.cancel, { purchaseId, reason: "Wrong bill" });
    expect((await f.owner.query(api.itemStock.list, {}))[0]).toMatchObject({ weightMg: 0, pieces: 0 });
  });

  it("shows both companies on the stock overview", async () => {
    const f = await fixture("gst");
    await f.owner.mutation(api.itemStock.adjust, { productId: f.product, direction: "in", weightMg: 3000, pieces: 1, reason: "Opening" });
    const overview = await f.owner.query(api.itemStock.overview, {});
    expect(overview.daily).toHaveLength(1);
    expect(overview.daily[0].boxes[0]).toMatchObject({ boxNumber: 101, pieces: 1, netWeightMg: 2000 });
    expect(overview.gst[0].items[0]).toMatchObject({ name: "Gold chain", weightMg: 3000 });
  });
});

describe("old item deduction description", () => {
  it("is saved with the amount", async () => {
    const f = await fixture("daily");
    const { saleId } = await f.owner.mutation(api.sales.create, {
      ...bill, customerId: f.customer, isGst: false, idempotencyKey: "note", oldItemDeductionPaise: 50000, oldItemDeductionNote: "  Old ring ",
      items: [{ ...line, boxItemId: f.boxItem }],
    });
    const sale = await f.t.run((ctx) => ctx.db.get(saleId));
    expect(sale?.oldItemDeductionNote).toBe("Old ring");
    expect(sale?.oldItemDeductionPaise).toBe(50000);
  });
});
