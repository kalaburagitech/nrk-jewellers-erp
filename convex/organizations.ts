import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAuthContext, requireRole } from "./lib/auth";

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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
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
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (existingMembership) return { created: false };

    const anyOrganization = await ctx.db.query("organizations").filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
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

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await ctx.db.get(auth.organizationId);
  },
});

export const updateProfile = mutation({
  args: {
    name: v.string(),
    legalName: v.optional(v.string()),
    gstin: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    state: v.optional(v.string()),
    tagline: v.optional(v.string()),
    motto: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const name = args.name.trim();
    if (!name) throw new Error("Business name is required");

    await ctx.db.patch(auth.organizationId, {
      name,
      legalName: args.legalName?.trim() || undefined,
      gstin: args.gstin?.trim() || undefined,
      address: args.address?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      state: args.state?.trim() || undefined,
      tagline: args.tagline?.trim() || undefined,
      motto: args.motto?.trim() || undefined,
    });
  },
});

export const generateLoginImageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLoginImage = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const org = await ctx.db.get(auth.organizationId);
    const previous = org?.loginImageStorageId;
    await ctx.db.patch(auth.organizationId, { loginImageStorageId: args.storageId });
    // Retain previous uploaded assets so historical backups can still reference them.
    void previous;
  },
});

/**
 * Public (no auth) — the sign-in page needs this before anyone is logged
 * in. Phase 1 is single-tenant, so "the org's login image" is unambiguous;
 * this would need rethinking if multi-tenant login ever ships.
 */
export const getPublicLoginImageUrl = query({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db.query("organizations").filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (!org?.loginImageStorageId) return null;
    return await ctx.storage.getUrl(org.loginImageStorageId);
  },
});

export const generateAppIconUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setAppIcon = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const org = await ctx.db.get(auth.organizationId);
    const previous = org?.appIconStorageId;
    await ctx.db.patch(auth.organizationId, { appIconStorageId: args.storageId });
    // Retain previous uploaded assets so historical backups can still reference them.
    void previous;
  },
});

/** Public (no auth) — the installed-app manifest is fetched before anyone is logged in. */
export const getPublicAppIconUrl = query({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db.query("organizations").filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (!org?.appIconStorageId) return null;
    return await ctx.storage.getUrl(org.appIconStorageId);
  },
});

export const generateInvoiceLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setInvoiceLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    const org = await ctx.db.get(auth.organizationId);
    const previous = org?.invoiceLogoStorageId;
    await ctx.db.patch(auth.organizationId, { invoiceLogoStorageId: args.storageId });
    // Retain previous uploaded assets so historical backups can still reference them.
    void previous;
  },
});

export const getInvoiceLogoUrl = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const org = await ctx.db.get(auth.organizationId);
    if (!org?.invoiceLogoStorageId) return null;
    return await ctx.storage.getUrl(org.invoiceLogoStorageId);
  },
});
