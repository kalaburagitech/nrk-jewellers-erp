"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { NAV_SECTIONS } from "@/lib/nav-data";

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader className="border-b border-sidebar-border/60">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Image src="/nrk-logo.png" alt="NRK" width={42} height={28} className="rounded bg-white object-contain" />
          </div>
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="font-semibold text-sm tracking-wide">NRK JEWELLERS</span>
            <span className="text-[11px] text-sidebar-foreground/60">The Name of Purity</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_SECTIONS.map((section) => {
                const isActiveSection =
                  pathname === section.href || pathname.startsWith(section.href + "/");
                return (
                  <SidebarMenuItem key={section.title}>
                    <SidebarMenuButton asChild isActive={isActiveSection} tooltip={section.title}>
                      <Link href={section.href}>
                        <section.icon />
                        <span>{section.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {section.items && isActiveSection && (
                      <SidebarMenuSub>
                        {section.items.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={pathname === item.href}>
                              <Link href={item.href}>{item.title}</Link>
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
      </SidebarContent>
    </Sidebar>
  );
}
