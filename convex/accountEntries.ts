import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { appendCashBankEntry } from "./cashBank";

export const KIND = v.union(
  v.literal("other_income"),
  v.literal("capital_in"),
  v.literal("drawings"),
  v.literal("loan_taken"),
  v.literal("loan_repaid"),
  v.literal("loan_interest"),
  v.literal("fixed_asset"),
);

/** Money coming in to the business account for these kinds; the rest go out. */
const MONEY_IN = new Set(["other_income", "capital_in", "loan_taken"]);

const LABEL: Record<string, string> = {
  other_income: "Other income",
  capital_in: "Capital added",
  drawings: "Owner drawings",
  loan_taken: "Loan received",
  loan_repaid: "Loan repaid",
  loan_interest: "Loan interest",
  fixed_asset: "Fixed asset bought",
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const rows = await ctx.db.query("accountEntries").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).order("desc").collect();
    return rows.filter((r) => !r.deletedAt && r.status === "recorded");
  },
});

export const create = mutation({
  args: {
    kind: KIND,
    name: v.string(),
    amountPaise: v.number(),
    entryDate: v.number(),
    paymentAccountId: v.optional(v.id("bankAccounts")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["accountant"]);
    const name = args.name.trim().slice(0, 60);
    if (!name) throw new Error("Enter a name (category, lender or asset)");
    if (!Number.isSafeInteger(args.amountPaise) || args.amountPaise <= 0) throw new Error("Amount must be greater than zero");
    const id = await ctx.db.insert("accountEntries", {
      organizationId: auth.organizationId,
      kind: args.kind,
      name,
      amountPaise: args.amountPaise,
      entryDate: args.entryDate,
      paymentAccountId: args.paymentAccountId,
      description: args.description?.trim().slice(0, 200) || undefined,
      status: "recorded",
      createdByUserId: auth.userId,
      createdAt: Date.now(),
    });
    if (args.paymentAccountId) {
      const moneyIn = MONEY_IN.has(args.kind);
      await appendCashBankEntry(ctx, auth, {
        accountId: args.paymentAccountId,
        sourceTable: "account_entries",
        sourceId: id,
        description: `${LABEL[args.kind]}: ${name}`,
        debitPaise: moneyIn ? 0 : args.amountPaise,
        creditPaise: moneyIn ? args.amountPaise : 0,
      });
    }
    await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: `${args.kind}.create`, entityTable: "accountEntries", entityId: id, metadata: { name, amountPaise: args.amountPaise }, createdAt: Date.now() });
    return id;
  },
});

/** Marks the entry deleted and reverses its cash/bank posting. */
export const remove = mutation({
  args: { id: v.id("accountEntries"), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required to delete an entry");
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.deletedAt || entry.organizationId !== auth.organizationId || entry.status !== "recorded") throw new Error("Not found");
    if (entry.paymentAccountId) {
      const moneyIn = MONEY_IN.has(entry.kind);
      await appendCashBankEntry(ctx, auth, {
        accountId: entry.paymentAccountId,
        sourceTable: "account_entries",
        sourceId: args.id,
        description: `Reversed ${LABEL[entry.kind].toLowerCase()}: ${entry.name} (${reason})`,
        debitPaise: moneyIn ? entry.amountPaise : 0,
        creditPaise: moneyIn ? 0 : entry.amountPaise,
      });
    }
    await ctx.db.patch(args.id, { status: "deleted" });
    await ctx.db.insert("auditLogs", { organizationId: auth.organizationId, userId: auth.userId, action: `${entry.kind}.delete`, entityTable: "accountEntries", entityId: args.id, metadata: { reason }, createdAt: Date.now() });
  },
});
