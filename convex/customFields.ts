import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

export const ENTITY_TYPES = ["customer", "supplier", "product"] as const;
export type CustomFieldEntity = (typeof ENTITY_TYPES)[number];
export type CustomFieldDefinition = {
  id: string;
  entity: CustomFieldEntity;
  label: string;
  showInInvoice: boolean;
};

const definitionValidator = v.object({
  id: v.string(),
  entity: v.union(v.literal("customer"), v.literal("supplier"), v.literal("product")),
  label: v.string(),
  showInInvoice: v.boolean(),
});

export const getDefinitions = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const setting = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", "custom_fields"))
      .first();
    return Array.isArray(setting?.value) ? setting.value as CustomFieldDefinition[] : [];
  },
});

export const saveDefinitions = mutation({
  args: { definitions: v.array(definitionValidator) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, []);
    if (args.definitions.length > 30) throw new Error("You can define up to 30 custom fields");
    const ids = new Set<string>();
    for (const definition of args.definitions) {
      const id = definition.id.trim();
      const label = definition.label.trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid custom field identifier");
      if (ids.has(id)) throw new Error("Custom field identifiers must be unique");
      ids.add(id);
      if (!label || label.length > 60) throw new Error("Field names must be 1–60 characters");
      if (definition.showInInvoice && definition.entity !== "customer") throw new Error("Only customer fields can appear on invoices");
    }

    const existing = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", "custom_fields"))
      .first();
    if (existing) await ctx.db.patch(existing._id, { value: args.definitions, updatedAt: Date.now() });
    else await ctx.db.insert("applicationSettings", {
      organizationId: auth.organizationId,
      key: "custom_fields",
      value: args.definitions,
      updatedAt: Date.now(),
    });
  },
});

