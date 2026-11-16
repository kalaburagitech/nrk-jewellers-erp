"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { ArrowLeft, Building2, EllipsisVertical, KeyRound, LockKeyhole, LogOut, Plus, Printer, Search, Settings } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { TextSizeToggle } from "@/components/text-size-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemePicker } from "@/components/color-theme-picker";
import { getUserErrorMessage } from "@/lib/user-error";
import { Button } from "@/components/ui/button";
import { useAppLock } from "@/components/app-lock-gate";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function GlobalSearch() {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(id);
  }, [term]);

  const results = useQuery(
    api.search.globalSearch,
    debouncedTerm.trim().length >= 2 ? { term: debouncedTerm } : "skip",
  );

  const hasResults =
    results &&
    (results.customers.length > 0 ||
      results.products.length > 0 ||
      results.sales.length > 0);

  function go(path: string) {
    setTerm("");
    setFocused(false);
    router.push(path);
  }

  return (
    <div className="relative hidden w-full max-w-sm md:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search Transactions"
        className="h-9 rounded-md border-transparent bg-transparent pl-9 text-[15px] shadow-none focus-visible:border-border focus-visible:bg-muted/40"
      />
      {focused && term.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {!results ? (
            <p className="p-3 text-xs text-muted-foreground">Searching…</p>
          ) : !hasResults ? (
            <p className="p-3 text-xs text-muted-foreground">No matches.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1 text-sm">
              {results.customers.length > 0 && (
                <div>
                  <p className="px-3 pt-1.5 text-xs font-medium uppercase text-muted-foreground">
                    Customers
                  </p>
                  {results.customers.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => go("/customers")}
                    >
                      <span>{c.label}</span>
                      {c.sublabel && (
                        <span className="text-xs text-muted-foreground">
                          {c.sublabel}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {results.products.length > 0 && (
                <div>
                  <p className="px-3 pt-1.5 text-xs font-medium uppercase text-muted-foreground">
                    Products
                  </p>
                  {results.products.map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => go("/inventory/products")}
                    >
                      <span>{p.label}</span>
                      {p.sublabel && (
                        <span className="text-xs text-muted-foreground">
                          {p.sublabel}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {results.sales.length > 0 && (
                <div>
                  <p className="px-3 pt-1.5 text-xs font-medium uppercase text-muted-foreground">
                    Invoices
                  </p>
                  {results.sales.map((s) => (
                    <button
                      key={s.id}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => go("/sales/invoices")}
                    >
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AppTopbar({
  organizationName,
  userName,
  role,
  companies = [],
  activeOrganizationId,
}: {
  organizationName?: string;
  userName?: string;
  role?: string;
  companies?: { organizationId: string; name: string; role: string; companyType?: string }[];
  activeOrganizationId?: string;
}) {
  const { signOut } = useAuthActions();
  const appLock = useAppLock();
  const changeOwnerPassword = useAction(api.memberships.changeOwnerPassword);
  const selectCompany = useMutation(api.organizations.selectCompany);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const { isLocked } = usePrivacyLock();

  const visibleCompanies = useMemo(() => {
    if (!isLocked) return companies;
    return companies.filter((c) => c.organizationId === activeOrganizationId);
  }, [companies, isLocked, activeOrganizationId]);
  const pathname = usePathname();
  const router = useRouter();
  const canWrite = role !== "staff";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card px-2.5 sm:px-4 print:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
        <SidebarTrigger aria-label="Expand or collapse navigation" title="Expand or collapse navigation" />
        {pathname !== "/" && <Button variant="ghost" size="icon" aria-label="Go back" title="Go back" className="h-8 w-8" onClick={() => window.history.length > 1 ? router.back() : router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>}
        <GlobalSearch />
        <p className="truncate text-sm font-semibold md:hidden">{organizationName || "NRK Jewellers"}</p>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {canWrite && (
          <>
            <Link href="/sales/new" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-sale-soft px-3 text-sm font-semibold text-sale transition-colors hover:bg-sale hover:text-white sm:px-4 sm:text-[15px]">
              <Plus className="h-4 w-4" /><span>Add Sale</span>
            </Link>
            <Link href="/purchases/new" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-purchase-soft px-3 text-sm font-semibold text-purchase transition-colors hover:bg-purchase hover:text-white sm:px-4 sm:text-[15px]">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">Add Purchase</span><span className="sm:hidden">Purchase</span>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Quick add" title="Quick add" className="hidden h-9 w-9 items-center justify-center rounded-full bg-purchase-soft text-purchase hover:bg-purchase hover:text-white sm:inline-flex">
                  <Plus className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {[
                  ["Sale Invoice", "/sales/new"],
                  ["Purchase Bill", "/purchases/new"],
                  ["Estimate/ Quotation", "/sales/quotations?new=1"],
                  ["Sale Return", "/sales/returns?new=1"],
                  ["Purchase Return", "/purchases/returns?new=1"],
                  ["Expense", "/purchases/expenses?new=1"],
                  ["Item", "/inventory/products?new=1"],
                  ["Cash & Bank entry", "/cash-bank"],
                ].map(([label, href]) => (
                  <DropdownMenuItem key={href} onSelect={() => router.push(href)}>
                    <Plus className="h-4 w-4" />{label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <Separator orientation="vertical" className="mx-0.5 hidden h-6 sm:block" />
        {visibleCompanies.length > 1 && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="hidden h-9 max-w-44 px-2 text-xs lg:inline-flex">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{organizationName ?? "Company"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Switch company</p>
            {visibleCompanies.map((company) => <DropdownMenuItem key={company.organizationId} disabled={company.organizationId === activeOrganizationId} onSelect={() => void selectCompany({ organizationId: company.organizationId as never })} className="items-start py-2">
              <Building2 className="mt-0.5 h-4 w-4" /><span className="min-w-0 flex-1"><span className="block truncate">{company.name}</span><span className="block text-xs capitalize text-muted-foreground">{company.companyType?.replaceAll("_", " ") ?? company.role.replaceAll("_", " ")}</span></span>{company.organizationId === activeOrganizationId && <span className="text-xs text-muted-foreground">Current</span>}
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>}
        <div className="hidden items-center gap-1 xl:flex">
          <TextSizeToggle />
          <ColorThemePicker />
          <ThemeToggle />
        </div>
        <Button variant="ghost" size="icon" aria-label="Print this screen" title="Print" className="hidden h-9 w-9 sm:inline-flex" onClick={() => window.print()}>
          <Printer className="h-[18px] w-[18px]" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More options" title="More" className="h-9 w-9">
              <EllipsisVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">{initials(userName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium leading-none">{userName ?? "Account"}</p>
                {role && <p className="mt-1 text-xs capitalize text-muted-foreground">{role.replace("_", " ")}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 px-1 pb-1 xl:hidden">
              <TextSizeToggle />
              <ColorThemePicker />
              <ThemeToggle />
            </div>
            <DropdownMenuItem onSelect={() => router.push("/settings")}>
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={appLock.lock}>
              <LockKeyhole className="h-4 w-4" />
              Lock app
            </DropdownMenuItem>
            {role === "owner" && (
              <DropdownMenuItem onSelect={() => {
                setNewPassword("");
                setConfirmPassword("");
                setPasswordError(null);
                setPasswordSaved(false);
                setPasswordDialogOpen(true);
              }}>
                <KeyRound className="h-4 w-4" />
                Change password
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                appLock.clear();
                void signOut();
              }}
              className="text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change owner password</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">Choose a new password with at least 8 characters.</p>
            <div className="grid gap-2">
              <Label htmlFor="owner-new-password">New password</Label>
              <Input id="owner-new-password" type="password" autoComplete="new-password" minLength={8}
                value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="owner-confirm-password">Confirm new password</Label>
              <Input id="owner-confirm-password" type="password" autoComplete="new-password" minLength={8}
                value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            {passwordError && <p role="alert" className="text-sm text-destructive">{passwordError}</p>}
            {passwordSaved && <p role="status" className="text-sm text-success">Password updated. Use your new password next time you sign in.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>Close</Button>
            <Button disabled={savingPassword || passwordSaved} onClick={async () => {
              setPasswordError(null);
              if (newPassword.length < 8) { setPasswordError("Use at least 8 characters."); return; }
              if (newPassword !== confirmPassword) { setPasswordError("The passwords do not match."); return; }
              setSavingPassword(true);
              try {
                await changeOwnerPassword({ newPassword });
                setPasswordSaved(true);
                setNewPassword("");
                setConfirmPassword("");
              } catch (error) {
                setPasswordError(getUserErrorMessage(error, "Could not update the password. Please try again."));
              } finally {
                setSavingPassword(false);
              }
            }}>{savingPassword ? "Updating…" : passwordSaved ? "Updated" : "Update password"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
