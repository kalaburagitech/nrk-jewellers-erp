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

  // View-only staff may read everything but never write. Enforced here, in the
  // one helper every org-scoped mutation already calls, so no screen can be
  // missed. Query contexts have a read-only db without `insert`.
  if (membership.role === "staff" && isMutationContext(ctx)) {
    throw new ConvexError(VIEW_ONLY_MESSAGE);
  }

  return {
    userId,
    organizationId: membership.organizationId,
    branchId: membership.branchId,
    role: membership.role,
    membershipId: membership._id,
  };
}

export const VIEW_ONLY_MESSAGE = "View-only access: your login can see data but cannot add, edit or delete. Ask the Owner to make this change.";

function isMutationContext(ctx: QueryCtx | MutationCtx): ctx is MutationCtx {
  return typeof (ctx.db as Partial<MutationCtx["db"]>).insert === "function";
}

/** Throws unless the caller is the Owner. Used for shop-wide customisation (custom fields, dropdown lists). */
export function requireOwner(auth: AuthContext) {
  if (auth.role !== "owner") {
    throw new ConvexError("Only the Owner can change this setting");
  }
}

const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  admin: 90,
  accountant: 50,
  purchase_manager: 50,
  inventory_manager: 50,
  billing_operator: 40,
  staff: 10,
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

/**
 * Who may see internal purchase cost (item purchase price, sale-line cost
 * snapshot, profit). Billing counter staff and view-only staff never see it,
 * so it can't leak onto a customer-facing screen.
 */
export const COST_VIEW_ROLES: Role[] = ["owner", "admin", "accountant", "purchase_manager", "inventory_manager"];
export function canViewCost(role: Role) {
  return COST_VIEW_ROLES.includes(role);
}

/** Who may bill an item at a price different from its saved selling price. Every override is audit-logged. */
export function canOverridePrice(role: Role) {
  return role === "owner" || role === "admin";
}
