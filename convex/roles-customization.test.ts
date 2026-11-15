/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const staffId = await ctx.db.insert("users", { name: "Staff" });
    const adminId = await ctx.db.insert("users", { name: "Admin" });
    const org = await ctx.db.insert("organizations", { name: "Shop", createdAt: 1 });
    for (const [userId, role] of [[ownerId, "owner"], [staffId, "staff"], [adminId, "admin"]] as const) {
      await ctx.db.insert("memberships", { userId, organizationId: org, role, status: "active", createdAt: 1 });
    }
    return { ownerId, staffId, adminId };
  });
  return {
    t,
    owner: t.withIdentity({ subject: `${data.ownerId}|s` }),
    staff: t.withIdentity({ subject: `${data.staffId}|s` }),
    admin: t.withIdentity({ subject: `${data.adminId}|s` }),
  };
}

describe("view-only staff", () => {
  it("can read but every write is rejected", async () => {
    const { owner, staff } = await fixture();
    await owner.mutation(api.customers.create, { name: "Asha", customerType: "cash" });
    expect(await staff.query(api.customers.list, {})).toHaveLength(1);
    await expect(staff.mutation(api.customers.create, { name: "Ravi", customerType: "cash" })).rejects.toThrow(/view-only/i);
    expect(await owner.query(api.customers.list, {})).toHaveLength(1);
  });
});

describe("custom field customisation", () => {
  it("is owner-only", async () => {
    const { admin, staff } = await fixture();
    const definitions = [{ id: "tier", entity: "customer" as const, label: "Tier", showInInvoice: false, type: "text" as const }];
    await expect(admin.mutation(api.customFields.saveDefinitions, { definitions })).rejects.toThrow(/only the owner/i);
    await expect(staff.mutation(api.customFields.saveDefinitions, { definitions })).rejects.toThrow(/view-only/i);
    await expect(admin.mutation(api.customFields.saveDropdownList, { key: "expenseCategories", options: ["Rent"] })).rejects.toThrow(/only the owner/i);
  });

  it("validates dropdown, number and required fields", async () => {
    const { owner } = await fixture();
    await expect(owner.mutation(api.customFields.saveDefinitions, {
      definitions: [{ id: "tier", entity: "customer", label: "Tier", showInInvoice: false, type: "select", options: [" "] }],
    })).rejects.toThrow(/at least one choice/i);

    await owner.mutation(api.customFields.saveDefinitions, {
      definitions: [
        { id: "tier", entity: "customer", label: "Tier", showInInvoice: false, type: "select", options: ["Gold", "Silver", "gold"], required: true },
        { id: "ring", entity: "customer", label: "Ring size", showInInvoice: false, type: "number" },
      ],
    });
    const saved = await owner.query(api.customFields.getDefinitions, {});
    expect(saved[0].options).toEqual(["Gold", "Silver"]);

    const create = (customFields: Record<string, string>) => owner.mutation(api.customers.create, { name: "Asha", customerType: "cash", customFields });
    await expect(create({ tier: "Platinum" })).rejects.toThrow(/listed options/i);
    await expect(create({ tier: "Gold", ring: "big" })).rejects.toThrow(/must be a number/i);
    await expect(create({ ring: "12" })).rejects.toThrow(/required/i);
    await create({ tier: "Gold", ring: "12" });
  });

  it("serves default dropdown lists until the owner edits them", async () => {
    const { owner } = await fixture();
    expect((await owner.query(api.customFields.getDropdownLists, {})).expenseCategories).toContain("Rent");
    await owner.mutation(api.customFields.saveDropdownList, { key: "expenseCategories", options: ["Polishing", "Rent", "rent"] });
    expect((await owner.query(api.customFields.getDropdownLists, {})).expenseCategories).toEqual(["Polishing", "Rent"]);
  });
});

describe("app preferences", () => {
  it("defaults on, saves for the owner only", async () => {
    const { owner, admin, staff } = await fixture();
    const initial = await staff.query(api.appPreferences.get, {});
    expect(initial).toEqual({ documents: { quotations: true, proforma: true, orders: true, challans: true }, defaultPrintTemplate: "half-a4" });
    const next = { documents: { ...initial.documents, challans: false }, defaultPrintTemplate: "full-a4" as const };
    await expect(admin.mutation(api.appPreferences.save, { preferences: next })).rejects.toThrow(/only the owner/i);
    await expect(staff.mutation(api.appPreferences.save, { preferences: next })).rejects.toThrow(/view-only/i);
    await owner.mutation(api.appPreferences.save, { preferences: next });
    expect(await staff.query(api.appPreferences.get, {})).toEqual(next);
  });
});
