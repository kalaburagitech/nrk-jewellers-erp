"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_SECTIONS } from "@/lib/nav-data";
import { isWriteOnlyPath } from "@/components/access-context";
import { setAmountDecimals } from "@/lib/money";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Menu entries the Owner can switch off in Settings → General → Transaction.
const OPTIONAL_DOCUMENT_PATHS = {
  quotations: ["/sales/quotations"],
  proforma: ["/sales/proforma"],
  orders: ["/sales/orders", "/purchases/orders"],
  challans: ["/sales/challans"],
  otherIncome: ["/cash-bank/accounts?tab=income"],
} as const;
const GROUPS = [
  {
    label: "Home",
    paths: ["/"],
  },
  {
    label: "Transactions",
    paths: ["/customers", "/inventory/products", "/sales", "/purchases", "/girvi"],
  },
  { label: "Stock & money", paths: ["/inventory", "/boxes", "/cash-bank", "/metal-rates"] },
  { label: "GST & Reports", paths: ["/gst", "/reports"] },
  { label: "Settings & data", paths: ["/settings", "/backup", "/manage-data"] },
];
export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const { setOpenMobile, state, setOpen } = useSidebar();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const viewOnly = role === "staff";
  const preferences = useQuery(api.appPreferences.get);
  // Sidebar renders before page content, so every amount on screen picks this up.
  if (preferences) setAmountDecimals(preferences.amountDecimals);
  const disabledPaths = new Set<string>(
    (Object.keys(OPTIONAL_DOCUMENT_PATHS) as (keyof typeof OPTIONAL_DOCUMENT_PATHS)[])
      .filter((key) => preferences && !(key === "otherIncome" ? preferences.otherIncome : preferences.documents[key]))
      .flatMap((key) => OPTIONAL_DOCUMENT_PATHS[key]),
  );
  function navigate() {
    setOpenMobile(false);
  }
  return (
    <Sidebar collapsible="icon" className="premium-sidebar print:hidden">
      <SidebarHeader className="gap-3 border-b border-sidebar-border/70 px-4 py-4 group-data-[collapsible=icon]:px-2">
        <Link
          href="/"
          onClick={navigate}
          className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9">
            <Image
              src="/nrk-logo-gold.png"
              alt="NRK Jewellers"
              width={72}
              height={44}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-[15px] font-bold tracking-wide">NRK JEWELLERS</p>
            <p className="mt-1 text-xs text-sidebar-primary">
              The Name of Purity
            </p>
          </div>
        </Link>
        {!viewOnly && <Link
          href="/sales/new"
          onClick={navigate}
          className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sidebar-ring group-data-[collapsible=icon]:hidden"
        >
          <Plus className="h-4 w-4" />
          New Sale
          <span className="ml-auto rounded border border-white/20 px-1.5 py-0.5 text-xs text-white/70">
            F2
          </span>
        </Link>}
        {/* Collapsed: the same New Sale action as an icon. */}
        {!viewOnly && (
          <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="New Sale (F2)" className="justify-center bg-white/10 text-white hover:bg-white/20 hover:text-white">
                <Link href="/sales/new" onClick={navigate} aria-label="New Sale">
                  <Plus className="size-[19px]!" />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <label className="relative block group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-sidebar-foreground/60" />
          <input
            aria-label="Search navigation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu"
            className="h-10 w-full rounded-lg border border-white/10 bg-black/10 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/50 focus:border-sidebar-primary/60"
          />
        </label>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-2 py-3">
        {GROUPS.map((group) => {
          const sections = group.paths
            .flatMap((path) =>
              NAV_SECTIONS.filter((section) => section.href === path),
            )
            .filter((section) => section.href !== "/girvi" || role === "owner" || role === "admin")
            .filter((section) => !viewOnly || !isWriteOnlyPath(section.href))
            .filter(
              (section) =>
                !term ||
                section.title.toLowerCase().includes(term) ||
                section.items?.some((item) =>
                  item.title.toLowerCase().includes(term),
                ),
            );
          if (!sections.length) return null;
          return (
            <SidebarGroup key={group.label} className="px-1 py-2">
              <SidebarGroupLabel className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/65">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {sections.map((section) => {
                    const active =
                      pathname === section.href ||
                      (section.href !== "/" &&
                        pathname.startsWith(section.href + "/")) ||
                      Boolean(section.items?.some(
                        (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
                      ));
                    const isExpanded =
                      Boolean(term) || (expanded[section.href] ?? active);
                    const children = section.items?.filter(
                      (item) => (!viewOnly || !isWriteOnlyPath(item.href)) && !disabledPaths.has(item.href),
                    ).filter(
                      (item) =>
                        !term ||
                        section.title.toLowerCase().includes(term) ||
                        item.title.toLowerCase().includes(term),
                    );
                    const subId = `navigation-${section.href.replaceAll("/", "-") || "home"}`;
                    return (
                      <SidebarMenuItem key={section.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={section.title}
                          className="h-10 rounded-xl px-3 text-[15px] font-medium data-active:font-semibold"
                        >
                          <Link
                            href={section.href}
                            onClick={navigate}
                            aria-current={
                              pathname === section.href ? "page" : undefined
                            }
                          >
                            <section.icon className="size-[19px]!" />
                            <span>{section.title === "Manage / Delete Data" ? "Data & recycle bin" : section.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {children && (
                          <SidebarMenuAction
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${section.title}`}
                            aria-expanded={isExpanded}
                            aria-controls={subId}
                            className="top-2 right-2 size-7 rounded-md"
                            onClick={() => {
                              if (state === "collapsed") setOpen(true);
                              setExpanded((prev) => ({
                                ...prev,
                                [section.href]: !isExpanded,
                              }));
                            }}
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            />
                          </SidebarMenuAction>
                        )}
                        {children && isExpanded && (
                          <SidebarMenuSub
                            id={subId}
                            className="ml-5 mr-1 mt-1 gap-1 border-sidebar-border/70 pl-3"
                          >
                            {children.map((item) => (
                              <SidebarMenuSubItem key={item.href}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={pathname === item.href}
                                  className="h-10 rounded-lg px-3 text-[14px]! text-sidebar-foreground/75 data-active:text-white"
                                >
                                  <Link
                                    href={item.href}
                                    onClick={navigate}
                                    aria-current={
                                      pathname === item.href
                                        ? "page"
                                        : undefined
                                    }
                                  >
                                    <span>{item.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
        {term &&
          !NAV_SECTIONS.some(
            (section) =>
              section.title.toLowerCase().includes(term) ||
              section.items?.some((item) =>
                item.title.toLowerCase().includes(term),
              ),
          ) && (
            <p className="px-4 py-6 text-sm text-sidebar-foreground/70">
              No pages match “{search}”.
            </p>
          )}
      </SidebarContent>
      {/* Stays as the user leaves it: only this button (or the topbar one) expands or collapses the menu. */}
      <SidebarFooter className="hidden border-t border-sidebar-border/70 p-2 md:flex">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={state === "collapsed" ? "Expand menu" : "Collapse menu"}
              onClick={() => setOpen(state === "collapsed")}
              aria-label={state === "collapsed" ? "Expand menu" : "Collapse menu"}
              className="h-10 rounded-xl px-3 text-sidebar-foreground/75 hover:text-white"
            >
              {state === "collapsed" ? <PanelLeftOpen className="size-[19px]!" /> : <PanelLeftClose className="size-[19px]!" />}
              <span>Collapse menu</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
