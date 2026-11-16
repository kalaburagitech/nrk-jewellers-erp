import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuthContext, requireOwner } from "./lib/auth";

/** Shop-wide preferences the Owner controls from Settings → General. */
export type AppPreferences = {
  /** Optional document types; turning one off hides it from the menu. */
  documents: { quotations: boolean; proforma: boolean; orders: boolean; challans: boolean };
  /** Paper the invoice print screen opens with. */
  defaultPrintTemplate: "half-a4" | "full-a4" | "thermal";
  /** Decimal places shown for amounts (Vyapar "Amount upto decimal places"). */
  amountDecimals: number;
  /** Show the shop/party GSTIN on printed invoices. */
  printGstin: boolean;
  /** GST item stock: refuse a sale that would take stock below zero. */
  stopSaleOnNegativeStock: boolean;
  /** Hide "new item" / "new party" shortcuts inside sale & purchase forms. */
  blockNewItemsFromTxn: boolean;
  blockNewPartiesFromTxn: boolean;
  /** Other Income module in the menu. */
  otherIncome: boolean;
  autoBackup: { enabled: boolean; everyDays: number };
  /** Settings → Item. */
  items: { barcodeScan: boolean; lowStockAlert: boolean; defaultUnit: "gram" | "kilogram" | "piece" | "carat" };
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  documents: { quotations: true, proforma: true, orders: true, challans: true },
  defaultPrintTemplate: "half-a4",
  amountDecimals: 2,
  printGstin: true,
  stopSaleOnNegativeStock: true,
  blockNewItemsFromTxn: false,
  blockNewPartiesFromTxn: false,
  otherIncome: true,
  autoBackup: { enabled: false, everyDays: 2 },
  items: { barcodeScan: true, lowStockAlert: true, defaultUnit: "piece" },
};

const KEY = "app_preferences";

const preferencesValidator = v.object({
  documents: v.object({ quotations: v.boolean(), proforma: v.boolean(), orders: v.boolean(), challans: v.boolean() }),
  defaultPrintTemplate: v.union(v.literal("half-a4"), v.literal("full-a4"), v.literal("thermal")),
  amountDecimals: v.number(),
  printGstin: v.boolean(),
  stopSaleOnNegativeStock: v.boolean(),
  blockNewItemsFromTxn: v.boolean(),
  blockNewPartiesFromTxn: v.boolean(),
  otherIncome: v.boolean(),
  autoBackup: v.object({ enabled: v.boolean(), everyDays: v.number() }),
  items: v.object({
    barcodeScan: v.boolean(),
    lowStockAlert: v.boolean(),
    defaultUnit: v.union(v.literal("gram"), v.literal("kilogram"), v.literal("piece"), v.literal("carat")),
  }),
});

/** Stored preferences merged over defaults — usable from any query/mutation. */
export async function readPreferences(ctx: QueryCtx, organizationId: Id<"organizations">): Promise<AppPreferences> {
  const row = await ctx.db
    .query("applicationSettings")
    .withIndex("by_org_and_key", (q) => q.eq("organizationId", organizationId).eq("key", KEY))
    .first();
  const stored = (row?.value ?? {}) as Partial<AppPreferences>;
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    documents: { ...DEFAULT_PREFERENCES.documents, ...(stored.documents ?? {}) },
    autoBackup: { ...DEFAULT_PREFERENCES.autoBackup, ...(stored.autoBackup ?? {}) },
    items: { ...DEFAULT_PREFERENCES.items, ...(stored.items ?? {}) },
  };
}

export const get = query({
  args: {},
  handler: async (ctx): Promise<AppPreferences> => {
    const auth = await requireAuthContext(ctx);
    return await readPreferences(ctx, auth.organizationId);
  },
});

export const save = mutation({
  args: { preferences: preferencesValidator },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireOwner(auth);
    const p = args.preferences;
    if (!Number.isInteger(p.amountDecimals) || p.amountDecimals < 0 || p.amountDecimals > 3) throw new Error("Decimal places must be 0 to 3");
    if (!Number.isInteger(p.autoBackup.everyDays) || p.autoBackup.everyDays < 1 || p.autoBackup.everyDays > 30) throw new Error("Auto backup must run every 1 to 30 days");
    const row = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", KEY))
      .first();
    if (row) await ctx.db.patch(row._id, { value: args.preferences, updatedAt: Date.now() });
    else await ctx.db.insert("applicationSettings", { organizationId: auth.organizationId, key: KEY, value: args.preferences, updatedAt: Date.now() });
  },
});
