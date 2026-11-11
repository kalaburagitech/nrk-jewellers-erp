"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Building2, Check, Cloud, MoreVertical, Plus, Search, ShieldCheck } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { getUserErrorMessage } from "@/lib/user-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const TYPES = [
  { value: "daily_sales", label: "Daily sales company" },
  { value: "gst_gold", label: "GST company · Gold" },
  { value: "gst_silver", label: "GST company · Silver" },
] as const;
type TypeFilter = "all" | (typeof TYPES)[number]["value"];
type CompanyScope = "all" | "mine" | "shared";

function companyTypeName(companyType?: string) {
  return TYPES.find((type) => type.value === companyType)?.label ?? "Existing company";
}

export default function CompaniesPage() {
  const access = useQuery(api.organizations.getMyAccess);
  const createCompany = useMutation(api.organizations.createCompany);
  const selectCompany = useMutation(api.organizations.selectCompany);
  const [name, setName] = useState("");
  const [companyType, setCompanyType] = useState<(typeof TYPES)[number]["value"]>("daily_sales");
  const [scope, setScope] = useState<CompanyScope>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const companies = access?.companies ?? [];
  const currentId = access?.organization?._id;
  const isOwner = access?.membership?.role === "owner";
  const filteredCompanies = useMemo(() => {
    const term = search.trim().toLowerCase();
    return companies.filter((company) => {
      const owned = company.role === "owner";
      const matchesScope = scope === "all" || (scope === "mine" ? owned : !owned);
      const matchesType = typeFilter === "all" || company.companyType === typeFilter;
      const matchesSearch = !term || company.name.toLowerCase().includes(term) || companyTypeName(company.companyType).toLowerCase().includes(term);
      return matchesScope && matchesType && matchesSearch;
    });
  }, [companies, scope, typeFilter, search]);

  async function addCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createCompany({ name: name.trim(), companyType });
      setName("");
      setCreating(false);
      setMessage("Company created. Its records are separate, and this workspace is now selected.");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not create this company."));
    } finally {
      setBusy(false);
    }
  }

  async function openCompany(company: (typeof companies)[number]) {
    if (company.organizationId === currentId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await selectCompany({ organizationId: company.organizationId });
      setMessage(`Switched to ${company.name}.`);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not open this company."));
    } finally {
      setBusy(false);
    }
  }

  if (access === undefined || access === null || access.membership === null) {
    return <p className="text-sm text-muted-foreground">Loading companies…</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Building2 className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">Workspace setup</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Manage companies</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Keep daily sales and GST billing in separate workspaces. Each company has its own parties, items, stock, rates and bills.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/backup"><Cloud className="h-4 w-4" />Backup</Link>
          </Button>
          {isOwner && <Button size="sm" onClick={() => { setCreating((value) => !value); setError(""); }}>
            <Plus className="h-4 w-4" />{creating ? "Close form" : "Add new company"}
          </Button>}
        </div>
      </div>

      {creating && isOwner && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3"><CardTitle className="text-base">Create a separate company</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addCompany} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto] sm:items-end">
              <div className="grid gap-2"><Label htmlFor="company-name">Company name</Label><Input id="company-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. NRK Daily Sales" required /></div>
              <div className="grid gap-2"><Label htmlFor="company-type">Company purpose</Label><Select value={companyType} onValueChange={(value) => setCompanyType(value as typeof companyType)}><SelectTrigger id="company-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div>
              <Button type="submit" disabled={busy || !name.trim()}><Plus className="h-4 w-4" />{busy ? "Creating…" : "Create company"}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Company ownership filter">
          {(["all", "mine", "shared"] as const).map((value) => {
            const label = value === "all" ? `All (${companies.length})` : value === "mine" ? `My companies (${companies.filter((company) => company.role === "owner").length})` : `Shared companies (${companies.filter((company) => company.role !== "owner").length})`;
            return <Button key={value} type="button" size="sm" variant={scope === value ? "secondary" : "ghost"} aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</Button>;
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(200px,1fr)_180px]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search companies" className="pl-9" placeholder="Search companies" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}><SelectTrigger aria-label="Filter by company type" className="w-full"><SelectValue placeholder="All company types" /></SelectTrigger><SelectContent><SelectItem value="all">All company types</SelectItem>{TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select>
        </div>
      </div>

      <section aria-label="Company workspaces" className="grid gap-3">
        {filteredCompanies.map((company) => {
          const current = company.organizationId === currentId;
          const initials = company.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
          return (
            <Card key={company.organizationId} className={current ? "border-primary/60 bg-accent/20 shadow-sm" : "transition-colors hover:border-primary/30"}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold ${current ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{initials || <Building2 className="h-5 w-5" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold">{company.name}</h2>
                      {current && <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />Current</Badge>}
                      {!current && <Badge variant="outline">Available</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-semibold uppercase tracking-wide">{company.role === "owner" ? "My company" : "Shared company"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{companyTypeName(company.companyType)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{company.createdAt ? `Created ${new Date(company.createdAt).toLocaleDateString("en-IN")}` : company.role.replaceAll("_", " ")}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-3 sm:border-0 sm:pt-0">
                  <Button variant={current ? "secondary" : "outline"} size="sm" disabled={busy || current} onClick={() => void openCompany(company)}>{current ? "Open" : "Open company"}</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`More options for ${company.name}`} title="More company options"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={busy || current} onSelect={() => void openCompany(company)}>{current ? "Current workspace" : "Open workspace"}</DropdownMenuItem>
                      <DropdownMenuItem asChild><Link href="/backup">Backup and restore</Link></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filteredCompanies.length === 0 && (
          <Card><CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No companies match these filters</p>
            <p className="text-sm text-muted-foreground">Change the search or filters and try again.</p>
          </CardContent></Card>
        )}
      </section>

      {!isOwner && <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" />Only the owner can create another company workspace.</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-primary/20 bg-accent/30 p-3 text-sm">{message}</p>}
    </div>
  );
}
