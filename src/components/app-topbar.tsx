"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-card/60 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/40">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-medium text-foreground/90">{organizationName}</span>
      </div>
      <div className="flex items-center gap-3">
        {role && (
          <Badge variant="outline" className="hidden sm:inline-flex capitalize">
            {role.replace("_", " ")}
          </Badge>
        )}
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
