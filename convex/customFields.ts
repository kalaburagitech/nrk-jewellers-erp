import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuthContext, requireOwner } from "./lib/auth";

export const ENTITY_TYPES = ["customer", "supplier", "product"] as const;
export type CustomFieldEntity = (typeof ENTITY_TYPES)[number];
export const FIELD_TYPES = ["text", "number", "date", "select"] as const;
export type CustomFieldType = (typeof FIELD_TYPES)[number];
export type CustomFieldDefinition = {
  id: string;
  entity: CustomFieldEntity;
  label: string;
  showInInvoice: boolean;
  /** Missing on fields created before types existed — treat as "text". */
  type?: CustomFieldType;
  /** Choices for a "select" (dropdown) field, in display order. */
  options?: string[];
  required?: boolean;
};

const definitionValidator = v.object({
  id: v.string(),
  entity: v.union(v.literal("customer"), v.literal("supplier"), v.literal("product")),
  label: v.string(),
  showInInvoice: v.boolean(),
  type: v.optional(v.union(v.literal("text"), v.literal("number"), v.literal("date"), v.literal("select"))),
  options: v.optional(v.array(v.string())),
  required: v.optional(v.boolean()),
});

/**
 * Owner-editable choice lists for free-text dropdowns elsewhere in the app.
 * Only lists stored as plain text belong here — enums the accounting logic
 * depends on (payment mode, unit) stay fixed in the schema.
 */
export const DROPDOWN_LISTS = {
  expenseCategories: {
    label: "Expense categories",
    defaults: ["Rent", "Salary", "Electricity", "Transport", "Maintenance", "Other"],
  },
} as const;
export type DropdownListKey = keyof typeof DROPDOWN_LISTS;
export type DropdownLists = Record<DropdownListKey, string[]>;

export async function loadDefinitions(ctx: QueryCtx, organizationId: Id<"organizations">) {
  const setting = await ctx.db
    .query("applicationSettings")
    .withIndex("by_org_and_key", (q) => q.eq("organizationId", organizationId).eq("key", "custom_fields"))
    .first();
  return Array.isArray(setting?.value) ? setting.value as CustomFieldDefinition[] : [];
}

export const getDefinitions = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    return await loadDefinitions(ctx, auth.organizationId);
  },
});

function cleanOptions(options: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of options) {
    const option = raw.trim();
    if (!option) continue;
    if (option.length > 60) throw new Error("Dropdown choices must be 60 characters or fewer");
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  if (result.length > 100) throw new Error("A dropdown can have up to 100 choices");
  return result;
}

export const saveDefinitions = mutation({
  args: { definitions: v.array(definitionValidator) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireOwner(auth);
    if (args.definitions.length > 50) throw new Error("You can define up to 50 custom fields");
    const ids = new Set<string>();
    const cleaned: CustomFieldDefinition[] = [];
    for (const definition of args.definitions) {
      const id = definition.id.trim();
      const label = definition.label.trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid custom field identifier");
      if (ids.has(id)) throw new Error("Custom field identifiers must be unique");
      ids.add(id);
      if (!label || label.length > 60) throw new Error("Field names must be 1–60 characters");
      if (definition.showInInvoice && definition.entity !== "customer") throw new Error("Only customer fields can appear on invoices");
      const type = definition.type ?? "text";
      const options = type === "select" ? cleanOptions(definition.options ?? []) : undefined;
      if (type === "select" && !options?.length) throw new Error(`Add at least one choice for the dropdown "${label}"`);
      cleaned.push({
        id,
        entity: definition.entity,
        label,
        showInInvoice: definition.showInInvoice,
        type,
        ...(options ? { options } : {}),
        required: definition.required === true,
      });
    }

    const existing = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", "custom_fields"))
      .first();
    if (existing) await ctx.db.patch(existing._id, { value: cleaned, updatedAt: Date.now() });
    else await ctx.db.insert("applicationSettings", {
      organizationId: auth.organizationId,
      key: "custom_fields",
      value: cleaned,
      updatedAt: Date.now(),
    });
  },
});

export const getDropdownLists = query({
  args: {},
  handler: async (ctx): Promise<DropdownLists> => {
    const auth = await requireAuthContext(ctx);
    const setting = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", "dropdown_lists"))
      .first();
    const stored = (setting?.value && typeof setting.value === "object" ? setting.value : {}) as Partial<Record<string, unknown>>;
    const result = {} as DropdownLists;
    for (const key of Object.keys(DROPDOWN_LISTS) as DropdownListKey[]) {
      const value = stored[key];
      result[key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [...DROPDOWN_LISTS[key].defaults];
    }
    return result;
  },
});

export const saveDropdownList = mutation({
  args: { key: v.literal("expenseCategories"), options: v.array(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireOwner(auth);
    const options = cleanOptions(args.options);
    const existing = await ctx.db
      .query("applicationSettings")
      .withIndex("by_org_and_key", (q) => q.eq("organizationId", auth.organizationId).eq("key", "dropdown_lists"))
      .first();
    const previous = (existing?.value && typeof existing.value === "object" ? existing.value : {}) as Record<string, unknown>;
    const value = { ...previous, [args.key]: options };
    if (existing) await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("applicationSettings", {
      organizationId: auth.organizationId,
      key: "dropdown_lists",
      value,
      updatedAt: Date.now(),
    });
  },
});
