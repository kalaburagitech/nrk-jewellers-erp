"use client";

import { ReactNode, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Gem, Loader2 } from "lucide-react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";

function CenteredState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      {children}
    </div>
  );
}

/**
 * Gates the authenticated app behind an organization membership: bootstraps
 * the first-ever user as Owner of a new org, shows a pending screen for any
 * later signup with no membership, and otherwise renders the app shell.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const access = useQuery(api.organizations.getMyAccess);
  const ensureBootstrapped = useMutation(api.organizations.ensureBootstrapped);
  const attempted = useRef(false);

  useEffect(() => {
    if (access && access.membership === null && !attempted.current) {
      attempted.current = true;
      void ensureBootstrapped({});
    }
  }, [access, ensureBootstrapped]);

  if (access === undefined || access === null) {
    return (
      <CenteredState>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </CenteredState>
    );
  }

  if (access.membership === null) {
    return (
      <CenteredState>
        <Gem className="h-8 w-8 text-gold" />
        <h1 className="text-lg font-semibold">Setting up your workspace…</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          If this takes more than a moment, your account may be waiting for an administrator to
          grant access to an organization.
        </p>
      </CenteredState>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppTopbar
          organizationName={access.organization?.name}
          userName={access.user?.name ?? access.user?.email}
          role={access.membership?.role}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 print:overflow-visible print:p-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
