import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendCashBankEntry } from "./cashBank";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    return ctx.db
      .query("girviLoans")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

export const getPrintData = query({
  args: { id: v.id("girviLoans") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const loan = await ctx.db.get(args.id);
    if (!loan || loan.deletedAt || loan.organizationId !== auth.organizationId) throw new Error("Girvi ticket not found in this company.");
    const organization = await ctx.db.get(auth.organizationId);
    const logoUrl = organization?.invoiceLogoStorageId ? await ctx.storage.getUrl(organization.invoiceLogoStorageId) : null;
    const receipts = await ctx.db.query("girviReceipts").withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect();
    return { loan, organization, logoUrl, receipts };
  },
});
export const create = mutation({
  args: {
    accountId: v.id("bankAccounts"),
    ticketNumber: v.string(),
    customerName: v.string(),
    phone: v.string(),
    metal: v.union(v.literal("gold"), v.literal("silver")),
    description: v.string(),
    weightMg: v.number(),
    pieceCount: v.optional(v.number()),
    principalPaise: v.number(),
    monthlyInterestBasisPoints: v.number(),
    issuedAt: v.number(),
    dueAt: v.number(),
    storageLocation: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (
      !args.ticketNumber.trim() ||
      !args.customerName.trim() ||
      !args.description.trim() ||
      !args.storageLocation.trim()
    )
      throw new Error(
        "Ticket, customer, metal description and storage location are required",
      );
    if (
      ![
        args.weightMg,
        args.principalPaise,
        args.monthlyInterestBasisPoints,
        args.issuedAt,
        args.dueAt,
      ].every(Number.isSafeInteger) ||
      args.weightMg <= 0 ||
      (args.pieceCount !== undefined && (!Number.isSafeInteger(args.pieceCount) || args.pieceCount < 1)) ||
      args.principalPaise <= 0 ||
      args.monthlyInterestBasisPoints < 0 ||
      args.monthlyInterestBasisPoints > 10000 ||
      args.dueAt < args.issuedAt ||
      args.issuedAt > Date.now()
    )
      throw new Error("Check the weight, amount, interest and dates");
    const loans = await ctx.db
      .query("girviLoans")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    if (
      loans.some(
        (l) =>
          l.ticketNumber.toLowerCase() ===
          args.ticketNumber.trim().toLowerCase(),
      )
    )
      throw new Error("Ticket number already exists");
    const account = await ctx.db.get(args.accountId);
    if (
      !account ||
      account.deletedAt ||
      account.organizationId !== auth.organizationId ||
      !account.isActive
    )
      throw new Error("Select an active cash or bank account");
    const id = await ctx.db.insert("girviLoans", {
      ...args,
      ticketNumber: args.ticketNumber.trim(),
      organizationId: auth.organizationId,
      status: "active",
      principalRepaidPaise: 0,
      interestReceivedPaise: 0,
      createdByUserId: auth.userId,
      createdAt: Date.now(),
    });
    await appendCashBankEntry(ctx, auth, {
      accountId: args.accountId,
      sourceTable: "girviLoans",
      sourceId: id,
      description: `Girvi loan issued · ${args.ticketNumber}`,
      debitPaise: args.principalPaise,
      creditPaise: 0,
    });
    return id;
  },
});
export const receive = mutation({
  args: {
    id: v.id("girviLoans"),
    principalPaise: v.number(),
    interestPaise: v.number(),
    release: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const loan = await ctx.db.get(args.id);
    if (
      !loan ||
      loan.deletedAt ||
      loan.organizationId !== auth.organizationId ||
      loan.status !== "active"
    )
      throw new Error("Active loan not found");
    if (
      ![args.principalPaise, args.interestPaise].every(Number.isSafeInteger) ||
      args.principalPaise < 0 ||
      args.interestPaise < 0 ||
      args.principalPaise + args.interestPaise <= 0 ||
      args.principalPaise > loan.principalPaise - loan.principalRepaidPaise
    )
      throw new Error(
        "Enter a valid repayment within the outstanding principal",
      );
    const repaid = loan.principalRepaidPaise + args.principalPaise;
    if (args.release && repaid !== loan.principalPaise)
      throw new Error("Repay all principal before releasing the metal");
    await appendCashBankEntry(ctx, auth, {
      accountId: loan.accountId,
      sourceTable: "girviLoans",
      sourceId: loan._id,
      description: `Girvi repayment · ${loan.ticketNumber}`,
      debitPaise: 0,
      creditPaise: args.principalPaise + args.interestPaise,
    });
    await ctx.db.insert("girviReceipts", {
      organizationId: auth.organizationId,
      loanId: loan._id,
      principalPaise: args.principalPaise,
      interestPaise: args.interestPaise,
      createdAt: Date.now(),
      createdByUserId: auth.userId,
    });
    await ctx.db.patch(loan._id, {
      principalRepaidPaise: repaid,
      interestReceivedPaise: loan.interestReceivedPaise + args.interestPaise,
      status: args.release ? "released" : "active",
      releasedAt: args.release ? Date.now() : undefined,
    });
  },
});
export const receipts = query({
  args: { id: v.id("girviLoans") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const loan = await ctx.db.get(args.id);
    if (!loan || loan.deletedAt || loan.organizationId !== auth.organizationId)
      throw new Error("Not found");
    return ctx.db
      .query("girviReceipts")
      .withIndex("by_loan", (q) => q.eq("loanId", args.id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});
export const cancel = mutation({
  args: { id: v.id("girviLoans"), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const loan = await ctx.db.get(args.id);
    if (
      !loan ||
      loan.deletedAt ||
      loan.organizationId !== auth.organizationId ||
      loan.status !== "active"
    )
      throw new Error("Active loan not found");
    if (!args.reason.trim()) throw new Error("Reason required");
    const receipts = await ctx.db
      .query("girviReceipts")
      .withIndex("by_loan", (q) => q.eq("loanId", args.id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (receipts)
      throw new Error(
        "A loan with repayments cannot be deleted. Settle it and release the metal instead.",
      );
    await appendCashBankEntry(ctx, auth, {
      accountId: loan.accountId,
      sourceTable: "girviLoans",
      sourceId: loan._id,
      description: `Girvi loan cancellation · ${loan.ticketNumber}`,
      debitPaise: 0,
      creditPaise: loan.principalPaise,
    });
    await ctx.db.patch(args.id, { status: "cancelled" });
    await ctx.db.insert("auditLogs", {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "girvi.cancel",
      entityTable: "girviLoans",
      entityId: args.id,
      metadata: { reason: args.reason },
      createdAt: Date.now(),
    });
  },
});
