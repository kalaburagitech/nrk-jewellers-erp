import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(500);
  },
});

/** Adds each customer's current outstanding balance. One extra indexed read per customer — fine at shop scale; revisit with a maintained summary if that changes. */
export const listWithOutstanding = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(500);

    return customers.map((customer) => ({
      ...customer,
      outstandingPaise: customer.currentBalancePaise ?? customer.openingBalancePaise,
    }));
  },
});

export const getLedger = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.deletedAt || customer.organizationId !== auth.organizationId) throw new Error("Not found");
    const entries = await ctx.db
      .query("customerLedgerEntries")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(200);
    return {
      outstandingPaise: entries[0]?.balancePaise ?? customer.openingBalancePaise,
      entries,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    gstin: v.optional(v.string()),
    customerType: v.union(v.literal("cash"), v.literal("regular"), v.literal("credit")),
    creditLimitPaise: v.optional(v.number()),
    dueDateMs: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");

    return await ctx.db.insert("customers", {
      organizationId: auth.organizationId,
      name,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      address: args.address?.trim() || undefined,
      gstin: args.gstin?.trim() || undefined,
      customerType: args.customerType,
      creditLimitPaise: args.creditLimitPaise,
      dueDateMs: args.dueDateMs,
      openingBalancePaise: 0,
      notes: args.notes?.trim() || undefined,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("customers"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    gstin: v.optional(v.string()),
    customerType: v.union(v.literal("cash"), v.literal("regular"), v.literal("credit")),
    creditLimitPaise: v.optional(v.number()),
    dueDateMs: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");

    await ctx.db.patch(args.id, {
      name,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      address: args.address?.trim() || undefined,
      gstin: args.gstin?.trim() || undefined,
      customerType: args.customerType,
      creditLimitPaise: args.creditLimitPaise,
      dueDateMs: args.dueDateMs,
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const setDueDate = mutation({
  args: { id: v.id("customers"), dueDateMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { dueDateMs: args.dueDateMs });
  },
});

export const setActive = mutation({
  args: { id: v.id("customers"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});

/** One-off data repair: backfills currentBalancePaise for customers created before the field existed. Not exposed in the UI. */
export const recomputeBalances = internalMutation({
  args: {},
  handler: async (ctx) => {
    const customers = await ctx.db.query("customers").filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    for (const customer of customers) {
      if (customer.currentBalancePaise !== undefined) continue;
      const latest = await ctx.db
        .query("customerLedgerEntries")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .order("desc")
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
      await ctx.db.patch(customer._id, {
        currentBalancePaise: latest?.balancePaise ?? customer.openingBalancePaise,
      });
    }
  },
});
