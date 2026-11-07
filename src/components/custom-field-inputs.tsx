"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldEntity } from "../../convex/customFields";

export function CustomFieldInputs({
  entity,
  values,
  onChange,
}: {
  entity: CustomFieldEntity;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const definitions = useQuery(api.customFields.getDefinitions);
  const fields = definitions?.filter((field) => field.entity === entity) ?? [];
  if (!fields.length) return null;
  return (
    <div className="grid gap-3 rounded-xl border border-dashed p-3 sm:grid-cols-2">
      <p className="col-span-full text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional fields</p>
      {fields.map((field) => (
        <div key={field.id} className="grid gap-2">
          <Label htmlFor={`custom-${entity}-${field.id}`}>{field.label}</Label>
          <Input
            id={`custom-${entity}-${field.id}`}
            value={values[field.id] ?? ""}
            maxLength={500}
            onChange={(event) => onChange({ ...values, [field.id]: event.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

export function CustomFieldSummary({
  fields,
  values,
}: {
  fields: { id: string; label: string; entity: CustomFieldEntity }[] | undefined;
  values: Record<string, string> | undefined;
}) {
  if (!fields || !values) return null;
  const entries = fields.filter((field) => field.id in values && values[field.id]);
  if (!entries.length) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-normal text-muted-foreground">
      {entries.map((field) => (
        <div key={field.id} className="flex gap-1">
          <dt>{field.label}:</dt><dd className="max-w-40 truncate">{values[field.id]}</dd>
        </div>
      ))}
    </dl>
  );
}
