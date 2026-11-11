import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAuthContext, requireRole } from "./lib/auth";
import { internal } from "./_generated/api";

/**
 * Returns the signed-in user's membership + organization, or null if they
 * aren't attached to one yet (new signup awaiting an administrator to add them).
 */
export const getMyAccess = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const memberships = await ctx.db.query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .filter((q) => q.eq(q.field("deletedAt"), undefined)).collect();
    const preference = await ctx.db.query("currentOrganizations")
      .withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const membership = memberships.find((item) => item.organizationId === preference?.organizationId) ?? memberships[0];
    if (!membership) return { user: await ctx.db.get(userId), membership: null, organization: null, companies: [] };
    const uniqueMemberships = new Map<string, (typeof memberships)[number]>();
    for (const item of memberships) {
      const key = String(item.organizationId);
      const previous = uniqueMemberships.get(key);
      if (!previous || item._id === membership._id) uniqueMemberships.set(key, item);
    }
    const activeMemberships = await Promise.all([...uniqueMemberships.values()].map(async (item) => {
      const organization = await ctx.db.get(item.organizationId);
      if (!organization || organization.deletedAt) return null;
      return { membershipId: item._id, organizationId: item.organizationId, role: item.role, name: organization.name, companyType: organization.companyType, createdAt: organization.createdAt };
    }));
    const organization = await ctx.db.get(membership.organizationId);
    const user = await ctx.db.get(userId);
    return { user, membership, organization, companies: activeMemberships.filter((item) => item !== null) };
  },
});

export const selectCompany = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to change companies.");
    const membership = await ctx.db.query("memberships")
      .withIndex("by_user_and_org", (q) => q.eq("userId", userId).eq("organizationId", args.organizationId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .filter((q) => q.eq(q.field("deletedAt"), undefined)).first();
    if (!membership) throw new Error("You do not have access to this company.");
    const preference = await ctx.db.query("currentOrganizations")
      .withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (preference) await ctx.db.patch(preference._id, { organizationId: args.organizationId, updatedAt: Date.now() });
    else await ctx.db.insert("currentOrganizations", { userId, organizationId: args.organizationId, updatedAt: Date.now() });
    return { selected: true };
  },
});

export const createCompany = mutation({
  args: {
    name: v.string(),
    companyType: v.union(v.literal("daily_sales"), v.literal("gst_gold"), v.literal("gst_silver")),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    if (auth.role !== "owner") throw new Error("Only the owner can create a company.");
    const name = args.name.trim();
    if (!name) throw new Error("Enter a company name.");
    const duplicate = await ctx.db.query("organizations").filter((q) => q.eq(q.field("name"), name)).filter((q) => q.eq(q.field("deletedAt"), undefined)).first();
    if (duplicate) throw new Error("A company with this name already exists.");
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name,
      companyType: args.companyType,
      tagline: args.companyType === "daily_sales" ? "Daily Sales" : "GST Billing",
      state: "Karnataka",
      createdAt: now,
    });
    const branchId = await ctx.db.insert("branches", { organizationId, name: "Main Branch", isDefault: true, createdAt: now });
    await ctx.db.insert("memberships", { userId: auth.userId, organizationId, branchId, role: "owner", status: "active", createdAt: now });
    const purities = args.companyType === "gst_silver"
      ? [{ metal: "silver" as const, label: "Silver 999", purityBasisPoints: 9990 }, { metal: "silver" as const, label: "Silver 925", purityBasisPoints: 9250 }]
      : [{ metal: "gold" as const, label: "24K", purityBasisPoints: 9990 }, { metal: "gold" as const, label: "22K", purityBasisPoints: 9160 }, { metal: "gold" as const, label: "18K", purityBasisPoints: 7500 }, { metal: "gold" as const, label: "14K", purityBasisPoints: 5850 }];
    for (const purity of purities) await ctx.db.insert("metalPurities", { organizationId, ...purity, isActive: true });
    await ctx.db.insert("taxConfigurations", { organizationId, name: "Jewellery GST 3%", cgstBasisPoints: 150, sgstBasisPoints: 150, igstBasisPoints: 300, isActive: true });
    await ctx.db.insert("bankAccounts", { organizationId, name: "Cash in hand", type: "cash", openingBalancePaise: 0, currentBalancePaise: 0, isActive: true, createdAt: now });
    await ctx.db.insert("currentOrganizations", { userId: auth.userId, organizationId, updatedAt: now });
    return { organizationId };
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
  handler: async (ctx, args): Promise<{ created: boolean; pending?: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.runMutation(internal.organizationBootstrap.bootstrapFirstOwnerInternal, {
      userId,
      organizationName: args.organizationName,
    });
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
