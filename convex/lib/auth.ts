import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Role = Doc<"memberships">["role"];

export type AuthContext = {
  userId: Id<"users">;
  organizationId: Id<"organizations">;
  branchId: Id<"branches"> | undefined;
  role: Role;
  membershipId: Id<"memberships">;
};

/**
 * Resolves the signed-in user's active membership. Every org-scoped query or
 * mutation must call this instead of trusting a client-supplied organizationId.
 */
export async function requireAuthContext(ctx: QueryCtx | MutationCtx): Promise<AuthContext> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Not authenticated");
  }

  const preference = await ctx.db.query("currentOrganizations")
    .withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").first();
  const selectedMembership = preference ? await ctx.db.query("memberships")
    .withIndex("by_user_and_org", (q) => q.eq("userId", userId).eq("organizationId", preference.organizationId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first() : null;
  const membership = selectedMembership ?? await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first();

  if (!membership) {
    throw new ConvexError("No active organization membership");
  }

  return {
    userId,
    organizationId: membership.organizationId,
    branchId: membership.branchId,
    role: membership.role,
    membershipId: membership._id,
  };
}

const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  admin: 90,
  accountant: 50,
  purchase_manager: 50,
  inventory_manager: 50,
  billing_operator: 40,
};

/** Throws unless the caller's role is one of `allowed`. Owner/admin always pass. */
export function requireRole(auth: AuthContext, allowed: Role[]) {
  if (auth.role === "owner" || auth.role === "admin") return;
  if (!allowed.includes(auth.role)) {
    throw new ConvexError(`Role '${auth.role}' is not permitted to perform this action`);
  }
}

export function roleAtLeast(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
