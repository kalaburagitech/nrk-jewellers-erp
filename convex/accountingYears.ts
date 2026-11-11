import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const list = query({ args: {}, handler: async (ctx) => {
  const auth = await requireAuthContext(ctx);
  return ctx.db.query("accountingYears").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).order("desc").collect();
} });

export const create = mutation({
  args: { name: v.string(), startsAt: v.number(), endsAt: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    if (auth.role !== "owner") throw new Error("Only the owner can manage booking years.");
    const name = args.name.trim();
    if (!name || args.startsAt >= args.endsAt) throw new Error("Enter a name and a valid start and end date.");
    const years = await ctx.db.query("accountingYears").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect();
    if (years.some((year) => args.startsAt <= year.endsAt && args.endsAt >= year.startsAt)) throw new Error("This date range overlaps an existing booking year.");
    return ctx.db.insert("accountingYears", { organizationId: auth.organizationId, name, startsAt: args.startsAt, endsAt: args.endsAt, status: "open", createdAt: Date.now() });
  },
});

export const setClosed = mutation({
  args: { id: v.id("accountingYears"), closed: v.boolean() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    if (auth.role !== "owner") throw new Error("Only the owner can close or reopen a booking year.");
    const year = await ctx.db.get(args.id);
    if (!year || year.organizationId !== auth.organizationId) throw new Error("Booking year not found in this company.");
    await ctx.db.patch(year._id, { status: args.closed ? "closed" : "open", closedAt: args.closed ? Date.now() : undefined });
  },
});
