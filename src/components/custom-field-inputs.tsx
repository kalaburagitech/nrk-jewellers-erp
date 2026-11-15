"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldEntity } from "../../convex/customFields";

// Radix Select can't use "" as an item value, so a sentinel stands in for "no choice".
const NONE = "__none__";

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
      {fields.map((field) => {
        const id = `custom-${entity}-${field.id}`;
        const value = values[field.id] ?? "";
        const type = field.type ?? "text";
        const set = (next: string) => onChange({ ...values, [field.id]: next });
        const options = field.options ?? [];
        const staleValue = type === "select" && value && !options.includes(value);
        return (
          <div key={field.id} className="grid gap-2">
            <Label htmlFor={id}>
              {field.label}
              {field.required && <span className="text-destructive" aria-hidden> *</span>}
            </Label>
            {type === "select" ? (
              <>
                <Select value={value || NONE} onValueChange={(next) => set(next === NONE ? "" : next)}>
                  <SelectTrigger id={id} aria-required={field.required}><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {!field.required && <SelectItem value={NONE}>— None —</SelectItem>}
                    {staleValue && <SelectItem value={value}>{value} (no longer offered)</SelectItem>}
                    {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
                {staleValue && <p className="text-xs text-destructive">This choice was removed. Pick a current option to save.</p>}
              </>
            ) : (
              <Input
                id={id}
                type={type === "date" ? "date" : "text"}
                inputMode={type === "number" ? "decimal" : undefined}
                value={value}
                maxLength={500}
                required={field.required}
                onChange={(event) => set(event.target.value)}
              />
            )}
          </div>
        );
      })}
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
