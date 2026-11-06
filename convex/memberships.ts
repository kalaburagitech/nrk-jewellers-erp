import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { ROLES } from "./schema";

export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .collect();

    return await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          _id: m._id,
          userId: m.userId,
          name: user?.name ?? user?.email ?? "Unknown",
          email: user?.email,
          role: m.role,
          status: m.status,
          createdAt: m.createdAt,
        };
      }),
    );
  },
});

/** Users who have signed up but hold no membership anywhere yet — awaiting an Owner/Admin to add them. */
export const listPendingUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthContext(ctx);
    const users = await ctx.db.query("users").collect();
    const pending = [];
    for (const user of users) {
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (!existing) pending.push({ _id: user._id, name: user.name ?? user.email ?? "Unknown", email: user.email });
    }
    return pending;
  },
});

export const addMember = mutation({
  args: {
    userId: v.id("users"),
    role: ROLES,
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_org", (q) => q.eq("userId", args.userId).eq("organizationId", auth.organizationId))
      .first();
    if (existing) throw new Error("This user already belongs to the organization");

    await ctx.db.insert("memberships", {
      userId: args.userId,
      organizationId: auth.organizationId,
      branchId: auth.branchId,
      role: args.role,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const updateMemberRole = mutation({
  args: { membershipId: v.id("memberships"), role: ROLES },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.organizationId !== auth.organizationId) throw new Error("Not found");
    if (membership.userId === auth.userId) throw new Error("You cannot change your own role");
    await ctx.db.patch(args.membershipId, { role: args.role });
  },
});

export const setMemberStatus = mutation({
  args: { membershipId: v.id("memberships"), status: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.organizationId !== auth.organizationId) throw new Error("Not found");
    if (membership.userId === auth.userId) throw new Error("You cannot disable your own access");
    await ctx.db.patch(args.membershipId, { status: args.status });
  },
});
