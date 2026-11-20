"use client";

import { ReactNode, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Eye, Gem, Loader2, Lock } from "lucide-react";
import { AccessProvider, isWriteOnlyPath } from "@/components/access-context";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { AppLockGate } from "@/components/app-lock-gate";
import { PrivacyLockProvider } from "@/components/privacy-lock-context";
import { DailySalesPrivacyGuard } from "@/components/daily-sales-privacy-guard";
import { Toaster } from "@/components/toaster";

/** The expanded / collapsed choice the user last made (the sidebar saves it in a cookie); expanded the first time. */
function savedSidebarOpen() {
  if (typeof document === "undefined") return true;
  return !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);
}

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
  const pathname = usePathname();

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
        <Gem className="h-8 w-8 text-primary" />
        <h1 className="text-lg font-semibold">Setting up your workspace…</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          If this takes more than a moment, your account may be waiting for an administrator to
          grant access to an organization.
        </p>
      </CenteredState>
    );
  }

  const viewOnly = access.membership.role === "staff";
  const blocked = viewOnly && isWriteOnlyPath(pathname);

  return (
    <AccessProvider role={access.membership.role}>
    <AppLockGate userId={access.membership.userId}>
      <PrivacyLockProvider>
        <SidebarProvider defaultOpen={savedSidebarOpen()} className="erp-shell">
          <AppSidebar role={access.membership.role} />
          {/* min-w-0: let wide tables scroll inside their own box instead of widening the whole page. */}
          <SidebarInset className="min-w-0">
            <AppTopbar
              organizationName={access.organization?.name}
              userName={access.user?.name ?? access.user?.email}
              role={access.membership.role}
              companies={access.companies}
              activeOrganizationId={access.organization?._id}
            />
            {viewOnly && (
              <div role="status" className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden dark:bg-amber-950/40 dark:text-amber-200">
                <Eye className="h-4 w-4 shrink-0" />
                <span><strong>View only.</strong> You can see records but cannot add, edit or delete. Ask the Owner for changes.</span>
              </div>
            )}
            <main className="erp-main flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5 print:overflow-visible print:p-0">
              {blocked ? (
                <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
                  <Lock className="h-8 w-8 text-muted-foreground" />
                  <h1 className="text-lg font-semibold">This screen is for the Owner</h1>
                  <p className="text-sm text-muted-foreground">Your login is view only, so you can’t create bills, purchases, backups or delete data.</p>
                  <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Go to Home</Link>
                </div>
              ) : (
                <DailySalesPrivacyGuard activeCompanyType={access.organization?.companyType} companies={access.companies}>
                  {children}
                </DailySalesPrivacyGuard>
              )}
            </main>
            <Toaster />
          </SidebarInset>
        </SidebarProvider>
      </PrivacyLockProvider>
    </AppLockGate>
    </AccessProvider>
  );
}
