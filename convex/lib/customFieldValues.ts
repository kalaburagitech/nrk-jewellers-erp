import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { loadDefinitions, type CustomFieldEntity } from "../customFields";

export async function normalizeCustomFieldValues(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  entity: CustomFieldEntity,
  values: Record<string, string> | undefined,
) {
  // Callers that don't send custom fields at all (e.g. CSV import) leave them untouched.
  if (values === undefined) return undefined;
  const definitions = (await loadDefinitions(ctx, organizationId)).filter((field) => field.entity === entity);
  const byId = new Map(definitions.map((field) => [field.id, field]));
  const result: Record<string, string> = {};
  for (const [id, rawValue] of Object.entries(values)) {
    const field = byId.get(id);
    if (!field) throw new Error("A custom field is no longer available. Refresh and try again.");
    const value = rawValue.trim();
    if (!value) continue;
    if (value.length > 500) throw new Error("Custom field values must be 500 characters or fewer");
    const type = field.type ?? "text";
    if (type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`"${field.label}" must be a number`);
    if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`"${field.label}" must be a valid date`);
    if (type === "select" && !(field.options ?? []).includes(value)) throw new Error(`Choose one of the listed options for "${field.label}"`);
    result[id] = value;
  }
  for (const field of definitions) {
    if (field.required && !result[field.id]) throw new Error(`"${field.label}" is required`);
  }
  return result;
}
