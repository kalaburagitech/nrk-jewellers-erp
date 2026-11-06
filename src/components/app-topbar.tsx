"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Bell, LogOut, Search } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
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
  const [focused, setFocused] = useState(false);
  const results = useQuery(api.search.globalSearch, term.trim().length >= 2 ? { term } : "skip");

  const hasResults =
    results && (results.customers.length > 0 || results.products.length > 0 || results.sales.length > 0);

  function go(path: string) {
    setTerm("");
    setFocused(false);
    router.push(path);
  }

  return (
    <div className="relative hidden w-72 sm:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search customers, products, invoices…"
        className="h-8 pl-8 text-sm"
      />
      {focused && term.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {!results ? (
            <p className="p-3 text-xs text-muted-foreground">Searching…</p>
          ) : !hasResults ? (
            <p className="p-3 text-xs text-muted-foreground">No matches.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1 text-sm">
              {results.customers.length > 0 && (
                <div>
                  <p className="px-3 pt-1.5 text-[10px] font-medium uppercase text-muted-foreground">Customers</p>
                  {results.customers.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => go("/customers")}
                    >
                      <span>{c.label}</span>
                      {c.sublabel && <span className="text-xs text-muted-foreground">{c.sublabel}</span>}
                    </button>
                  ))}
                </div>
              )}
              {results.products.length > 0 && (
                <div>
                  <p className="px-3 pt-1.5 text-[10px] font-medium uppercase text-muted-foreground">Products</p>
                  {results.products.map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => go("/inventory/products")}
                    >
                      <span>{p.label}</span>
                      {p.sublabel && <span className="text-xs text-muted-foreground">{p.sublabel}</span>}
                    </button>
                  ))}
                </div>
              )}
              {results.sales.length > 0 && (
                <div>
                  <p className="px-3 pt-1.5 text-[10px] font-medium uppercase text-muted-foreground">Invoices</p>
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
        <div className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <Bell className="h-4 w-4" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <p className="px-2 py-3 text-center text-sm text-muted-foreground">No new notifications.</p>
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

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-card/60 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/40 print:hidden">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-medium text-foreground/90">{organizationName}</span>
      </div>
      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-2">
        {role && (
          <Badge variant="outline" className="hidden sm:inline-flex capitalize">
            {role.replace("_", " ")}
          </Badge>
        )}
        <ThemeToggle />
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            <Avatar className="h-8 w-8 border border-border">
              <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">
                {initials(userName)}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5 text-sm">
              <p className="font-medium leading-none">{userName ?? "Account"}</p>
            </div>
            <DropdownMenuItem onSelect={() => void signOut()} className="text-destructive">
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
