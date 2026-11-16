"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { AppPreferences } from "../../convex/appPreferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccessInfo } from "@/components/access-context";
import { getUserErrorMessage } from "@/lib/user-error";

/** Vyapar's "Additional Item Fields", stored as built-in product custom fields so they appear on the item form and can be filled per item. */
const EXTRA_FIELDS = [
  { id: "item_mrp", label: "MRP", type: "number" as const },
  { id: "item_huid", label: "HUID (Hallmark ID)", type: "text" as const },
  { id: "item_serial", label: "Serial No. / IMEI", type: "text" as const },
  { id: "item_batch", label: "Batch No.", type: "text" as const },
  { id: "item_exp", label: "Exp. Date", type: "date" as const },
  { id: "item_mfg", label: "Mfg. Date", type: "date" as const },
  { id: "item_model", label: "Model No.", type: "text" as const },
  { id: "item_size", label: "Size", type: "text" as const },
];

function Row({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function ItemSettingsCard() {
  const prefs = useQuery(api.appPreferences.get);
  const definitions = useQuery(api.customFields.getDefinitions);
  if (!prefs || !definitions) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <Editor key={JSON.stringify([prefs, definitions])} prefs={prefs} definitions={definitions} />;
}

type Definition = NonNullable<ReturnType<typeof useQuery<typeof api.customFields.getDefinitions>>>[number];

function Editor({ prefs, definitions }: { prefs: AppPreferences; definitions: Definition[] }) {
  const savePrefs = useMutation(api.appPreferences.save);
  const saveDefinitions = useMutation(api.customFields.saveDefinitions);
  const { isOwner } = useAccessInfo();
  const [items, setItems] = useState(prefs.items);
  const [extras, setExtras] = useState(() => new Set(definitions.filter((d) => EXTRA_FIELDS.some((f) => f.id === d.id)).map((d) => d.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const extrasBefore = definitions.filter((d) => EXTRA_FIELDS.some((f) => f.id === d.id)).map((d) => d.id).sort().join();
  const dirty = JSON.stringify(items) !== JSON.stringify(prefs.items) || [...extras].sort().join() !== extrasBefore;

  async function persist() {
    setBusy(true);
    setMsg(null);
    try {
      await savePrefs({ preferences: { ...prefs, items } });
      const others = definitions.filter((d) => !EXTRA_FIELDS.some((f) => f.id === d.id));
      const chosen = EXTRA_FIELDS.filter((f) => extras.has(f.id)).map((f) => {
        const existing = definitions.find((d) => d.id === f.id);
        return existing ?? { id: f.id, entity: "product" as const, label: f.label, showInInvoice: false, type: f.type, required: false };
      });
      await saveDefinitions({ definitions: [...others, ...chosen].map((d) => ({ id: d.id, entity: d.entity, label: d.label, showInInvoice: d.showInInvoice, type: d.type, options: d.options, required: d.required })) });
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: getUserErrorMessage(e, "Could not save item settings.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Item Settings</CardTitle>
          <CardDescription>How items behave on bills and in stock.</CardDescription>
        </CardHeader>
        <CardContent>
          <Row title="Barcode Scan" description="Show the barcode / QR scan box on New Sale." control={<Switch aria-label="Barcode scan" disabled={!isOwner} checked={items.barcodeScan} onCheckedChange={(c) => setItems((x) => ({ ...x, barcodeScan: c }))} />} />
          <Row title="Show Low Stock Alert" description="Warn on Home when an item falls below its Min Stock To Maintain." control={<Switch aria-label="Low stock alert" disabled={!isOwner} checked={items.lowStockAlert} onCheckedChange={(c) => setItems((x) => ({ ...x, lowStockAlert: c }))} />} />
          <Row
            title="Default Unit"
            description="Unit pre-selected when you add a new item."
            control={
              <Select value={items.defaultUnit} disabled={!isOwner} onValueChange={(v) => setItems((x) => ({ ...x, defaultUnit: v as typeof x.defaultUnit }))}>
                <SelectTrigger className="h-9 w-32" aria-label="Default unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gram">Gram</SelectItem>
                  <SelectItem value="kilogram">Kilogram</SelectItem>
                  <SelectItem value="piece">Piece</SelectItem>
                  <SelectItem value="carat">Carat</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <Row title="Item Category" description="Group items by category for reports." control={<Button asChild variant="outline" size="sm"><Link href="/inventory/categories">Manage</Link></Button>} />
          <Row title="Item-wise Tax & Making" description="A tax rate and making charge set on an item fill in automatically when it's added to a sale." control={<span className="text-xs font-medium text-emerald-600">Always on</span>} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Additional Item Fields</CardTitle>
          <CardDescription>Turned-on fields appear on the Add Item form (Additional Fields tab).</CardDescription>
        </CardHeader>
        <CardContent>
          {EXTRA_FIELDS.map((f) => (
            <Row
              key={f.id}
              title={f.label}
              description={f.type === "date" ? "Date field" : f.type === "number" ? "Amount field" : "Text field"}
              control={<Switch aria-label={f.label} disabled={!isOwner} checked={extras.has(f.id)} onCheckedChange={(c) => setExtras((prev) => { const next = new Set(prev); if (c) next.add(f.id); else next.delete(f.id); return next; })} />}
            />
          ))}
          <p className="mt-3 text-xs text-muted-foreground">Need something else? <Link className="underline" href="/settings/custom-fields">Add your own item fields</Link>.</p>
        </CardContent>
      </Card>
      <div className="flex items-center justify-end gap-3 lg:col-span-2">
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</p>}
        {isOwner ? <Button disabled={busy || !dirty} onClick={persist}>{busy ? "Saving…" : "Save"}</Button> : <p className="text-xs text-muted-foreground">Only the Owner can change these settings.</p>}
      </div>
    </div>
  );
}
