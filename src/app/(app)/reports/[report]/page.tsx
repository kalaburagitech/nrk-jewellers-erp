"use client";

import { use } from "react";
import Link from "next/link";
import { VYAPAR_REPORTS } from "@/components/vyapar/reports";

export default function VyaparReportPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = use(params);
  const render = VYAPAR_REPORTS[report];
  if (!render) {
    return (
      <div className="rounded-md bg-card py-16 text-center">
        <p className="text-muted-foreground">This report doesn&apos;t exist.</p>
        <Link href="/reports/sale" className="mt-2 inline-block text-sm text-primary underline">Open the Sale report</Link>
      </div>
    );
  }
  return <>{render()}</>;
}
