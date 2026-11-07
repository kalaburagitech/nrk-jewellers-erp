"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv-export";

export function ExportCsvButton({
  filename,
  headers,
  rows,
  label = "Export CSV",
}: {
  label?: string;
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={rows.length === 0}
      onClick={() => downloadCsv(filename, headers, rows)}
    >
      <Download className="h-4 w-4" />
      {label}
    </Button>
  );
}
