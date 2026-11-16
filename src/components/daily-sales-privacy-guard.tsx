"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { PrivacyHiddenNotice } from "@/components/privacy-lock-gate";

type Company = { organizationId: string; companyType?: string };

/** Companies anyone may see while the privacy lock is on: GST companies only — Daily Sales is private. */
export function companiesVisibleWhileLocked<T extends Company>(companies: T[]) {
  return companies.filter((company) => company.companyType !== "daily_sales");
}

/**
 * Daily Sales is the owner's private book; only GST sales are for anyone
 * else (and the government) to see. While the privacy lock is on, a login
 * sitting in the Daily Sales company is moved to a GST company, and if there
 * is none, the Daily Sales screens stay hidden until the Owner unlocks.
 */
export function DailySalesPrivacyGuard({
  activeCompanyType,
  companies,
  children,
}: {
  activeCompanyType?: string;
  companies: Company[];
  children: ReactNode;
}) {
  const { isLocked } = usePrivacyLock();
  const selectCompany = useMutation(api.organizations.selectCompany);
  const switching = useRef(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const hidden = isLocked && activeCompanyType === "daily_sales";
  const gstCompany = companiesVisibleWhileLocked(companies)[0];

  useEffect(() => {
    if (!hidden || !gstCompany || switching.current) return;
    switching.current = true;
    selectCompany({ organizationId: gstCompany.organizationId as Id<"organizations"> })
      .catch(() => setSwitchFailed(true))
      .finally(() => {
        switching.current = false;
      });
  }, [hidden, gstCompany, selectCompany]);

  if (!hidden) return <>{children}</>;
  // No GST company to move to (or the switch failed): keep Daily Sales hidden.
  if (!gstCompany || switchFailed) return <PrivacyHiddenNotice />;
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
