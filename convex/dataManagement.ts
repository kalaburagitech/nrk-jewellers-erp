/* eslint-disable @typescript-eslint/no-explicit-any */
// Dynamic table access is restricted to this explicit business-data allowlist.
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import type { TableNames } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import type { RegisteredAction } from "convex/server";
export const TABLES = [
  "branches",
  "applicationSettings",
  "accountingYears",
  "customers",
  "suppliers",
  "stockGroups",
  "stockCategories",
  "metalPurities",
  "products",
  "boxes",
  "boxItems",
  "stockMovements",
  "metalRates",
  "taxConfigurations",
  "invoiceSequences",
  "purchases",
  "purchaseItems",
  "sales",
  "saleItems",
  "payments",
  "oldGoldExchanges",
  "customerLedgerEntries",
  "supplierLedgerEntries",
  "bankAccounts",
  "cashBankLedgerEntries",
  "expenses",
  "ewayBills",
  "girviLoans",
  "girviReceipts",
] as const;
const MASTER_TABLES = [
  "customers",
  "suppliers",
  "stockGroups",
  "stockCategories",
  "metalPurities",
  "products",
  "boxes",
  "taxConfigurations",
  "bankAccounts",
];
async function readRows(ctx: any, organizationId: string) {
  const tables: Record<string, any[]> = {};
  let count = 0;
  for (const table of TABLES) {
    tables[table] = await ctx.db
      .query(table)
      .filter((q: any) => q.eq(q.field("organizationId"), organizationId))
      .collect();
    count += tables[table].length;
    if (count > 5000)
      throw new Error(
        "This database exceeds the in-app backup limit (5,000 records). Use a Convex deployment export for a full backup.",
      );
  }
  return tables;
}
export const exportBackup = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const tables = await readRows(ctx, auth.organizationId);
    const organization = await ctx.db.get(auth.organizationId);
    const backup = {
      format: "nrk-erp-backup",
      version: 2,
      organizationId: auth.organizationId,
      exportedAt: Date.now(),
      organization,
      tables,
    };
    if (JSON.stringify(backup).length > 3_000_000)
      throw new Error(
        "This backup exceeds 3 MB. Use a Convex deployment export.",
      );
    return backup;
  },
});
export const restore = mutation({
  args: { json: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (args.json.length > 3_000_000)
      throw new Error("Backup exceeds 3 MB. Use a Convex deployment restore.");
    const backup = JSON.parse(args.json);
    if (backup.format !== "nrk-erp-backup" || ![1, 2].includes(backup.version) || backup.organizationId !== auth.organizationId)
      throw new Error(
        "Select a valid NRK backup from this organization and deployment",
      );
    const backupTables = backup.tables && typeof backup.tables === "object"
      ? { ...backup.tables, accountingYears: backup.tables.accountingYears ?? [] }
      : null;
    if (
      !backup.organization ||
      backup.organization._id !== auth.organizationId ||
      !backupTables
    )
      throw new Error("Incomplete backup");
    const ids = new Set<string>();
    let count = 0;
    for (const table of TABLES) {
      if (!Array.isArray(backupTables[table]))
        throw new Error(`Missing table: ${table}`);
      for (const row of backupTables[table]) {
        if (
          row.organizationId !== auth.organizationId ||
          typeof row._id !== "string" ||
          !ctx.db.normalizeId(table, row._id) ||
          ids.has(row._id)
        )
          throw new Error("Invalid or duplicate record in backup");
        ids.add(row._id);
        count++;
      }
    }
    if (count > 5000) throw new Error("Backup exceeds 5,000 records");
    const externalIds = new Set([
      "sourceId",
      "createdByUserId",
      "setByUserId",
      "userId",
      "invoiceLogoStorageId",
      "appIconStorageId",
      "loginImageStorageId",
    ]);
    for (const table of TABLES)
      for (const row of backupTables[table]) {
        for (const [key, value] of Object.entries(row)) {
          if (
            value === undefined ||
            value === null ||
            key === "_id" ||
            key === "organizationId" ||
            externalIds.has(key)
          )
            continue;
          if (
            (key.endsWith("Id") || key === "partyId") &&
            typeof value === "string" &&
            !ids.has(value)
          )
            throw new Error(`Missing referenced record: ${table}.${key}`);
        }
      }
    const current = await readRows(ctx, auth.organizationId);
    const mapping = new Map<string, string>();
    // Retain existing IDs so memberships and audit references remain valid.
    for (const table of TABLES) {
      for (const row of backupTables[table]) {
        const existing: any = await ctx.db.get(row._id as any);
        if (existing && existing.organizationId !== auth.organizationId)
          throw new Error("Record belongs to another organization");
        if (existing) mapping.set(row._id, row._id);
        else {
          const { _id, _creationTime, ...fields } = row;
          void _creationTime;
          mapping.set(_id, await ctx.db.insert(table as TableNames, fields));
        }
      }
    }
    const remap = (value: any): any =>
      typeof value === "string"
        ? (mapping.get(value) ?? value)
        : Array.isArray(value)
          ? value.map(remap)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, val]) => [k, remap(val)]),
              )
            : value;
    for (const table of TABLES) {
      for (const row of backupTables[table]) {
        const { _id, _creationTime, ...fields } = row;
        void _creationTime;
        await ctx.db.replace(mapping.get(_id) as any, remap(fields));
      }
      for (const row of current[table])
        if (!ids.has(row._id))
          await ctx.db.patch(row._id, { deletedAt: Date.now() });
    }
    const { _id, _creationTime, ...orgFields } = backup.organization;
    void _id;
    void _creationTime;
    await ctx.db.replace(auth.organizationId, orgFields);
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "backup.restore",
      entityTable: "organizations",
      entityId: auth.organizationId,
      metadata: { exportedAt: backup.exportedAt, count },
      createdAt: Date.now(),
    });
    return { count };
  },
});

export const clearCompanyDataInternal = internalMutation({
  args: { organizationId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const tables = await readRows(ctx, args.organizationId);
    const preserve = new Set(["branches", "applicationSettings", "accountingYears", "taxConfigurations", "metalPurities", "bankAccounts"]);
    const now = Date.now();
    let count = 0;
    for (const table of TABLES) {
      if (preserve.has(table)) continue;
      for (const row of tables[table]) {
        await ctx.db.patch(row._id, { deletedAt: now, ...("isActive" in row ? { isActive: false } : {}) } as never);
        count++;
      }
    }
    for (const account of tables.bankAccounts) await ctx.db.patch(account._id, { currentBalancePaise: account.openingBalancePaise });
    await ctx.db.insert("auditLogs", {
      organizationId: args.organizationId,
      userId: args.userId,
      action: "company.soft_reset",
      entityTable: "organizations",
      entityId: args.organizationId,
      metadata: { count, preservedConfiguration: true },
      createdAt: now,
    });
    return { count };
  },
});

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const clearCompanyData: RegisteredAction<"public", { confirmation: string; pin: string }, Promise<{ count: number }>> = action({
  args: { confirmation: v.string(), pin: v.string() },
  handler: async (ctx, args): Promise<{ count: number }> => {
    const access = await ctx.runQuery(api.organizations.getMyAccess, {});
    if (access?.membership?.role !== "owner" || !access.organization || !access.user) throw new Error("Only the owner can reset company data.");
    if (args.confirmation !== `RESET ${access.organization.name}`) throw new Error(`Type RESET ${access.organization.name} exactly to confirm.`);
    if (!/^\d{4,6}$/.test(args.pin)) throw new Error("Enter your 4 to 6 digit passcode.");
    const pinRecord: { pinSalt: string; pinHash: string } | null = await ctx.runQuery(internal.appSecurityInternal.getPinRecord, { userId: access.user._id });
    if (!pinRecord) throw new Error("Set an app passcode before resetting company data.");
    const salt = Uint8Array.from(pinRecord.pinSalt.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(args.pin), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt).buffer as ArrayBuffer, iterations: 210_000 }, keyMaterial, 256));
    const candidate = bytesToHex(derived);
    let difference = candidate.length ^ pinRecord.pinHash.length;
    for (let index = 0; index < Math.min(candidate.length, pinRecord.pinHash.length); index++) difference |= candidate.charCodeAt(index) ^ pinRecord.pinHash.charCodeAt(index);
    if (difference !== 0) throw new Error("The passcode did not match. No company data was changed.");
    return await ctx.runMutation(internal.dataManagement.clearCompanyDataInternal, { organizationId: access.organization._id, userId: access.user._id });
  },
});
export const listRecords = query({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (!MASTER_TABLES.includes(args.table))
      throw new Error("Unsupported table");
    return (
      await ctx.db
        .query(args.table as TableNames)
        .filter((q) =>
          q.eq(q.field("organizationId" as never), auth.organizationId),
        )
        .filter((q) => q.eq(q.field("deletedAt" as never), undefined))
        .collect()
    ).map((row: any) => ({
      id: row._id as string,
      name: String(
        row.name ??
          row.label ??
          (row.boxNumber !== undefined ? `Box ${row.boxNumber}` : row._id),
      ),
    }));
  },
});
export const remove = mutation({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (!MASTER_TABLES.includes(args.table))
      throw new Error("Unsupported table");
    const id = ctx.db.normalizeId(args.table as TableNames, args.id);
    if (!id) throw new Error("Invalid record");
    const row: any = await ctx.db.get(id);
    if (!row || row.organizationId !== auth.organizationId)
      throw new Error("Record not found");
    if (args.table === "products") {
      // Product references are indexed, so deleting one item stays quick even
      // when the business has a long transaction history.
      const [boxItems, stockMovements, purchaseItems, saleItems] = await Promise.all([
        ctx.db.query("boxItems").withIndex("by_product", (q) => q.eq("productId", id as any)).collect(),
        ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", id as any)).collect(),
        ctx.db.query("purchaseItems").withIndex("by_product", (q) => q.eq("productId", id as any)).collect(),
        ctx.db.query("saleItems").withIndex("by_product", (q) => q.eq("productId", id as any)).collect(),
      ]);
      if ([...boxItems, ...stockMovements, ...purchaseItems, ...saleItems].some((related) => !related.deletedAt))
        throw new Error("This item is linked to stock or a bill, so it cannot be deleted. You can mark it inactive from the item settings instead.");
    } else {
      const tables = await readRows(ctx, auth.organizationId);
      for (const rows of Object.values(tables))
        for (const related of rows) {
          if (
            !related.deletedAt &&
            related._id !== id &&
            Object.entries(related).some(
              ([key, value]) =>
                key !== "organizationId" && key !== "_id" && value === id,
            )
          )
            throw new Error(
              "This record is used by other records. Delete or reverse the related records first.",
            );
        }
    }
    if ((row.currentBalancePaise ?? row.openingBalancePaise ?? 0) !== 0)
      throw new Error("Settle the outstanding balance before deletion");
    await ctx.db.patch(id, {
      deletedAt: Date.now(),
      ...("isActive" in row ? { isActive: false } : {}),
    });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "record.soft_delete",
      entityTable: args.table,
      entityId: id,
      metadata: { name: row.name ?? row.label },
      createdAt: Date.now(),
    });
  },
});

export const restoreRecord = mutation({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (!MASTER_TABLES.includes(args.table))
      throw new Error("Unsupported table");
    const id = ctx.db.normalizeId(args.table as TableNames, args.id);
    if (!id) throw new Error("Invalid record");
    const row: any = await ctx.db.get(id);
    if (!row || row.organizationId !== auth.organizationId || !row.deletedAt)
      throw new Error("Deleted record not found");
    await ctx.db.patch(id, {
      deletedAt: undefined,
      ...("isActive" in row ? { isActive: true } : {}),
    });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "record.restore",
      entityTable: args.table,
      entityId: id,
      createdAt: Date.now(),
    });
  },
});
export const deletedRecords = query({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (!MASTER_TABLES.includes(args.table))
      throw new Error("Unsupported table");
    const rows = await ctx.db
      .query(args.table as TableNames)
      .filter((q) =>
        q.eq(q.field("organizationId" as never), auth.organizationId),
      )
      .collect();
    return rows
      .filter((row: any) => row.deletedAt)
      .map((row: any) => ({
        id: row._id as string,
        name: String(row.name ?? row.label ?? row.boxNumber ?? row._id),
      }));
  },
});

export const archivedTransactions = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const result: Array<{
      id: string;
      table: string;
      number: string;
      amountPaise: number;
      reason: string;
      date: number;
    }> = [];
    for (const table of [
      "sales",
      "purchases",
      "expenses",
      "girviLoans",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("organizationId"), auth.organizationId))
        .collect();
      for (const row of rows as any[])
        if (
          row.deletedAt ||
          row.status === "cancelled" ||
          row.status === "deleted"
        )
          result.push({
            id: row._id,
            table,
            number: row.invoiceNumber ?? row.ticketNumber ?? row.category,
            amountPaise:
              row.totalPaise ?? row.principalPaise ?? row.amountPaise,
            reason: row.cancelReason ?? "Archived",
            date: row.cancelledAt ?? row.deletedAt ?? row.createdAt,
          });
    }
    return result.sort((a, b) => b.date - a.date).slice(0, 200);
  },
});
