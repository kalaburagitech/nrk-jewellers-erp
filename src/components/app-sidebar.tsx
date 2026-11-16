"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_SECTIONS, type NavSection } from "@/lib/nav-data";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { isWriteOnlyPath } from "@/components/access-context";
import { PrivacyUnlockTrigger } from "@/components/privacy-unlock-trigger";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Menu entries the Owner can switch off in Settings → General → Transaction.
const OPTIONAL_DOCUMENT_PATHS = {
  quotations: ["/sales/quotations"],
  proforma: ["/sales/proforma"],
  orders: ["/sales/orders", "/purchases/orders"],
  challans: ["/sales/challans"],
} as const;

function pathOf(href: string) {
  return href.split("?")[0];
}

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const { isLocked } = usePrivacyLock();
  const { setOpenMobile, state, setOpen } = useSidebar();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const term = search.trim().toLowerCase();
  const viewOnly = role === "staff";
  const preferences = useQuery(api.appPreferences.get);
  const access = useQuery(api.organizations.getMyAccess);
  const companyType = access?.organization?.companyType;
  const companyName = access?.organization?.name ?? "NRK Jewellers";
  // Boxes are only for the Daily Sales company; GST companies keep item-wise stock.
  const gstCompany = companyType === "gst_gold" || companyType === "gst_silver";

  const disabledPaths = new Set<string>(
    (Object.keys(OPTIONAL_DOCUMENT_PATHS) as (keyof typeof OPTIONAL_DOCUMENT_PATHS)[])
      .filter((key) => preferences && !preferences.documents[key])
      .flatMap((key) => OPTIONAL_DOCUMENT_PATHS[key]),
  );

  // Vyapar's "Open Anything (Ctrl+F)": jump straight to the menu search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (state === "collapsed") setOpen(true);
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, setOpen]);

  function navigate() {
    setOpenMobile(false);
  }

  function sectionVisible(section: NavSection) {
    if (section.href === "/girvi") return !isLocked && (role === "owner" || role === "admin");
    if (section.href === "/boxes") return !isLocked && !gstCompany;
    if (viewOnly && isWriteOnlyPath(section.href)) return false;
    return true;
  }

  const sections = NAV_SECTIONS.filter(sectionVisible)
    .map((section) => ({
      section,
      children: section.items?.filter(
        (item) =>
          (!viewOnly || !isWriteOnlyPath(item.href)) &&
          !disabledPaths.has(item.href) &&
          (!term || section.title.toLowerCase().includes(term) || item.title.toLowerCase().includes(term)),
      ),
    }))
    .filter(
      ({ section, children }) =>
        !term || section.title.toLowerCase().includes(term) || (children?.length ?? 0) > 0,
    );

  return (
    <Sidebar collapsible="icon" className="premium-sidebar print:hidden">
      <SidebarHeader className="px-3 pb-2 pt-3 group-data-[collapsible=icon]:px-2">
        <label className="relative block group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
          <input
            ref={searchRef}
            aria-label="Open anything"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Open Anything (Ctrl+F)"
            className="h-10 w-full rounded-full border border-white/10 bg-sidebar-accent pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/75 focus:border-white/40"
          />
        </label>
      </SidebarHeader>
      <SidebarContent className="px-0 py-1">
        <SidebarMenu className="gap-0.5">
          {sections.map(({ section, children }) => {
            const active =
              pathname === section.href ||
              (section.href !== "/" && pathname.startsWith(section.href + "/")) ||
              Boolean(section.items?.some((item) => pathname === item.href || pathname.startsWith(item.href + "/")));
            const hasChildren = Boolean(children && children.length > 0);
            const isExpanded = hasChildren && (Boolean(term) || (expanded[section.href] ?? active));
            const subId = `navigation-${section.href.replaceAll("/", "-") || "home"}`;
            const sectionCreate =
              section.createHref && !viewOnly && !isWriteOnlyPath(pathOf(section.createHref)) ? section.createHref : undefined;
            return (
              <SidebarMenuItem key={section.href}>
                <div className="flex items-center">
                  <SidebarMenuButton
                    asChild
                    isActive={active && !isExpanded}
                    tooltip={section.title}
                    className="h-11 flex-1 rounded-none px-4 text-[15px] font-medium group-data-[collapsible=icon]:px-2"
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={subId}
                        onClick={() => {
                          if (state === "collapsed") setOpen(true);
                          setExpanded((prev) => ({ ...prev, [section.href]: !isExpanded }));
                        }}
                      >
                        <section.icon className="size-[19px]!" />
                        <span className="flex-1 truncate text-left">{section.title}</span>
                        {!sectionCreate && (
                          <ChevronDown className={`ml-auto h-4 w-4 opacity-80 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        )}
                      </button>
                    ) : (
                      <Link href={section.href} onClick={navigate} aria-current={pathname === section.href ? "page" : undefined}>
                        <section.icon className="size-[19px]!" />
                        <span className="truncate">{section.title}</span>
                      </Link>
                    )}
                  </SidebarMenuButton>
                  {sectionCreate && (
                    <Link
                      href={sectionCreate}
                      onClick={navigate}
                      aria-label={`Add to ${section.title}`}
                      title={`Add to ${section.title}`}
                      className="mr-3 flex size-7 shrink-0 items-center justify-center rounded-md text-white/85 hover:bg-white/10 group-data-[collapsible=icon]:hidden"
                    >
                      <Plus className="h-4 w-4" />
                    </Link>
                  )}
                </div>
                {hasChildren && isExpanded && (
                  <SidebarMenuSub id={subId} className="mx-0 gap-0 border-0 bg-black/15 px-0 py-1">
                    {children!.map((item) => {
                      const itemActive = pathname === item.href;
                      const create =
                        item.createHref && !viewOnly && !isWriteOnlyPath(pathOf(item.createHref)) ? item.createHref : undefined;
                      return (
                        <SidebarMenuSubItem key={item.href} className="flex items-center">
                          <SidebarMenuSubButton
                            asChild
                            isActive={itemActive}
                            className="h-10 flex-1 rounded-none pl-12 pr-2 text-[14px]! text-white/80 data-active:text-white"
                          >
                            <Link href={item.href} onClick={navigate} aria-current={itemActive ? "page" : undefined}>
                              <span className="truncate">{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                          {create && (
                            <Link
                              href={create}
                              onClick={navigate}
                              aria-label={`New ${item.title}`}
                              title={`New ${item.title}`}
                              className="mr-3 flex size-7 shrink-0 items-center justify-center rounded-md text-white/80 hover:bg-white/10"
                            >
                              <Plus className="h-4 w-4" />
                            </Link>
                          )}
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
        {term && sections.length === 0 && (
          <p className="px-4 py-6 text-sm text-white/70">No pages match “{search}”.</p>
        )}
      </SidebarContent>
      <SidebarFooter className="p-2">
        <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent px-2.5 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1">
          <Link href="/settings/companies" onClick={navigate} className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-0.5" title={companyName}>
            <Image src="/nrk-logo-gold.png" alt="" width={32} height={32} className="h-full w-full object-contain" />
          </Link>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <Link href="/settings/companies" onClick={navigate} className="block truncate text-[15px] font-semibold text-white">
              {companyName}
            </Link>
            <p className="truncate text-[11px] text-white/60">
              <PrivacyUnlockTrigger enabled={role === "owner"}>The Name of Purity</PrivacyUnlockTrigger>
            </p>
          </div>
          <Link href="/settings/companies" onClick={navigate} aria-label="Companies" className="text-white/80 group-data-[collapsible=icon]:hidden">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
