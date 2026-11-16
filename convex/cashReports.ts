import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";

/**
 * Cash Flow: cash-in-hand movements. Bill payments in cash live in
 * `payments`; manual cash entries, transfers and expenses paid from a cash
 * account live in `cashBankLedgerEntries` (cash-type accounts). Both are
 * merged here — they never overlap.
 */
export const cashFlow = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [accounts, payments, customers, suppliers] = await Promise.all([
      ctx.db.query("bankAccounts").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("payments").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("customers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("suppliers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ]);
    const cashAccounts = accounts.filter((a) => !a.deletedAt && a.type === "cash");
    const name = new Map<string, string>([...customers, ...suppliers].map((p) => [String(p._id), p.name]));

    type Move = { id: string; date: number; name: string; txnType: string; inPaise: number; outPaise: number };
    const moves: Move[] = [];
    for (const p of payments) {
      if (p.deletedAt || p.mode !== "cash") continue;
      const isIn = p.direction === "receipt";
      moves.push({
        id: String(p._id), date: p.createdAt, name: name.get(p.partyId) ?? "—",
        txnType: p.sourceTable === "sales" ? (isIn ? "Sale" : "Sale Return") : p.sourceTable === "purchases" ? (isIn ? "Purchase Return" : "Purchase") : isIn ? "Payment-In" : "Payment-Out",
        inPaise: isIn ? p.amountPaise : 0, outPaise: isIn ? 0 : p.amountPaise,
      });
    }
    let opening = cashAccounts.reduce((a, c) => a + c.openingBalancePaise, 0);
    for (const acc of cashAccounts) {
      const entries = await ctx.db.query("cashBankLedgerEntries").withIndex("by_account", (q) => q.eq("accountId", acc._id)).collect();
      for (const e of entries) {
        if (e.deletedAt || e.sourceTable === "cash_bank_opening") continue;
        moves.push({
          id: String(e._id), date: e.createdAt, name: e.description,
          txnType: e.sourceTable === "expenses" ? "Expense" : e.sourceTable === "cash_bank_transfer" ? "Transfer" : "Cash Adjustment",
          inPaise: e.creditPaise, outPaise: e.debitPaise,
        });
      }
    }
    moves.sort((a, b) => a.date - b.date);
    const rows = [];
    for (const m of moves) {
      if (m.date < args.startDate) {
        opening += m.inPaise - m.outPaise;
        continue;
      }
      if (m.date > args.endDate) break;
      rows.push(m);
    }
    let running = opening;
    const withBalance = rows.map((m) => ({ ...m, balancePaise: (running += m.inPaise - m.outPaise) }));
    return { openingPaise: opening, closingPaise: running, rows: withBalance.reverse() };
  },
});

/** Bank (or cash) account statement for a period with running balance. */
export const accountStatement = query({
  args: { accountId: v.id("bankAccounts"), startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.deletedAt || account.organizationId !== auth.organizationId) return null;
    const entries = (await ctx.db.query("cashBankLedgerEntries").withIndex("by_account", (q) => q.eq("accountId", args.accountId)).collect())
      .filter((e) => !e.deletedAt)
      .sort((a, b) => a.createdAt - b.createdAt);
    let opening = 0;
    const rows = [];
    for (const e of entries) {
      if (e.createdAt < args.startDate) {
        opening = e.balancePaise;
        continue;
      }
      if (e.createdAt > args.endDate) break;
      rows.push({ id: String(e._id), date: e.createdAt, description: e.description, depositPaise: e.creditPaise, withdrawalPaise: e.debitPaise, balancePaise: e.balancePaise });
    }
    return { openingPaise: opening, closingPaise: rows.at(-1)?.balancePaise ?? opening, rows: rows.reverse() };
  },
});
