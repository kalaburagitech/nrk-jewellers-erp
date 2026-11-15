import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireOwner } from "./lib/auth";

/** Shop-wide preferences the Owner controls from Settings → General. */
export type AppPreferences = {
  /** Optional document types; turning one off hides it from the menu. */
  documents: { quotations: boolean; proforma: boolean; orders: boolean; challans: boolean };
  /** Paper the invoice print screen opens with. */
  defaultPrintTemplate: "half-a4" | "full-a4" | "thermal";
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  documents: { quotations: true, proforma: true, orders: true, challans: true },
  defaultPrintTemplate: "half-a4",
};

const KEY = "app_preferences";

const preferencesValidator = v.object({
  documents: v.object({ quotations: v.boolean(), proforma: v.boolean(), orders: v.boolean(), challans: v.boolean() }),
  defaultPrintTemplate: v.union(v.literal("half-a4"), v.literal("full-a4"), v.literal("thermal")),
});

export const get = query({
  args: {},
  handler: async (ctx): Promise<AppPreferences> => {
    const auth = await requireAuthContext(ctx);
    const row = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", KEY))
      .first();
    const stored = (row?.value ?? {}) as Partial<AppPreferences>;
    return {
      documents: { ...DEFAULT_PREFERENCES.documents, ...(stored.documents ?? {}) },
      defaultPrintTemplate: stored.defaultPrintTemplate ?? DEFAULT_PREFERENCES.defaultPrintTemplate,
    };
  },
});

export const save = mutation({
  args: { preferences: preferencesValidator },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireOwner(auth);
    const row = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", KEY))
      .first();
    if (row) await ctx.db.patch(row._id, { value: args.preferences, updatedAt: Date.now() });
    else await ctx.db.insert("applicationSettings", { organizationId: auth.organizationId, key: KEY, value: args.preferences, updatedAt: Date.now() });
  },
});
