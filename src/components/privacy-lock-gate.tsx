"use client";

import { usePrivacyLock } from "@/components/privacy-lock-context";
import { EyeOff } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Hides a private section while the privacy lock is on. Deliberately shows a
 * neutral message with no passcode box or hint — the Owner unlocks from the
 * hidden trigger in the sidebar, and this page then appears on its own.
 */
export function PrivacyLockGate({ children }: { children: React.ReactNode }) {
  const { isLocked } = usePrivacyLock();
  if (isLocked) return <PrivacyHiddenNotice />;
  return <>{children}</>;
}

export function PrivacyHiddenNotice() {
  return (
    <div className="mx-auto my-12 flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
      <EyeOff className="h-7 w-7 text-muted-foreground" />
      <h1 className="text-lg font-semibold tracking-tight">This page isn’t available</h1>
      <p className="text-sm text-muted-foreground">Go back to Home to continue.</p>
    </div>
  );
}

/**
 * Box screens: each company has its own boxes. The GST company's boxes are not
 * private, so they stay visible while the lock is on; Daily Sales boxes hide.
 */
export function BoxScreensGate({ children }: { children: React.ReactNode }) {
  const { isLocked } = usePrivacyLock();
  const access = useQuery(api.organizations.getMyAccess);
  const companyType = access?.organization?.companyType;
  const gstCompany = companyType === "gst_gold" || companyType === "gst_silver";
  if (isLocked && !gstCompany) return <PrivacyHiddenNotice />;
  return <>{children}</>;
}
