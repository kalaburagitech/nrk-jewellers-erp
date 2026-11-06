import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Returns the signed-in user's membership + organization, or null if they
 * aren't attached to one yet (new signup awaiting an administrator to add them).
 */
export const getMyAccess = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (!membership) return { user: await ctx.db.get(userId), membership: null, organization: null };

    const organization = await ctx.db.get(membership.organizationId);
    const user = await ctx.db.get(userId);
    return { user, membership, organization };
  },
});

/**
 * Idempotent first-run bootstrap: the very first person to sign in becomes
 * the Owner of a freshly created organization. Anyone who signs in after
 * that with no membership is left pending — an Owner/Admin must add them via
 * Settings > Users and Roles (not built in this milestone).
 */
export const ensureBootstrapped = mutation({
  args: {
    organizationName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingMembership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existingMembership) return { created: false };

    const anyOrganization = await ctx.db.query("organizations").first();
    if (anyOrganization) {
      // An org already exists; this user needs to be invited explicitly.
      return { created: false, pending: true };
    }

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: args.organizationName ?? "NRK Jewellers",
      createdAt: now,
    });
    const branchId = await ctx.db.insert("branches", {
      organizationId,
      name: "Main Branch",
      isDefault: true,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      userId,
      organizationId,
      branchId,
      role: "owner",
      status: "active",
      createdAt: now,
    });

    // Seed boxes 101-200 per SRS §6.
    for (let boxNumber = 101; boxNumber <= 200; boxNumber++) {
      await ctx.db.insert("boxes", {
        organizationId,
        boxNumber,
        itemCount: 0,
        isActive: true,
        createdAt: now,
      });
    }

    return { created: true };
  },
});
