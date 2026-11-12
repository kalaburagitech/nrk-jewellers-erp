/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Regression tests for the take-then-filter bugs found in the sales
 * workflow audit: a bounded "most recent N rows" query filtered by
 * document type or date range *after* the cap can silently drop matching
 * data once an org's total row count exceeds that cap. These tests insert
 * enough noise rows directly (bypassing the slower mutation path, since
 * only the data shape matters here) to exceed the old caps and prove the
 * fixed queries still return every matching row.
 */
async function baseFixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Test owner" });
    const org = await ctx.db.insert("organizations", { name: "Test shop", createdAt: 1 });
    const branch = await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
    await ctx.db.insert("memberships", { userId, organizationId: org, branchId: branch, role: "owner", status: "active", createdAt: 1 });
    const customer = await ctx.db.insert("customers", { organizationId: org, name: "Test customer", customerType: "cash", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    return { userId, org, branch, customer };
  });
  return { t, owner: t.withIdentity({ subject: `${data.userId}|session` }), ...data };
}

describe("sales.listByDocumentType no longer drops older document types behind newer noise", () => {
  it("still returns a quotation created before 250 more-recent sales invoices", async () => {
    const f = await baseFixture();
    await f.t.run(async (ctx) => {
      // The old bug: take the 200 most recent `sales` rows across ALL
      // document types, then filter by type. 250 invoices newer than this
      // one quotation would have pushed it out of that window entirely.
      await ctx.db.insert("sales", {
        organizationId: f.org,
        branchId: f.branch,
        customerId: f.customer,
        documentType: "quotation",
        invoiceNumber: "QUO-0001",
        status: "finalized",
        isGst: false,
        subtotalPaise: 10000,
        discountPaise: 0,
        taxPaise: 0,
        roundOffPaise: 0,
        totalPaise: 10000,
        amountPaidPaise: 0,
        idempotencyKey: "quote-1",
        createdByUserId: f.userId,
        createdAt: 1,
      });
      for (let i = 0; i < 250; i++) {
        await ctx.db.insert("sales", {
          organizationId: f.org,
          branchId: f.branch,
          customerId: f.customer,
          documentType: "sales_invoice",
          invoiceNumber: `INV-${i}`,
          status: "finalized",
          isGst: false,
          subtotalPaise: 100,
          discountPaise: 0,
          taxPaise: 0,
          roundOffPaise: 0,
          totalPaise: 100,
          amountPaidPaise: 100,
          idempotencyKey: `noise-${i}`,
          createdByUserId: f.userId,
          createdAt: 1000 + i,
        });
      }
    });

    const quotations = await f.owner.query(api.sales.listByDocumentType, { documentType: "quotation" });
    expect(quotations).toHaveLength(1);
    expect(quotations[0].invoiceNumber).toBe("QUO-0001");
  });
});

describe("reports.getSalesReport no longer truncates an older date range behind recent volume", () => {
  it("still finds a sale from a year ago after 2200 more-recent sales", async () => {
    const f = await baseFixture();
    const oldDate = Date.UTC(2024, 0, 15);

    await f.t.run(async (ctx) => {
      // The old bug: take the 2000 most recent `sales` rows org-wide, THEN
      // filter by the caller's date range. 2200 rows newer than `oldDate`
      // would have pushed this one out of the window before the date
      // filter ever ran, so a report for "last January" would silently
      // come back empty.
      await ctx.db.insert("sales", {
        organizationId: f.org,
        branchId: f.branch,
        customerId: f.customer,
        documentType: "sales_invoice",
        invoiceNumber: "INV-OLD",
        status: "finalized",
        isGst: false,
        subtotalPaise: 500000,
        discountPaise: 0,
        taxPaise: 0,
        roundOffPaise: 0,
        totalPaise: 500000,
        amountPaidPaise: 500000,
        idempotencyKey: "old-sale",
        createdByUserId: f.userId,
        createdAt: oldDate,
      });
      const recentBase = Date.now();
      for (let i = 0; i < 2200; i++) {
        await ctx.db.insert("sales", {
          organizationId: f.org,
          branchId: f.branch,
          customerId: f.customer,
          documentType: "sales_invoice",
          invoiceNumber: `INV-RECENT-${i}`,
          status: "finalized",
          isGst: false,
          subtotalPaise: 100,
          discountPaise: 0,
          taxPaise: 0,
          roundOffPaise: 0,
          totalPaise: 100,
          amountPaidPaise: 100,
          idempotencyKey: `recent-${i}`,
          createdByUserId: f.userId,
          createdAt: recentBase - i * 1000,
        });
      }
    });

    const report = await f.owner.query(api.reports.getSalesReport, {
      startDate: Date.UTC(2024, 0, 1),
      endDate: Date.UTC(2024, 0, 31),
    });
    expect(report.totalInvoiceCount).toBe(1);
    expect(report.totalSalesPaise).toBe(500000);
  });
});

describe("purchases tax is computed server-side, not trusted from the client", () => {
  async function purchaseFixture() {
    const f = await baseFixture();
    const supplier = await f.t.run((ctx) =>
      ctx.db.insert("suppliers", { organizationId: f.org, name: "Test supplier", openingBalancePaise: 0, isActive: true, createdAt: 1 }),
    );
    const product = await f.t.run((ctx) =>
      ctx.db.insert("products", { organizationId: f.org, name: "Gold bar", unit: "gram", isActive: true, createdAt: 1 }),
    );
    const box = await f.t.run((ctx) => ctx.db.insert("boxes", { organizationId: f.org, boxNumber: 1, itemCount: 0, isActive: true, createdAt: 1 }));
    return { ...f, supplier, product, box };
  }

  it("derives taxPaise from gstBasisPoints using the same formula as sales, not a client-supplied amount", async () => {
    const f = await purchaseFixture();
    const result = await f.owner.mutation(api.purchases.create, {
      supplierId: f.supplier,
      items: [
        {
          productId: f.product,
          boxId: f.box,
          label: "Bar",
          grossWeightMg: 10000,
          stoneWeightMg: 0,
          ratePerGramPaise: 500000,
          makingChargePaise: 0,
          stoneChargePaise: 0,
        },
      ],
      gstBasisPoints: 300, // 3%
      amountPaidPaise: 0,
      idempotencyKey: "purchase-1",
    });
    const purchase = await f.t.run((ctx) => ctx.db.get(result.purchaseId));
    // subtotal = 10g * 500000 paise/g = 5,000,000 paise; 3% tax = 150,000 paise
    expect(purchase?.subtotalPaise).toBe(5_000_000);
    expect(purchase?.taxPaise).toBe(150_000);
    expect(purchase?.totalPaise).toBe(5_150_000);
  });

  it("rejects a GST percentage over 100%", async () => {
    const f = await purchaseFixture();
    await expect(
      f.owner.mutation(api.purchases.create, {
        supplierId: f.supplier,
        items: [
          {
            productId: f.product,
            boxId: f.box,
            label: "Bar",
            grossWeightMg: 10000,
            stoneWeightMg: 0,
            ratePerGramPaise: 500000,
            makingChargePaise: 0,
            stoneChargePaise: 0,
          },
        ],
        gstBasisPoints: 10001,
        amountPaidPaise: 0,
        idempotencyKey: "purchase-2",
      }),
    ).rejects.toThrow("GST % must be between 0 and 100");
  });
});
