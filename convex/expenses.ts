import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { appendCashBankEntry } from "./cashBank";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .take(500);
    return rows.filter((e) => e.status === "recorded");
  },
});

export const create = mutation({
  args: {
    category: v.string(),
    amountPaise: v.number(),
    paymentAccountId: v.optional(v.id("bankAccounts")),
    description: v.optional(v.string()),
    expenseDate: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["accountant"]);
    const category = args.category.trim();
    if (!category) throw new Error("Category is required");
    if (args.amountPaise <= 0) throw new Error("Amount must be greater than zero");

    const expenseId = await ctx.db.insert("expenses", {
      organizationId: auth.organizationId,
      category,
      amountPaise: args.amountPaise,
      paymentAccountId: args.paymentAccountId,
      description: args.description?.trim() || undefined,
      expenseDate: args.expenseDate,
      status: "recorded",
      createdByUserId: auth.userId,
      createdAt: Date.now(),
    });

    if (args.paymentAccountId) {
      await appendCashBankEntry(ctx, auth, {
        accountId: args.paymentAccountId,
        sourceTable: "expenses",
        sourceId: expenseId,
        description: `Expense: ${category}${args.description ? ` — ${args.description}` : ""}`,
        debitPaise: args.amountPaise,
        creditPaise: 0,
      });
    }

    return expenseId;
  },
});

/** Reverses the account debit it made (if any) and marks the row deleted rather than removing it, so the audit trail survives. */
export const remove = mutation({
  args: { id: v.id("expenses"), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required to delete an expense");

    const expense = await ctx.db.get(args.id);
    if (!expense || expense.organizationId !== auth.organizationId) throw new Error("Not found");
    if (expense.status !== "recorded") throw new Error("This expense is already deleted");

    if (expense.paymentAccountId) {
      await appendCashBankEntry(ctx, auth, {
        accountId: expense.paymentAccountId,
        sourceTable: "expenses",
        sourceId: args.id,
        description: `Reversed expense: ${expense.category} (${reason})`,
        debitPaise: 0,
        creditPaise: expense.amountPaise,
      });
    }
    await ctx.db.patch(args.id, { status: "deleted" });

    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "expense.delete",
      entityTable: "expenses",
      entityId: args.id,
      metadata: { category: expense.category, amountPaise: expense.amountPaise, reason },
      createdAt: Date.now(),
    });
  },
});
