"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Calculator,
  Database,
  ExternalLink,
  FileText,
  Lock,
  PackageSearch,
  Printer,
  Receipt,
  RotateCcw,
  Sliders,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAppLock } from "@/components/app-lock-gate";
import { useAccessInfo } from "@/components/access-context";
import { getUserErrorMessage } from "@/lib/user-error";
import { VIEW_SCALE_MAX, VIEW_SCALE_MIN, setViewScale, useViewScale } from "@/lib/view-scale";
import type { AppPreferences } from "../../convex/appPreferences";

export type SettingsTab = "general" | "transaction" | "print" | "gst" | "party" | "item" | "accounting";

const TABS: { id: SettingsTab; label: string; icon: typeof Sliders }[] = [
  { id: "general", label: "General", icon: Sliders },
  { id: "transaction", label: "Transaction", icon: Receipt },
  { id: "print", label: "Print", icon: Printer },
  { id: "gst", label: "Taxes & GST", icon: FileText },
  { id: "party", label: "Party", icon: Users },
  { id: "item", label: "Item", icon: PackageSearch },
  { id: "accounting", label: "Accounting", icon: Calculator },
];

const DOCUMENT_OPTIONS: { key: keyof AppPreferences["documents"]; label: string; description: string }[] = [
  { key: "quotations", label: "Estimate / Quotation", description: "Price quotes before a sale." },
  { key: "proforma", label: "Proforma Invoice", description: "Advance bill before the final invoice." },
  { key: "orders", label: "Sale / Purchase Order", description: "Customer orders and supplier orders." },
  { key: "challans", label: "Delivery Challan", description: "Goods sent without a tax invoice." },
];

const PRINT_OPTIONS: { value: AppPreferences["defaultPrintTemplate"]; label: string; description: string }[] = [
  { value: "half-a4", label: "A5 Landscape (NRK invoice)", description: "Half-A4 bill, 210 × 148 mm. Recommended." },
  { value: "full-a4", label: "A4 Landscape", description: "Full page, 297 × 210 mm." },
  { value: "thermal", label: "Thermal receipt (80 mm)", description: "Roll printer receipt." },
];

function SettingRow({ title, description, control }: { title: string; description?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function LinkCard({ title, description, links }: { title: string; description: string; links: { href: string; label: string }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {links.map((link) => (
          <Button key={link.href} asChild variant="outline" size="sm">
            <Link href={link.href}>{link.label}<ExternalLink className="h-3.5 w-3.5" /></Link>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

/** Owner-editable shop preferences, saved on the server for the current company. */
function PreferencesEditor({ initial, tab, canEdit }: { initial: AppPreferences; tab: "transaction" | "print"; canEdit: boolean }) {
  const save = useMutation(api.appPreferences.save);
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = JSON.stringify(prefs) !== JSON.stringify(initial);

  async function persist() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await save({ preferences: prefs });
      setMessage("Saved.");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save settings."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tab === "transaction" ? "More transactions" : "Default print size"}</CardTitle>
        <CardDescription>
          {tab === "transaction"
            ? "Turn optional documents on or off. Turned-off documents are hidden from the menu; existing records are kept."
            : "The invoice print screen opens with this paper size. You can still switch it per bill."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tab === "transaction" ? (
          DOCUMENT_OPTIONS.map((option) => (
            <SettingRow
              key={option.key}
              title={option.label}
              description={option.description}
              control={
                <Switch
                  aria-label={option.label}
                  checked={prefs.documents[option.key]}
                  disabled={!canEdit}
                  onCheckedChange={(checked) => {
                    setPrefs((previous) => ({ ...previous, documents: { ...previous.documents, [option.key]: checked } }));
                    setMessage("");
                  }}
                />
              }
            />
          ))
        ) : (
          <div role="radiogroup" aria-label="Default print size" className="grid gap-2">
            {PRINT_OPTIONS.map((option) => (
              <label key={option.value} className={`flex items-start gap-3 rounded-lg border p-3 ${canEdit ? "cursor-pointer" : ""} ${prefs.defaultPrintTemplate === option.value ? "border-primary bg-primary/5" : ""}`}>
                <input
                  type="radio"
                  name="default-print"
                  className="mt-1 accent-primary"
                  checked={prefs.defaultPrintTemplate === option.value}
                  disabled={!canEdit}
                  onChange={() => {
                    setPrefs((previous) => ({ ...previous, defaultPrintTemplate: option.value }));
                    setMessage("");
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
        {canEdit ? (
          <div className="mt-4 flex justify-end">
            <Button onClick={persist} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Only the Owner can change these settings.</p>
        )}
      </CardContent>
    </Card>
  );
}

function GeneralTab() {
  const appLock = useAppLock();
  const access = useQuery(api.organizations.getMyAccess);
  const scale = useViewScale();
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application & security</CardTitle>
          <CardDescription>The app asks for your passcode when it opens. Lock it now if you are leaving the counter.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            title="Lock workspace now"
            description="Hides the app until the passcode is entered again."
            control={<Button variant="outline" size="sm" onClick={appLock.lock}><Lock className="h-4 w-4" />Lock now</Button>}
          />
          <SettingRow title="Business currency" description="Amounts are stored and printed in rupees." control={<span className="text-sm font-medium">₹ INR</span>} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Companies</CardTitle>
          <CardDescription>Keep separate books for daily sales and GST firms.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            title={access?.organization?.name ?? "Current company"}
            description="Currently open company"
            control={<Button asChild variant="outline" size="sm"><Link href="/settings/companies">Manage companies<ExternalLink className="h-3.5 w-3.5" /></Link></Button>}
          />
          <SettingRow
            title="Backup & restore"
            description="Download a backup of this company's data or restore one."
            control={<Button asChild variant="outline" size="sm"><Link href="/backup"><Database className="h-4 w-4" />Open</Link></Button>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Screen zoom</CardTitle>
          <CardDescription>Make everything on this device’s screen bigger or smaller. Saved on this device only; printed bills are not affected.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{scale}%</span>
            <Button variant="ghost" size="sm" onClick={() => setViewScale(100)} disabled={scale === 100}><RotateCcw className="h-3.5 w-3.5" />Reset to 100%</Button>
          </div>
          <input
            type="range"
            aria-label="Screen zoom"
            min={VIEW_SCALE_MIN}
            max={VIEW_SCALE_MAX}
            step={5}
            value={scale}
            onChange={(event) => setViewScale(Number(event.target.value))}
            className="w-full cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{VIEW_SCALE_MIN}%</span><span>100%</span><span>{VIEW_SCALE_MAX}%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function GeneralSettings({ initialTab = "general" }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const preferences = useQuery(api.appPreferences.get);
  const { isOwner } = useAccessInfo();

  let content: ReactNode;
  if (tab === "general") content = <GeneralTab />;
  else if (tab === "transaction" || tab === "print") {
    content = preferences === undefined
      ? <p className="text-sm text-muted-foreground">Loading…</p>
      : <PreferencesEditor key={`${tab}-${JSON.stringify(preferences)}`} initial={preferences} tab={tab} canEdit={isOwner} />;
    if (tab === "print") content = <div className="flex flex-col gap-5">{content}<LinkCard title="Invoice details on the bill" description="Business name, address, logo and motto printed on the invoice header." links={[{ href: "/settings/business", label: "Business profile" }, { href: "/settings/custom-fields", label: "Customer fields on invoice" }]} /></div>;
  } else if (tab === "gst") content = <LinkCard title="Taxes & GST" description="GST registration, tax rates used on bills, and metal purity options." links={[{ href: "/settings/gst", label: "GST configuration" }, { href: "/settings/purity", label: "Metal purity" }]} />;
  else if (tab === "party") content = <LinkCard title="Parties" description="Customers and suppliers, plus your own extra fields and dropdowns for them." links={[{ href: "/customers", label: "Customers" }, { href: "/suppliers", label: "Suppliers" }, { href: "/settings/custom-fields", label: "Custom fields & dropdowns" }]} />;
  else if (tab === "item") content = <LinkCard title="Items" description="Item list, stock groups and categories, plus custom item fields." links={[{ href: "/inventory/products", label: "Item list" }, { href: "/inventory/groups", label: "Stock groups" }, { href: "/inventory/categories", label: "Stock categories" }, { href: "/settings/custom-fields", label: "Custom fields" }]} />;
  else content = <LinkCard title="Accounting" description="Financial (booking) years for this company, and staff access." links={[{ href: "/settings/accounting-years", label: "Booking years" }, { href: "/settings/users", label: "Users and roles" }]} />;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Security, transactions, printing and screen preferences.</p>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-xl border bg-card/60 p-2 md:flex-col">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors ${tab === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">{content}</div>
      </div>
    </div>
  );
}
