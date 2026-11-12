"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PackageSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

export default function BoxReportsPage() {
  const report = useQuery(api.reports.getBoxReport);
  const grams = (mg: number) => Number(mgToGramsDisplay(mg));

  return (
    <div className="mx-auto flex max-w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Box Reports</h1>
          <p className="text-sm text-muted-foreground">Physical stock and weight movements by box.</p>
        </div>
        {report && (
          <ExportCsvButton
            filename="box-stock-movement-report"
            headers={["Box", "Label", "Category", "Items", "Opening Weight (g)", "Stock Added / Adjusted (g)", "Weight Sold (g)", "Transferred In (g)", "Transferred Out (g)", "Current Physical Stock (g)"]}
            rows={report.map((row) => [
              `Box ${row.boxNumber}`, row.label ?? "", row.categories.join(", "), row.itemCount,
              grams(row.openingWeightMg), grams(row.stockAddedWeightMg), grams(row.weightSoldMg),
              grams(row.transferredInWeightMg), grams(row.transferredOutWeightMg), grams(row.currentPhysicalWeightMg),
            ])}
          />
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Box stock movement</CardTitle></CardHeader>
        <CardContent className="p-0">
          {report === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : report.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <PackageSearch className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No active boxes yet. Create a box to start tracking physical stock.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Box / Category</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Opening (g)</TableHead>
                    <TableHead className="text-right">Added / Adjusted (g)</TableHead>
                    <TableHead className="text-right">Sold (g)</TableHead>
                    <TableHead className="text-right">Transfer In (g)</TableHead>
                    <TableHead className="text-right">Transfer Out (g)</TableHead>
                    <TableHead className="text-right">Current Physical (g)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.map((row) => (
                    <TableRow key={row.boxId}>
                      <TableCell className="min-w-40 font-medium">
                        <div>Box {row.boxNumber}{row.label ? ` · ${row.label}` : ""}</div>
                        <div className="text-xs font-normal text-muted-foreground">{row.categories.join(", ") || "Uncategorized"}</div>
                      </TableCell>
                      <TableCell className="text-right">{row.itemCount}</TableCell>
                      <TableCell className="text-right">{mgToGramsDisplay(row.openingWeightMg)}</TableCell>
                      <TableCell className="text-right">{mgToGramsDisplay(row.stockAddedWeightMg)}</TableCell>
                      <TableCell className="text-right">{mgToGramsDisplay(row.weightSoldMg)}</TableCell>
                      <TableCell className="text-right">{mgToGramsDisplay(row.transferredInWeightMg)}</TableCell>
                      <TableCell className="text-right">{mgToGramsDisplay(row.transferredOutWeightMg)}</TableCell>
                      <TableCell className="text-right font-semibold">{mgToGramsDisplay(row.currentPhysicalWeightMg)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Opening weight is the baseline for each box. Older stock movements created before box locations were recorded are included in that baseline; movement totals show box-tagged activity going forward.
      </p>
    </div>
  );
}
