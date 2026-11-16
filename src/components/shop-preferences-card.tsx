"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { AppPreferences } from "../../convex/appPreferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAccessInfo } from "@/components/access-context";
import { getUserErrorMessage } from "@/lib/user-error";

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

/** Settings → General: Vyapar's application switches, saved per company (Owner only). */
export function ShopPreferencesCard() {
  const initial = useQuery(api.appPreferences.get);
  if (!initial) return null;
  return <Editor key={JSON.stringify(initial)} initial={initial} />;
}

function Editor({ initial }: { initial: AppPreferences }) {
  const save = useMutation(api.appPreferences.save);
  const { role } = useAccessInfo();
  const lastBackup = useQuery(api.autoBackup.list, role === "owner" || role === "admin" ? {} : "skip")?.[0];
  const canEdit = role === "owner";
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  const toggle = (key: "printGstin" | "stopSaleOnNegativeStock" | "blockNewItemsFromTxn" | "blockNewPartiesFromTxn" | "otherIncome", label: string) => (
    <Switch aria-label={label} checked={p[key]} disabled={!canEdit} onCheckedChange={(c) => { setP((x) => ({ ...x, [key]: c })); setMsg(null); }} />
  );

  async function persist() {
    setBusy(true);
    try {
      await save({ preferences: p });
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: getUserErrorMessage(e, "Could not save settings.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Application</CardTitle>
        <CardDescription>How billing behaves for this company.</CardDescription>
      </CardHeader>
      <CardContent>
        <Row
          title="Amount (upto decimal places)"
          description={`e.g. ${(0).toFixed(p.amountDecimals)} — how many decimals amounts show with.`}
          control={<Input type="number" min={0} max={3} className="h-9 w-20" aria-label="Decimal places" disabled={!canEdit} value={p.amountDecimals} onChange={(e) => setP((x) => ({ ...x, amountDecimals: Math.max(0, Math.min(3, Number(e.target.value) || 0)) }))} />}
        />
        <Row title="GSTIN Number" description="Print your GSTIN and the party's GSTIN on invoices." control={toggle("printGstin", "Print GSTIN")} />
        <Row title="Stop Sale on Negative Stock" description="GST item stock: refuse a sale when there isn't enough stock. Box pieces can never be sold twice either way." control={toggle("stopSaleOnNegativeStock", "Stop sale on negative stock")} />
        <Row title="Block New Items from Txn Form" description="Purchase bills can only use items already in the item list." control={toggle("blockNewItemsFromTxn", "Block new items")} />
        <Row title="Block New Parties from Txn Form" description="Sale and purchase bills can only use existing customers and suppliers." control={toggle("blockNewPartiesFromTxn", "Block new parties")} />
        <Row title="Other Income" description="Show Other Income (interest, rent, commission received) in the menu and Profit & Loss." control={toggle("otherIncome", "Other income")} />
        <Row
          title="Auto Backup"
          description={lastBackup ? `Last backup ${new Date(lastBackup.createdAt).toLocaleString("en-IN")}. Download from Backup & Restore.` : "Saves a backup copy on the server automatically. Download it any time from Backup & Restore."}
          control={
            <div className="flex items-center gap-2">
              {p.autoBackup.enabled && (
                <span className="flex items-center gap-1 text-xs">
                  every
                  <Input type="number" min={1} max={30} className="h-8 w-16" aria-label="Auto backup every days" disabled={!canEdit} value={p.autoBackup.everyDays} onChange={(e) => setP((x) => ({ ...x, autoBackup: { ...x.autoBackup, everyDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) } }))} />
                  days
                </span>
              )}
              <Switch aria-label="Auto backup" checked={p.autoBackup.enabled} disabled={!canEdit} onCheckedChange={(c) => setP((x) => ({ ...x, autoBackup: { ...x.autoBackup, enabled: c } }))} />
            </div>
          }
        />
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</p>}
        {canEdit ? (
          <div className="mt-3 flex items-center justify-between">
            <Link href="/backup" className="text-sm text-primary underline-offset-4 hover:underline">Backup & Restore</Link>
            <Button onClick={persist} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Only the Owner can change these settings.</p>
        )}
      </CardContent>
    </Card>
  );
}
