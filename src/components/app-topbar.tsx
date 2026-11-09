"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Bell, KeyRound, LogOut, Search } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TextSizeToggle } from "@/components/text-size-toggle";
import { NAV_SECTIONS } from "@/lib/nav-data";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemePicker } from "@/components/color-theme-picker";
import { getUserErrorMessage } from "@/lib/user-error";
import { Button } from "@/components/ui/button";
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
    <div className="relative hidden w-full max-w-md md:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search customers, products, invoices…"
        className="h-11 rounded-xl border-border/70 bg-muted/40 pl-9 text-sm"
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

function NotificationBell() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none">
        <div className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <Bell className="h-4 w-4" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <p className="px-2 py-3 text-center text-sm text-muted-foreground">
          No new notifications.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppTopbar({
  organizationName,
  userName,
  role,
}: {
  organizationName?: string;
  userName?: string;
  role?: string;
}) {
  const { signOut } = useAuthActions();
  const changeOwnerPassword = useAction(api.memberships.changeOwnerPassword);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const pathname = usePathname();
  const page = NAV_SECTIONS.flatMap((section) => [
    ...(section.items ?? []),
    section,
  ]).find((item) => item.href === pathname);
  const pageTitle = page?.title ?? "Workspace";

  return (
    <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card/95 px-4 backdrop-blur-xl sm:gap-5 lg:px-8 print:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Expand or collapse navigation" title="Expand or collapse navigation" />
        <Separator orientation="vertical" className="h-5" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-tight">
            {pageTitle}
          </p>
          <p className="mt-0.5 hidden max-w-52 truncate text-xs text-muted-foreground sm:block">
            {organizationName || "NRK Jewellers"}
          </p>
        </div>
      </div>
      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-2">
        {role && (
          <Badge variant="outline" className="hidden xl:inline-flex capitalize">
            {role.replace("_", " ")}
          </Badge>
        )}
        <TextSizeToggle />
        <ThemeToggle />
        <ColorThemePicker />
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            <Avatar className="h-10 w-10 border border-border">
              <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">
                {initials(userName)}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5 text-sm">
              <p className="font-medium leading-none">
                {userName ?? "Account"}
              </p>
            </div>
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
              onSelect={() => void signOut()}
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
