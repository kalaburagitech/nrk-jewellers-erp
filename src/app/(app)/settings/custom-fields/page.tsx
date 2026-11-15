"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Lock, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccessInfo } from "@/components/access-context";
import type { CustomFieldDefinition, CustomFieldEntity, CustomFieldType, DropdownListKey } from "../../../../../convex/customFields";

const ENTITY_LABEL: Record<CustomFieldEntity, string> = {
  customer: "Parties / customers",
  supplier: "Suppliers",
  product: "Items / products",
};

const TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Dropdown (choose from list)",
};

const LIST_LABEL: Record<DropdownListKey, { title: string; description: string }> = {
  expenseCategories: {
    title: "Expense categories",
    description: "Shown as suggestions when recording an expense.",
  },
};

/** Add/remove chips for a list of dropdown choices. */
function OptionsEditor({ options, onChange, disabled }: { options: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  function add() {
    const parts = draft.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const existing = new Set(options.map((option) => option.toLowerCase()));
    onChange([...options, ...parts.filter((part) => !existing.has(part.toLowerCase()))]);
    setDraft("");
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 && <span className="text-xs text-muted-foreground">No choices yet.</span>}
        {options.map((option) => (
          <Badge key={option} variant="secondary" className="gap-1 pr-1">
            {option}
            {!disabled && (
              <button type="button" aria-label={`Remove ${option}`} className="rounded p-0.5 hover:bg-muted-foreground/20" onClick={() => onChange(options.filter((item) => item !== option))}>
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Input value={draft} maxLength={200} placeholder="Type a choice and press Enter (comma for several)" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}><Plus className="h-4 w-4" />Add</Button>
        </div>
      )}
    </div>
  );
}

function DefinitionEditor({ initial, canEdit }: { initial: CustomFieldDefinition[]; canEdit: boolean }) {
  const save = useMutation(api.customFields.saveDefinitions);
  const [definitions, setDefinitions] = useState(initial);
  const [entity, setEntity] = useState<CustomFieldEntity>("customer");
  const [type, setType] = useState<CustomFieldType>("text");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function update(id: string, patch: Partial<CustomFieldDefinition>) {
    setDefinitions((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
    setMessage("");
  }

  function addField() {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    setDefinitions((previous) => [...previous, {
      id: crypto.randomUUID().replaceAll("-", ""),
      entity,
      label: cleanLabel,
      showInInvoice: false,
      type,
      options: type === "select" ? [] : undefined,
      required: false,
    }]);
    setLabel("");
    setMessage("");
  }

  async function saveChanges() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await save({ definitions });
      setMessage("Custom fields saved. They now appear in the matching add and edit forms.");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save custom fields."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a field</CardTitle>
            <CardDescription>Add your own boxes to party and item forms. Choose “Dropdown” to give staff a fixed list to pick from.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem_auto] sm:items-end">
            <div className="grid gap-2">
              <Label>Field name</Label>
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Loyalty number" maxLength={60} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(value) => setType(value as CustomFieldType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Use on</Label>
              <Select value={entity} onValueChange={(value) => setEntity(value as CustomFieldEntity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ENTITY_LABEL).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={addField} disabled={!label.trim()}><Plus className="h-4 w-4" />Add field</Button>
          </CardContent>
        </Card>
      )}

      {Object.entries(ENTITY_LABEL).map(([key, title]) => {
        const section = definitions.filter((field) => field.entity === key);
        return (
          <Card key={key}>
            <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {section.length === 0 ? <p className="text-sm text-muted-foreground">No additional fields.</p> : section.map((field) => {
                const fieldType = field.type ?? "text";
                return (
                  <div key={field.id} className="flex flex-col gap-3 rounded-lg border p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto_auto_auto] sm:items-center">
                      <Input aria-label={`${title} field name`} value={field.label} maxLength={60} disabled={!canEdit} onChange={(event) => update(field.id, { label: event.target.value })} />
                      <Select value={fieldType} disabled={!canEdit} onValueChange={(value) => update(field.id, { type: value as CustomFieldType, options: value === "select" ? field.options ?? [] : undefined })}>
                        <SelectTrigger aria-label={`${field.label} type`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TYPE_LABEL).map(([typeKey, value]) => <SelectItem key={typeKey} value={typeKey}>{value}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox checked={field.required === true} disabled={!canEdit} onCheckedChange={(checked) => update(field.id, { required: checked === true })} />
                        Required
                      </label>
                      {field.entity === "customer" ? (
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox checked={field.showInInvoice} disabled={!canEdit} onCheckedChange={(checked) => update(field.id, { showInInvoice: checked === true })} />
                          Show on invoice
                        </label>
                      ) : <span />}
                      {canEdit ? (
                        <Button variant="ghost" size="icon" aria-label={`Remove ${field.label}`} onClick={() => setDefinitions((previous) => previous.filter((item) => item.id !== field.id))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      ) : <span />}
                    </div>
                    {fieldType === "select" && (
                      <div className="rounded-md bg-muted/40 p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dropdown choices</p>
                        <OptionsEditor options={field.options ?? []} disabled={!canEdit} onChange={(options) => update(field.id, { options })} />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-success">{message}</p>}
      {canEdit && <Button onClick={saveChanges} disabled={busy} className="self-end"><Save className="h-4 w-4" />{busy ? "Saving…" : "Save custom fields"}</Button>}
    </div>
  );
}

function DropdownListEditor({ listKey, initial, canEdit }: { listKey: DropdownListKey; initial: string[]; canEdit: boolean }) {
  const save = useMutation(api.customFields.saveDropdownList);
  const [options, setOptions] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const info = LIST_LABEL[listKey];

  async function saveChanges() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await save({ key: listKey, options });
      setMessage("Saved.");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save this list."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{info.title}</CardTitle>
        <CardDescription>{info.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <OptionsEditor options={options} disabled={!canEdit} onChange={(next) => { setOptions(next); setMessage(""); }} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm text-success">{message}</p>}
        {canEdit && <Button onClick={saveChanges} disabled={busy} variant="outline" className="self-end"><Save className="h-4 w-4" />{busy ? "Saving…" : "Save list"}</Button>}
      </CardContent>
    </Card>
  );
}

export default function CustomFieldsSettingsPage() {
  const definitions = useQuery(api.customFields.getDefinitions);
  const lists = useQuery(api.customFields.getDropdownLists);
  const { isOwner } = useAccessInfo();
  if (definitions === undefined || lists === undefined) return <p className="text-sm text-muted-foreground">Loading custom fields…</p>;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Custom Fields &amp; Dropdowns</h1>
        <p className="mt-1 text-sm text-muted-foreground">Add your own fields to party and item forms, set up dropdown choices, and choose which customer details print on invoices.</p>
      </div>
      {!isOwner && (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />Only the Owner can change these settings. You are seeing them read-only.
        </p>
      )}
      <DefinitionEditor key={JSON.stringify(definitions)} initial={definitions} canEdit={isOwner} />
      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight">Dropdown lists</h2>
        <p className="mt-1 text-sm text-muted-foreground">Edit the choices offered in the app’s built-in dropdowns.</p>
      </div>
      {(Object.keys(lists) as DropdownListKey[]).map((listKey) => (
        <DropdownListEditor key={`${listKey}-${JSON.stringify(lists[listKey])}`} listKey={listKey} initial={lists[listKey]} canEdit={isOwner} />
      ))}
    </div>
  );
}
