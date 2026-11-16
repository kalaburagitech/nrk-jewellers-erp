"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Vyapar's settings tabs, mapped onto this app's settings screens.
const SETTINGS_TABS: { label: string; href: string }[] = [
  { label: "General", href: "/settings/general" },
  { label: "Transaction", href: "/settings/general?tab=transaction" },
  { label: "Print", href: "/settings/general?tab=print" },
  { label: "Invoice Templates", href: "/settings/invoice-templates" },
  { label: "Taxes & GST", href: "/settings/gst" },
  { label: "Business Profile", href: "/settings/business" },
  { label: "Multi Firm", href: "/settings/companies" },
  { label: "Party", href: "/settings/general?tab=party" },
  { label: "Item", href: "/settings/general?tab=item" },
  { label: "Metal Purity", href: "/settings/purity" },
  { label: "Custom Fields", href: "/settings/custom-fields" },
  { label: "Accounting", href: "/settings/accounting-years" },
  { label: "Users & Roles", href: "/settings/users" },
];

function SettingsNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const tab = params.get("tab");
  const current = tab ? `${pathname}?tab=${tab}` : pathname;
  const tabs = SETTINGS_TABS.filter((t) => !term || t.label.toLowerCase().includes(term.toLowerCase()));

  return (
    <nav aria-label="Settings sections" className="flex w-full shrink-0 flex-col bg-sidebar text-sidebar-foreground md:w-64 print:hidden">
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        {searching ? (
          <input
            autoFocus
            aria-label="Search settings"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onBlur={() => !term && setSearching(false)}
            placeholder="Search settings"
            className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/60"
          />
        ) : (
          <h1 className="text-xl font-medium">Settings</h1>
        )}
        <button type="button" aria-label="Search settings" onClick={() => setSearching(true)} className="text-white/90 hover:text-white">
          <Search className="h-5 w-5" />
        </button>
      </div>
      <ul className="flex gap-0 overflow-x-auto md:flex-col md:overflow-y-auto">
        {tabs.map((t) => {
          const active = current === t.href;
          return (
            <li key={t.href} className="shrink-0">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap px-4 py-4 text-[13px] font-semibold uppercase tracking-wide text-white/90 hover:bg-white/5 md:ml-1",
                  active && "rounded-l-md bg-background text-foreground hover:bg-background",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="vy-settings -m-3 flex min-h-[calc(100svh-3.5rem)] flex-col sm:-m-4 md:flex-row lg:-m-5">
      <Suspense fallback={<div className="w-64 bg-sidebar" />}>
        <SettingsNav />
      </Suspense>
      <div className="relative min-w-0 flex-1 bg-background px-4 py-5 lg:px-8">
        <button
          type="button"
          aria-label="Close settings"
          title="Close settings"
          onClick={() => router.push("/")}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#6b7280] text-white hover:bg-[#4b5263] print:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
