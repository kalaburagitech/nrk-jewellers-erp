"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { REPORT_GROUPS } from "@/lib/report-catalog";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { cn } from "@/lib/utils";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLocked } = usePrivacyLock();
  const access = useQuery(api.organizations.getMyAccess);
  const companyType = access?.organization?.companyType;
  const gstCompany = companyType === "gst_gold" || companyType === "gst_silver";

  return (
    // Bleed out of the shell padding so the report list sits flush against the sidebar, like Vyapar.
    <div className="-m-3 flex h-[calc(100svh-3.5rem)] min-h-0 sm:-m-4 lg:-m-5 print:m-0 print:block print:h-auto">
      <nav
        aria-label="Reports"
        className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-[#f7f8fa] [scrollbar-width:thin] md:block dark:bg-card print:hidden"
      >
        {REPORT_GROUPS.map((group) => {
          const reports = group.reports.filter((r) => !r.privateOnly || (!isLocked && !gstCompany));
          return (
            <div key={group.title}>
              <p className="bg-[#eef6f4] px-4 py-3.5 text-[13px] text-muted-foreground dark:bg-muted">{group.title}</p>
              <ul>
                {reports.map((r) => {
                  const active = pathname === r.href;
                  return (
                    <li key={r.href}>
                      <Link
                        href={r.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block border-l-[3px] border-transparent px-4 py-2.5 text-[13px] font-medium text-foreground/90 hover:bg-[#e8ebf0] dark:hover:bg-accent",
                          active && "border-l-primary bg-[#e4e7ec] text-foreground dark:bg-accent",
                        )}
                      >
                        {r.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#e9ecf1] dark:bg-background print:overflow-visible print:bg-white">
        <div className="border-b border-border bg-card px-3 py-2 md:hidden print:hidden">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="report-picker">Report</label>
          <select
            id="report-picker"
            value={pathname}
            onChange={(e) => {
              router.push(e.target.value);
            }}
            className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
          >
            {REPORT_GROUPS.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.reports
                  .filter((r) => !r.privateOnly || (!isLocked && !gstCompany))
                  .map((r) => (
                    <option key={r.href} value={r.href}>
                      {r.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 print:overflow-visible">{children}</div>
      </div>
    </div>
  );
}
