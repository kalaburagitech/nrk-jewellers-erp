"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldDefinition, CustomFieldEntity } from "../../../../../convex/customFields";

const ENTITY_LABEL: Record<CustomFieldEntity, string> = {
  customer: "Parties / customers",
  supplier: "Suppliers",
  product: "Items / products",
};

function DefinitionEditor({ initial }: { initial: CustomFieldDefinition[] }) {
  const save = useMutation(api.customFields.saveDefinitions);
  const [definitions, setDefinitions] = useState(initial);
  const [entity, setEntity] = useState<CustomFieldEntity>("customer");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function addField() {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    setDefinitions((previous) => [...previous, {
      id: crypto.randomUUID().replaceAll("-", ""),
      entity,
      label: cleanLabel,
      showInInvoice: false,
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a field</CardTitle>
          <CardDescription>These fields are saved with each party or item. Customer fields can also print on invoices.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-2">
            <Label>Field name</Label>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Loyalty number" maxLength={60} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} />
          </div>
          <div className="grid gap-2 sm:w-64">
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

      {Object.entries(ENTITY_LABEL).map(([key, title]) => {
        const section = definitions.filter((field) => field.entity === key);
        return (
          <Card key={key}>
            <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {section.length === 0 ? <p className="text-sm text-muted-foreground">No additional fields.</p> : section.map((field) => (
                <div key={field.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <Input aria-label={`${title} field name`} value={field.label} maxLength={60} onChange={(event) => setDefinitions((previous) => previous.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} />
                  {field.entity === "customer" ? (
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox checked={field.showInInvoice} onCheckedChange={(checked) => setDefinitions((previous) => previous.map((item) => item.id === field.id ? { ...item, showInInvoice: checked === true } : item))} />
                      Show on invoice
                    </label>
                  ) : <span />}
                  <Button variant="ghost" size="icon" aria-label={`Remove ${field.label}`} onClick={() => setDefinitions((previous) => previous.filter((item) => item.id !== field.id))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-success">{message}</p>}
      <Button onClick={saveChanges} disabled={busy} className="self-end"><Save className="h-4 w-4" />{busy ? "Saving…" : "Save custom fields"}</Button>
    </div>
  );
}

export default function CustomFieldsSettingsPage() {
  const definitions = useQuery(api.customFields.getDefinitions);
  if (definitions === undefined) return <p className="text-sm text-muted-foreground">Loading custom fields…</p>;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Custom Fields</h1>
        <p className="mt-1 text-sm text-muted-foreground">Add your own fields to party and item forms, and choose which customer details print on invoices.</p>
      </div>
      <DefinitionEditor key={JSON.stringify(definitions)} initial={definitions} />
    </div>
  );
}
