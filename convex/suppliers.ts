import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db
      .query("suppliers")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
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
      .take(500);

    return await Promise.all(
      suppliers.map(async (supplier) => {
        const latest = await ctx.db
          .query("supplierLedgerEntries")
          .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
          .order("desc")
          .first();
        return { ...supplier, outstandingPaise: latest?.balancePaise ?? supplier.openingBalancePaise };
      }),
    );
  },
});

export const getLedger = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.organizationId !== auth.organizationId) throw new Error("Not found");
    const entries = await ctx.db
      .query("supplierLedgerEntries")
      .withIndex("by_supplier", (q) => q.eq("supplierId", args.supplierId))
      .order("desc")
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
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.organizationId !== auth.organizationId) throw new Error("Not found");
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
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.organizationId !== auth.organizationId) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});
