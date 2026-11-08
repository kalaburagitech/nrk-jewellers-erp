"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ChevronDown, Plus, Search, Sparkles } from "lucide-react";
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
const GROUPS = [
  {
    label: "Daily workspace",
    paths: ["/", "/sales", "/purchases", "/inventory", "/boxes", "/girvi"],
  },
  {
    label: "Business & insights",
    paths: [
      "/customers",
      "/suppliers",
      "/cash-bank",
      "/metal-rates",
      "/reports",
    ],
  },
  { label: "Administration", paths: ["/settings", "/backup", "/manage-data"] },
];
export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile, state, setOpen } = useSidebar();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  function navigate() {
    setOpenMobile(false);
  }
  return (
    <Sidebar collapsible="icon" className="premium-sidebar print:hidden">
      <SidebarHeader className="gap-4 border-b border-sidebar-border/70 px-4 py-5 group-data-[collapsible=icon]:px-2">
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
        <Link
          href="/sales/new"
          onClick={navigate}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sidebar-ring group-data-[collapsible=icon]:hidden"
        >
          <Plus className="h-4 w-4" />
          New retail invoice
          <span className="ml-auto rounded border border-white/20 px-1.5 py-0.5 text-xs text-white/70">
            F2
          </span>
        </Link>
        <label className="relative block group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-sidebar-foreground/60" />
          <input
            aria-label="Search navigation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a page…"
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
                        pathname.startsWith(section.href + "/"));
                    const isExpanded =
                      Boolean(term) || (expanded[section.href] ?? active);
                    const children = section.items?.filter(
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
                          className="h-11 rounded-xl px-3 text-[15px] font-medium data-active:font-semibold"
                        >
                          <Link
                            href={section.href}
                            onClick={navigate}
                            aria-current={
                              pathname === section.href ? "page" : undefined
                            }
                          >
                            <section.icon className="size-[19px]!" />
                            <span>
                              {section.title === "Purchases & Expenses"
                                ? "Purchases & expenses"
                                : section.title === "Manage / Delete Data"
                                  ? "Data & recycle bin"
                                  : section.title}
                            </span>
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
      <SidebarFooter className="border-t border-sidebar-border/70 px-5 py-4 group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-sidebar-primary" />
          Your jewellery workspace
        </div>
        <p className="mt-1.5 text-xs text-sidebar-foreground/50">
          F2 New bill · F3 Purchase · Ctrl/⌘ B Sidebar
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
