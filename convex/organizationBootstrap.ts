import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Creates the first organization and essential empty operational defaults. */
export const bootstrapFirstOwnerInternal = internalMutation({
  args: { userId: v.id("users"), organizationName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existingMembership = await ctx.db.query("memberships")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q => q.eq(q.field("deletedAt"), undefined)).first();
    if (existingMembership) return { created: false };
    const anyOrganization = await ctx.db.query("organizations")
      .filter(q => q.eq(q.field("deletedAt"), undefined)).first();
    if (anyOrganization) return { created: false, pending: true };

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: args.organizationName ?? "NR Karakalli Jewellers",
      tagline: "Gold and Silver Merchants",
      motto: "The Name of Purity",
      address: "Near Maruti Temple, Basaveshwara Chowk road, Shahapur",
      phone: "+91 9972786818 / +91 7760000717",
      state: "Karnataka",
      createdAt: now,
    });
    const branchId = await ctx.db.insert("branches", {
      organizationId,
      name: "Main Branch",
      isDefault: true,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      userId: args.userId,
      organizationId,
      branchId,
      role: "owner",
      status: "active",
      createdAt: now,
    });
    for (const purity of [
      { metal: "gold" as const, label: "24K", purityBasisPoints: 9990 },
      { metal: "gold" as const, label: "22K", purityBasisPoints: 9160 },
      { metal: "gold" as const, label: "18K", purityBasisPoints: 7500 },
      { metal: "gold" as const, label: "14K", purityBasisPoints: 5850 },
      { metal: "silver" as const, label: "Silver 999", purityBasisPoints: 9990 },
      { metal: "silver" as const, label: "Silver 925", purityBasisPoints: 9250 },
    ]) await ctx.db.insert("metalPurities", { organizationId, ...purity, isActive: true });
    await ctx.db.insert("taxConfigurations", {
      organizationId, name: "Jewellery GST 3%", cgstBasisPoints: 150,
      sgstBasisPoints: 150, igstBasisPoints: 300, isActive: true,
    });
    await ctx.db.insert("bankAccounts", {
      organizationId, name: "Cash in hand", type: "cash", openingBalancePaise: 0,
      currentBalancePaise: 0, isActive: true, createdAt: now,
    });
    return { created: true };
  },
});
