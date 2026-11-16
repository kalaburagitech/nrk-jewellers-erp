/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

it("profit uses the exact purchase cost of the sold piece and the statement keeps a running balance", async () => {
  const t = convexTest(schema, modules);
  const d = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const org = await ctx.db.insert("organizations", { name: "Shop", createdAt: 1 });
    const branchId = await ctx.db.insert("branches", { organizationId: org, name: "Main", isDefault: true, createdAt: 1 });
    await ctx.db.insert("memberships", { userId, organizationId: org, branchId, role: "owner", status: "active", createdAt: 1 });
    const customerId = await ctx.db.insert("customers", { organizationId: org, name: "Asha", customerType: "regular", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const supplierId = await ctx.db.insert("suppliers", { organizationId: org, name: "Wholesaler", openingBalancePaise: 0, isActive: true, createdAt: 1 });
    const productId = await ctx.db.insert("products", { organizationId: org, name: "Ring", unit: "gram", isActive: true, createdAt: 1 });
    const boxId = await ctx.db.insert("boxes", { organizationId: org, boxNumber: 101, itemCount: 0, isActive: true, createdAt: 1 });
    const boxItemId = await ctx.db.insert("boxItems", { organizationId: org, boxId, productId, label: "Ring", grossWeightMg: 10000, stoneWeightMg: 0, netWeightMg: 10000, status: "sold", createdAt: 1 });
    const purchaseId = await ctx.db.insert("purchases", { organizationId: org, branchId, supplierId, invoiceNumber: "P1", status: "finalized", subtotalPaise: 500000, taxPaise: 0, totalPaise: 500000, amountPaidPaise: 500000, idempotencyKey: "p1", createdByUserId: userId, createdAt: 1000 });
    await ctx.db.insert("purchaseItems", { organizationId: org, purchaseId, productId, boxId, boxItemId, label: "Ring", grossWeightMg: 10000, stoneWeightMg: 0, netWeightMg: 10000, ratePerGramPaise: 50000, makingChargePaise: 0, stoneChargePaise: 0, lineTotalPaise: 500000 });
    const saleId = await ctx.db.insert("sales", { organizationId: org, branchId, customerId, documentType: "sales_invoice", invoiceNumber: "S1", status: "finalized", isGst: false, subtotalPaise: 700000, discountPaise: 20000, taxPaise: 0, roundOffPaise: 0, totalPaise: 680000, amountPaidPaise: 400000, idempotencyKey: "s1", createdByUserId: userId, createdAt: 2000 });
    await ctx.db.insert("saleItems", { organizationId: org, saleId, productId, boxItemId, grossWeightMg: 10000, stoneWeightMg: 0, otherDeductionMg: 0, netWeightMg: 10000, ratePerGramPaise: 70000, wastageBasisPoints: 0, makingChargePaise: 0, stoneChargePaise: 0, lineTaxPaise: 0, lineTotalPaise: 700000 });
    await ctx.db.insert("customerLedgerEntries", { organizationId: org, customerId, sourceTable: "sales", sourceId: saleId, debitPaise: 680000, creditPaise: 400000, balancePaise: 280000, createdAt: 2000 });
    await ctx.db.insert("expenses", { organizationId: org, category: "Rent", amountPaise: 50000, expenseDate: 2500, status: "recorded", createdByUserId: userId, createdAt: 2500 });
    return { userId, customerId };
  });
  const owner = t.withIdentity({ subject: `${d.userId}|session` });
  const range = { startDate: 0, endDate: 10_000 };

  const profit = await owner.query(api.partyReports.profitReports, range);
  // Sale value 7,000 − 200 discount = 6,800; cost 5,000 → profit 1,800; minus 500 rent → 1,300.
  expect(profit.bills[0]).toMatchObject({ salePaise: 680000, costPaise: 500000, profitPaise: 180000 });
  expect(profit.pnl.netProfitPaise).toBe(130000);
  expect(profit.items[0].profitPaise).toBe(180000);
  expect(profit.linesWithoutCost).toBe(0);

  const statement = await owner.query(api.partyReports.partyStatement, { ...range, partyType: "customer", partyId: d.customerId });
  expect(statement?.closingBalancePaise).toBe(280000);
  expect(statement?.summary).toMatchObject({ totalSalePaise: 680000, moneyInPaise: 400000 });
});
