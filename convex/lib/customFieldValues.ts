import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { CustomFieldDefinition, CustomFieldEntity } from "../customFields";

export async function normalizeCustomFieldValues(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  entity: CustomFieldEntity,
  values: Record<string, string> | undefined,
) {
  if (values === undefined) return undefined;
  const setting = await ctx.db
    .query("applicationSettings")
    .withIndex("by_org_and_key", (q) => q.eq("organizationId", organizationId).eq("key", "custom_fields"))
    .first();
  const definitions = Array.isArray(setting?.value) ? setting.value as CustomFieldDefinition[] : [];
  const allowed = new Set(definitions.filter((field) => field.entity === entity).map((field) => field.id));
  const result: Record<string, string> = {};
  for (const [id, rawValue] of Object.entries(values)) {
    if (!allowed.has(id)) throw new Error("A custom field is no longer available. Refresh and try again.");
    const value = rawValue.trim();
    if (value.length > 500) throw new Error("Custom field values must be 500 characters or fewer");
    if (value) result[id] = value;
  }
  return result;
}
