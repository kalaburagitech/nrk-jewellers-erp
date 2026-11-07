import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("suppliers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(500);
  },
});

/** Adds each supplier's current outstanding balance. One extra indexed read per supplier — fine at shop scale (tens to low hundreds of suppliers); revisit with a maintained summary if that changes. */
export const listWithOutstanding = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(500);

    return suppliers.map((supplier) => ({
      ...supplier,
      outstandingPaise: supplier.currentBalancePaise ?? supplier.openingBalancePaise,
    }));
  },
});

export const getLedger = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.deletedAt || supplier.organizationId !== auth.organizationId) throw new Error("Not found");
    const entries = await ctx.db
      .query("supplierLedgerEntries")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .take(200);
    return {
      outstandingPaise: entries[0]?.balancePaise ?? supplier.openingBalancePaise,
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
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");

    return await ctx.db.insert("suppliers", {
      organizationId: auth.organizationId,
      name,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      address: args.address?.trim() || undefined,
      gstin: args.gstin?.trim() || undefined,
      openingBalancePaise: 0,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("suppliers"),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    gstin: v.optional(v.string()),
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
    });
  },
});

export const setActive = mutation({
  args: { id: v.id("suppliers"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.deletedAt || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});

/** One-off data repair: backfills currentBalancePaise for suppliers created before the field existed. Not exposed in the UI. */
export const recomputeBalances = internalMutation({
  args: {},
  handler: async (ctx) => {
    const suppliers = await ctx.db.query("suppliers").filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    for (const supplier of suppliers) {
      if (supplier.currentBalancePaise !== undefined) continue;
      const latest = await ctx.db
        .query("supplierLedgerEntries")
        .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
        .order("desc")
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
      await ctx.db.patch(supplier._id, {
        currentBalancePaise: latest?.balancePaise ?? supplier.openingBalancePaise,
      });
    }
  },
});
