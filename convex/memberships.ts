import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { ROLES } from "./schema";
import type { Id } from "./_generated/dataModel";

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

export const removeMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.organizationId !== auth.organizationId) throw new Error("Not found");
    if (membership.userId === auth.userId) throw new Error("You cannot remove your own access");
    if (membership.role === "owner") throw new Error("Cannot remove an Owner — change their role first");
    await ctx.db.delete(args.membershipId);
  },
});

/** Trusted internal insert — only ever called by createStaffAccount after it has already verified the caller is Owner/Admin. Never exposed directly to the client. */
export const insertMembershipInternal = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    branchId: v.optional(v.id("branches")),
    role: ROLES,
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("memberships", {
      userId: args.userId,
      organizationId: args.organizationId,
      branchId: args.branchId,
      role: args.role,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

/**
 * Lets an Owner/Admin create a ready-to-use staff login (email + password +
 * role) directly — no self-signup round trip. Uses @convex-dev/auth's
 * createAccount, which creates the user+credential pair without starting a
 * session for whoever calls it (so the admin stays logged in as themself).
 */
export const createStaffAccount = action({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
    role: ROLES,
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> }> => {
    const access = await ctx.runQuery(api.organizations.getMyAccess);
    if (!access?.membership || (access.membership.role !== "owner" && access.membership.role !== "admin")) {
      throw new Error("Only an Owner/Admin can create staff logins");
    }
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    if (args.password.length < 8) throw new Error("Password must be at least 8 characters");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");

    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: args.password },
      profile: { email, name },
    });

    await ctx.runMutation(internal.memberships.insertMembershipInternal, {
      userId: user._id,
      organizationId: access.membership.organizationId,
      branchId: access.membership.branchId,
      role: args.role,
    });

    return { userId: user._id };
  },
});

export const getFirstOrgAndBranchInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const organization = await ctx.db.query("organizations").first();
    if (!organization) return null;
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_org", (q) => q.eq("organizationId", organization._id))
      .first();
    return { organizationId: organization._id, branchId: branch?._id };
  },
});

/**
 * One-off dev/demo seed: creates the two demo logins (admin@gmail.com /
 * admin123 as Administrator, staff@gmail.com / staff123 as Billing
 * Operator) against the first organization. Not reachable by any client —
 * run once via `npx convex run memberships:seedDemoAccounts`.
 */
export const seedDemoAccounts = internalAction({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.runQuery(internal.memberships.getFirstOrgAndBranchInternal);
    if (!org) throw new Error("No organization exists yet — sign up once first to bootstrap one");

    const demoAccounts: Array<{ email: string; password: string; name: string; role: "admin" | "billing_operator" }> = [
      { email: "admin@gmail.com", password: "admin123", name: "Admin", role: "admin" },
      { email: "staff@gmail.com", password: "staff123", name: "Staff", role: "billing_operator" },
    ];

    const results = [];
    for (const demo of demoAccounts) {
      try {
        const { user } = await createAccount(ctx, {
          provider: "password",
          account: { id: demo.email, secret: demo.password },
          profile: { email: demo.email, name: demo.name },
        });
        await ctx.runMutation(internal.memberships.insertMembershipInternal, {
          userId: user._id,
          organizationId: org.organizationId,
          branchId: org.branchId,
          role: demo.role,
        });
        results.push(`${demo.email}: created`);
      } catch (e) {
        results.push(`${demo.email}: skipped (${e instanceof Error ? e.message : "already exists"})`);
      }
    }
    return results;
  },
});

export const getMembershipEmailInternal = internalQuery({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) return null;
    const user = await ctx.db.get(membership.userId);
    return { organizationId: membership.organizationId, email: user?.email };
  },
});

/** Owner/Admin resets a staff member's password directly — no email-reset flow needed for an internal shop tool. */
export const resetMemberPassword = action({
  args: { membershipId: v.id("memberships"), newPassword: v.string() },
  handler: async (ctx, args) => {
    const access = await ctx.runQuery(api.organizations.getMyAccess);
    if (!access?.membership || (access.membership.role !== "owner" && access.membership.role !== "admin")) {
      throw new Error("Only an Owner/Admin can reset passwords");
    }
    if (args.newPassword.length < 8) throw new Error("Password must be at least 8 characters");

    const target = await ctx.runQuery(internal.memberships.getMembershipEmailInternal, {
      membershipId: args.membershipId,
    });
    if (!target || target.organizationId !== access.membership.organizationId || !target.email) {
      throw new Error("Member not found");
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: target.email, secret: args.newPassword },
    });
  },
});
