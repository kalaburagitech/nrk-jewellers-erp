/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Test owner" });
    const org = await ctx.db.insert("organizations", {
      name: "Test shop",
      createdAt: 1,
    });
    const branch = await ctx.db.insert("branches", {
      organizationId: org,
      name: "Main",
      isDefault: true,
      createdAt: 1,
    });
    await ctx.db.insert("memberships", {
      userId,
      organizationId: org,
      branchId: branch,
      role: "owner",
      status: "active",
      createdAt: 1,
    });
    const customer = await ctx.db.insert("customers", {
      organizationId: org,
      name: "Test customer",
      customerType: "cash",
      openingBalancePaise: 0,
      isActive: true,
      createdAt: 1,
    });
    const account = await ctx.db.insert("bankAccounts", {
      organizationId: org,
      name: "Cash",
      type: "cash",
      openingBalancePaise: 1000000,
      isActive: true,
      createdAt: 1,
    });
    const product = await ctx.db.insert("products", {
      organizationId: org,
      name: "Gold ring",
      unit: "gram",
      isActive: true,
      createdAt: 1,
    });
    const box = await ctx.db.insert("boxes", {
      organizationId: org,
      boxNumber: 17,
      itemCount: 1,
      isActive: true,
      createdAt: 1,
    });
    const item = await ctx.db.insert("boxItems", {
      organizationId: org,
      boxId: box,
      productId: product,
      label: "Ring",
      grossWeightMg: 1000,
      stoneWeightMg: 0,
      netWeightMg: 1000,
      status: "in_stock",
      createdAt: 1,
    });
    return { userId, org, customer, account, product, box, item };
  });
  return {
    t,
    owner: t.withIdentity({ subject: `${data.userId}|session` }),
    ...data,
  };
}
async function saleFixture() {
  const f = await fixture();
  const args = {
    customerId: f.customer,
    isGst: false,
    invoiceNumber: "108",
    items: [
      {
        boxItemId: f.item,
        otherDeductionMg: 0,
        ratePerGramPaise: 10000,
        wastageBasisPoints: 0,
        makingChargePaise: 0,
        stoneChargePaise: 0,
      },
    ],
    discountMode: "none" as const,
    discountValue: 0,
    payments: [{ mode: "cash" as const, amountPaise: 10000 }],
    idempotencyKey: "test-sale",
  };
  const result = await f.owner.mutation(api.sales.create, args);
  return { ...f, args, saleId: result.saleId };
}
describe("manual numbering and soft deletion", () => {
  it("accepts a chosen box number and rejects duplicates and fractions", async () => {
    const f = await fixture();
    const id = await f.owner.mutation(api.boxes.createNext, {
      boxNumber: 888,
      label: "Silver",
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.boxNumber).toBe(888);
    await expect(
      f.owner.mutation(api.boxes.createNext, { boxNumber: 17 }),
    ).rejects.toThrow("already exists");
    await expect(
      f.owner.mutation(api.boxes.createNext, { boxNumber: 1.2 }),
    ).rejects.toThrow("whole");
  });
  it("keeps deleted rows, hides them from lists and restores them", async () => {
    const f = await fixture();
    const id = await f.owner.mutation(api.boxes.createNext, { boxNumber: 999 });
    await f.owner.mutation(api.dataManagement.remove, { table: "boxes", id });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.deletedAt).toBeTypeOf(
      "number",
    );
    expect(
      (await f.owner.query(api.boxes.list, {})).some((b) => b._id === id),
    ).toBe(false);
    await f.owner.mutation(api.dataManagement.restoreRecord, {
      table: "boxes",
      id,
    });
    expect(
      (await f.owner.query(api.boxes.list, {})).some((b) => b._id === id),
    ).toBe(true);
  });
  it("protects stock boxes with items", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.dataManagement.remove, {
        table: "boxes",
        id: f.box,
      }),
    ).rejects.toThrow("used");
  });
  it("preserves manual invoice numbers and atomically reverses a deleted sale", async () => {
    const f = await saleFixture();
    expect((await f.t.run((ctx) => ctx.db.get(f.saleId)))?.invoiceNumber).toBe(
      "108",
    );
    await f.owner.mutation(api.sales.cancel, {
      saleId: f.saleId,
      reason: "Entry error",
    });
    const rows = await f.t.run(async (ctx) => ({
      sale: await ctx.db.get(f.saleId),
      item: await ctx.db.get(f.item),
      customer: await ctx.db.get(f.customer),
      box: await ctx.db.get(f.box),
      payments: await ctx.db.query("payments").collect(),
      lines: await ctx.db.query("saleItems").collect(),
    }));
    expect(rows.sale?.status).toBe("cancelled");
    expect(rows.item?.status).toBe("in_stock");
    expect(rows.box?.itemCount).toBe(1);
    expect(rows.customer?.currentBalancePaise).toBe(0);
    expect(rows.payments).toHaveLength(1);
    expect(rows.payments[0].deletedAt).toBeTypeOf("number");
    expect(rows.lines).toHaveLength(1);
    await expect(
      f.owner.mutation(api.sales.cancel, { saleId: f.saleId, reason: "Again" }),
    ).rejects.toThrow();
  });
  it("rejects a duplicate manual invoice without changing stock", async () => {
    const f = await saleFixture();
    await expect(
      f.owner.mutation(api.sales.create, {
        ...f.args,
        idempotencyKey: "another",
      }),
    ).rejects.toThrow("already exists");
    expect((await f.t.run((ctx) => ctx.db.get(f.box)))?.itemCount).toBe(0);
  });
});
describe("Girvi loans", () => {
  async function loanFixture() {
    const f = await fixture();
    const id = await f.owner.mutation(api.girvi.create, {
      ticketNumber: "G-19",
      customerName: "Test borrower",
      phone: "",
      metal: "gold",
      description: "22K ring",
      weightMg: 3000,
      storageLocation: "Locker 1",
      principalPaise: 100000,
      monthlyInterestBasisPoints: 150,
      issuedAt: Date.now() - 1000,
      dueAt: Date.now() + 86400000,
      accountId: f.account,
    });
    return { ...f, id };
  }
  it("posts disbursement and repayment, then releases only after full principal repayment", async () => {
    const f = await loanFixture();
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.account)))?.currentBalancePaise,
    ).toBe(900000);
    await expect(
      f.owner.mutation(api.girvi.receive, {
        id: f.id,
        principalPaise: 100,
        interestPaise: 0,
        release: true,
      }),
    ).rejects.toThrow("all principal");
    await f.owner.mutation(api.girvi.receive, {
      id: f.id,
      principalPaise: 100000,
      interestPaise: 1500,
      release: true,
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.id)))?.status).toBe("released");
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.account)))?.currentBalancePaise,
    ).toBe(1001500);
    expect(await f.owner.query(api.girvi.receipts, { id: f.id })).toHaveLength(
      1,
    );
  });
  it("rejects overpayment and cancellation after repayment", async () => {
    const f = await loanFixture();
    await expect(
      f.owner.mutation(api.girvi.receive, {
        id: f.id,
        principalPaise: 100001,
        interestPaise: 0,
        release: false,
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.girvi.receive, {
      id: f.id,
      principalPaise: 50000,
      interestPaise: 0,
      release: false,
    });
    await expect(
      f.owner.mutation(api.girvi.cancel, { id: f.id, reason: "Mistake" }),
    ).rejects.toThrow("repayments");
  });
  it("soft cancels an unused ticket and reverses the cash entry", async () => {
    const f = await loanFixture();
    await f.owner.mutation(api.girvi.cancel, { id: f.id, reason: "Mistake" });
    expect((await f.t.run((ctx) => ctx.db.get(f.id)))?.status).toBe(
      "cancelled",
    );
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.account)))?.currentBalancePaise,
    ).toBe(1000000);
  });
});
describe("backup restore", () => {
  it("restores deleted records and soft deletes records created after the snapshot", async () => {
    const f = await fixture();
    const backup = await f.owner.query(api.dataManagement.exportBackup, {});
    const id = await f.owner.mutation(api.boxes.createNext, { boxNumber: 501 });
    await f.owner.mutation(api.dataManagement.restore, {
      json: JSON.stringify(backup),
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.deletedAt).toBeTypeOf(
      "number",
    );
    expect(
      (await f.owner.query(api.boxes.list, {})).map((b) => b.boxNumber),
    ).toEqual([17]);
  });
  it("rejects other organizations and incomplete snapshots", async () => {
    const f = await fixture();
    const backup = await f.owner.query(api.dataManagement.exportBackup, {});
    await expect(
      f.owner.mutation(api.dataManagement.restore, {
        json: JSON.stringify({ ...backup, organizationId: "another-org" }),
      }),
    ).rejects.toThrow("this organization");
    await expect(
      f.owner.mutation(api.dataManagement.restore, {
        json: JSON.stringify({ ...backup, tables: {} }),
      }),
    ).rejects.toThrow("Incomplete");
  });
  it("enforces owner/admin access for backup and deletion", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const m = await ctx.db.query("memberships").first();
      await ctx.db.patch(m!._id, { role: "billing_operator" });
    });
    await expect(
      f.owner.query(api.dataManagement.exportBackup, {}),
    ).rejects.toThrow("not permitted");
    await expect(
      f.owner.mutation(api.dataManagement.remove, {
        table: "customers",
        id: f.customer,
      }),
    ).rejects.toThrow("not permitted");
  });
});

describe("transaction history and backup integrity", () => {
  it("keeps cancelled invoice lines and payment snapshot printable", async () => {
    const f = await saleFixture();
    await f.owner.mutation(api.sales.cancel, {
      saleId: f.saleId,
      reason: "Wrong entry",
    });
    const invoice = await f.owner.query(api.sales.getInvoiceData, {
      saleId: f.saleId,
    });
    expect(invoice.items).toHaveLength(1);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].amountPaise).toBe(10000);
    expect(await f.owner.query(api.sales.list, {})).toHaveLength(0);
    expect(
      await f.owner.query(api.dataManagement.archivedTransactions, {}),
    ).toHaveLength(1);
  });
  it("reverses a sales return before allowing the original invoice deletion", async () => {
    const f = await saleFixture();
    const lines = await f.owner.query(api.sales.getItems, { saleId: f.saleId });
    const result = await f.owner.mutation(api.sales.createReturn, {
      originalSaleId: f.saleId,
      documentType: "sales_return",
      saleItemIds: [lines[0]._id],
      idempotencyKey: "return-1",
    });
    await expect(
      f.owner.mutation(api.sales.cancel, { saleId: f.saleId, reason: "Error" }),
    ).rejects.toThrow();
    await f.owner.mutation(api.sales.cancel, {
      saleId: result.saleId,
      reason: "Wrong return",
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.item)))?.status).toBe("sold");
    await f.owner.mutation(api.sales.cancel, {
      saleId: f.saleId,
      reason: "Wrong sale",
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.item)))?.status).toBe(
      "in_stock",
    );
  });
  it("round-trips backups containing synthetic cash transaction identifiers", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("cashBankLedgerEntries", {
        organizationId: f.org,
        accountId: f.account,
        sourceTable: "cash_bank_transaction",
        sourceId: "event-uuid-without-a-document",
        description: "Opening adjustment",
        debitPaise: 0,
        creditPaise: 100,
        balancePaise: 1000100,
        createdByUserId: f.userId,
        createdAt: 1,
      });
    });
    const backup = await f.owner.query(api.dataManagement.exportBackup, {});
    await f.owner.mutation(api.dataManagement.restore, {
      json: JSON.stringify(backup),
    });
  });
  it("rejects a snapshot with missing inventory references before writing", async () => {
    const f = await fixture();
    const backup = await f.owner.query(api.dataManagement.exportBackup, {});
    backup.tables.products = [];
    await expect(
      f.owner.mutation(api.dataManagement.restore, {
        json: JSON.stringify(backup),
      }),
    ).rejects.toThrow("Missing referenced");
    expect(await f.owner.query(api.boxes.list, {})).toHaveLength(1);
  });
});

it("preserves the reference invoice's paise through discount and old-metal deduction", async () => {
  const f = await fixture();
  const extra = await f.t.run(async (ctx) => {
    await ctx.db.patch(f.item, { grossWeightMg: 33500, netWeightMg: 33500 });
    const make = (label: string, weight: number) =>
      ctx.db.insert("boxItems", {
        organizationId: f.org,
        boxId: f.box,
        productId: f.product,
        label,
        grossWeightMg: weight,
        stoneWeightMg: 0,
        netWeightMg: weight,
        status: "in_stock",
        createdAt: 1,
      });
    const second = await make("Gold mix 1", 100);
    const third = await make("Gold mix 2", 2000);
    await ctx.db.patch(f.box, { itemCount: 3 });
    const purity = await ctx.db.insert("metalPurities", {
      organizationId: f.org,
      metal: "gold",
      label: "22K",
      purityBasisPoints: 9166,
      isActive: true,
    });
    return { second, third, purity };
  });
  const line = (
    boxItemId: typeof f.item,
    ratePerGramPaise: number,
    makingChargePaise = 0,
  ) => ({
    boxItemId,
    ratePerGramPaise,
    makingChargePaise,
    otherDeductionMg: 0,
    wastageBasisPoints: 0,
    stoneChargePaise: 0,
  });
  const result = await f.owner.mutation(api.sales.create, {
    customerId: f.customer,
    invoiceNumber: "108",
    isGst: false,
    items: [
      line(f.item, 13500, 30000),
      line(extra.second, 1200000),
      line(extra.third, 25000),
    ],
    discountMode: "fixed",
    discountValue: 34800,
    payments: [{ mode: "cash", amountPaise: 252450 }],
    oldGoldExchange: {
      metalPurityId: extra.purity,
      grossWeightMg: 3650,
      meltingDeductionBasisPoints: 0,
      ratePerGramPaise: 100000,
    },
    idempotencyKey: "reference",
  });
  const invoice = await f.owner.query(api.sales.getInvoiceData, {
    saleId: result.saleId,
  });
  expect(invoice.sale.subtotalPaise).toBe(652250);
  expect(invoice.sale.totalPaise).toBe(617450);
  expect(invoice.sale.roundOffPaise).toBe(0);
  expect(
    invoice.sale.totalPaise - invoice.oldGoldExchange!.exchangeValuePaise,
  ).toBe(252450);
  expect(invoice.sale.totalPaise - invoice.sale.amountPaidPaise).toBe(0);
});
