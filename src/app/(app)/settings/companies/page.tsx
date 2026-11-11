"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, Plus, ShieldCheck } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { getUserErrorMessage } from "@/lib/user-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TYPES = [
  { value: "daily_sales", label: "Daily sales company" },
  { value: "gst_gold", label: "GST company · Gold" },
  { value: "gst_silver", label: "GST company · Silver" },
] as const;

export default function CompaniesPage() {
  const access = useQuery(api.organizations.getMyAccess);
  const createCompany = useMutation(api.organizations.createCompany);
  const selectCompany = useMutation(api.organizations.selectCompany);
  const [name, setName] = useState("");
  const [companyType, setCompanyType] = useState<(typeof TYPES)[number]["value"]>("daily_sales");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function addCompany() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createCompany({ name, companyType });
      setName("");
      setMessage("Company created. You are now working in its separate workspace.");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not create this company."));
    } finally {
      setBusy(false);
    }
  }

  if (access === undefined || access === null || access.membership === null) return <p className="text-sm text-muted-foreground">Loading companies…</p>;
  const isOwner = access?.membership?.role === "owner";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each company has its own customers, items, stock, bills, rates and reports. Data is not copied between companies.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" />Your company workspaces</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {access.companies?.map((company) => (
            <div key={company.organizationId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div><p className="font-medium">{company.name}</p><p className="text-xs capitalize text-muted-foreground">{company.companyType?.replaceAll("_", " ") ?? "Existing company"} · {company.role.replaceAll("_", " ")}</p></div>
              <Button variant={company.organizationId === access.organization?._id ? "secondary" : "outline"} disabled={busy || company.organizationId === access.organization?._id} onClick={async () => {
                setBusy(true); setError("");
                try { await selectCompany({ organizationId: company.organizationId }); setMessage(`Switched to ${company.name}.`); }
                catch (e) { setError(getUserErrorMessage(e, "Could not switch companies.")); }
                finally { setBusy(false); }
              }}>{company.organizationId === access.organization?._id ? "Current company" : "Open company"}</Button>
            </div>
          ))}
        </CardContent>
      </Card>
      {isOwner && <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" />Create a separate company</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-2"><Label htmlFor="company-name">Company name</Label><Input id="company-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. NRK Daily Sales" /></div>
          <div className="grid gap-2"><Label>Company purpose</Label><Select value={companyType} onValueChange={(value) => setCompanyType(value as typeof companyType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={() => void addCompany()} disabled={busy || !name.trim()}><Plus className="h-4 w-4" />{busy ? "Creating…" : "Create"}</Button>
        </CardContent>
      </Card>}
      {!isOwner && <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" />Only the owner can create company workspaces.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-success">{message}</p>}
    </div>
  );
}
