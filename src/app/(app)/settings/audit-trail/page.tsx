"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PeriodPicker, ReportHeader, ReportTable, usePeriod } from "@/components/report-kit";

const ACTION_LABEL = (action: string) =>
  action
    .replaceAll("_", " ")
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" → ");

export default function AuditTrailPage() {
  const period = usePeriod("this-month");
  const access = useQuery(api.organizations.getMyAccess);
  const role = access?.membership?.role;
  const allowed = role === "owner" || role === "admin";
  const rows = useQuery(api.auditTrail.list, allowed ? period.range : "skip");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <ReportHeader title="Audit Trail" description="Every bill, purchase, stock and settings change with who did it and when." controls={<PeriodPicker state={period} />} />
      {access && !allowed ? (
        <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Only the Owner or an Admin can see the audit trail.</p>
      ) : (
        <ReportTable
          rows={rows}
          rowKey={(r) => r.id}
          csvName="audit-trail"
          columns={[
            { key: "date", label: "Date & Time", value: (r) => r.date, render: (r) => new Date(r.date).toLocaleString("en-IN") },
            { key: "user", label: "User", value: (r) => r.user },
            { key: "action", label: "Action", value: (r) => ACTION_LABEL(r.action) },
            { key: "entity", label: "Record", value: (r) => r.entity.replaceAll("_", " ") },
            { key: "detail", label: "Details", value: (r) => r.detail },
          ]}
        />
      )}
    </div>
  );
}
