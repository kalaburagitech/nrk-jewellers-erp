import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAuthContext, requireRole, type AuthContext } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const accounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .collect();
    return accounts.map((a) => ({ ...a, balancePaise: a.currentBalancePaise ?? a.openingBalancePaise }));
  },
});

export const getLedger = query({
  args: { accountId: v.id("bankAccounts") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.organizationId !== auth.organizationId) throw new Error("Not found");
    const entries = await ctx.db
      .query("cashBankLedgerEntries")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .order("desc")
      .take(200);
    return {
      balancePaise: entries[0]?.balancePaise ?? account.openingBalancePaise,
      entries,
    };
  },
});

/** Appends one ledger row for an account and returns the new running balance — the only place balances are ever computed. */
async function appendEntry(
  ctx: MutationCtx,
  auth: AuthContext,
  args: { accountId: Id<"bankAccounts">; sourceTable: string; sourceId: string; description: string; debitPaise: number; creditPaise: number },
) {
  const account = await ctx.db.get(args.accountId);
  if (!account || account.organizationId !== auth.organizationId) throw new Error("Account not found");
  const priorBalance = account.currentBalancePaise ?? account.openingBalancePaise;
  const balancePaise = priorBalance + args.creditPaise - args.debitPaise;

  await ctx.db.insert("cashBankLedgerEntries", {
    organizationId: auth.organizationId,
    accountId: args.accountId,
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
    description: args.description,
    debitPaise: args.debitPaise,
    creditPaise: args.creditPaise,
    balancePaise,
    createdByUserId: auth.userId,
    createdAt: Date.now(),
  });
  await ctx.db.patch(args.accountId, { currentBalancePaise: balancePaise });
  return balancePaise;
}

export const createAccount = mutation({
  args: {
    name: v.string(),
    type: v.union(v.literal("cash"), v.literal("bank")),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    openingBalancePaise: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");

    const accountId = await ctx.db.insert("bankAccounts", {
      organizationId: auth.organizationId,
      name,
      type: args.type,
      bankName: args.bankName?.trim() || undefined,
      accountNumber: args.accountNumber?.trim() || undefined,
      openingBalancePaise: args.openingBalancePaise,
      currentBalancePaise: args.openingBalancePaise,
      isActive: true,
      createdAt: Date.now(),
    });

    if (args.openingBalancePaise !== 0) {
      await ctx.db.insert("cashBankLedgerEntries", {
        organizationId: auth.organizationId,
        accountId,
        sourceTable: "cash_bank_opening",
        sourceId: accountId,
        description: "Opening balance",
        debitPaise: args.openingBalancePaise < 0 ? -args.openingBalancePaise : 0,
        creditPaise: args.openingBalancePaise > 0 ? args.openingBalancePaise : 0,
        balancePaise: args.openingBalancePaise,
        createdByUserId: auth.userId,
        createdAt: Date.now(),
      });
    }

    return accountId;
  },
});

export const setActive = mutation({
  args: { id: v.id("bankAccounts"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});

/** A deposit (money in) or withdrawal (money out) that isn't a transfer between two of this org's own accounts — e.g. owner drawings, bank interest, a cash sale not routed through the billing screen. */
export const recordTransaction = mutation({
  args: {
    accountId: v.id("bankAccounts"),
    direction: v.union(v.literal("in"), v.literal("out")),
    amountPaise: v.number(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["accountant"]);
    if (args.amountPaise <= 0) throw new Error("Amount must be greater than zero");
    const description = args.description.trim();
    if (!description) throw new Error("A description is required");

    const balancePaise = await appendEntry(ctx, auth, {
      accountId: args.accountId,
      sourceTable: "cash_bank_transaction",
      sourceId: crypto.randomUUID(),
      description,
      debitPaise: args.direction === "out" ? args.amountPaise : 0,
      creditPaise: args.direction === "in" ? args.amountPaise : 0,
    });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "cash_bank.transaction",
      entityTable: "bankAccounts",
      entityId: args.accountId,
      metadata: { direction: args.direction, amountPaise: args.amountPaise, description, balancePaise },
      createdAt: Date.now(),
    });
  },
});

/** Moves money between two of this org's own accounts (e.g. depositing cash into the bank) — always writes both legs so the pair nets to zero. */
export const transfer = mutation({
  args: {
    fromAccountId: v.id("bankAccounts"),
    toAccountId: v.id("bankAccounts"),
    amountPaise: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["accountant"]);
    if (args.fromAccountId === args.toAccountId) throw new Error("Pick two different accounts");
    if (args.amountPaise <= 0) throw new Error("Amount must be greater than zero");

    const [fromAccount, toAccount] = await Promise.all([
      ctx.db.get(args.fromAccountId),
      ctx.db.get(args.toAccountId),
    ]);
    if (!fromAccount || fromAccount.organizationId !== auth.organizationId) throw new Error("Source account not found");
    if (!toAccount || toAccount.organizationId !== auth.organizationId) throw new Error("Destination account not found");

    const transferId = crypto.randomUUID();
    const description = args.description?.trim() || `Transfer to ${toAccount.name}`;
    await appendEntry(ctx, auth, {
      accountId: args.fromAccountId,
      sourceTable: "cash_bank_transfer",
      sourceId: transferId,
      description,
      debitPaise: args.amountPaise,
      creditPaise: 0,
    });
    await appendEntry(ctx, auth, {
      accountId: args.toAccountId,
      sourceTable: "cash_bank_transfer",
      sourceId: transferId,
      description: args.description?.trim() || `Transfer from ${fromAccount.name}`,
      debitPaise: 0,
      creditPaise: args.amountPaise,
    });
  },
});
