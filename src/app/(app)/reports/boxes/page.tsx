"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PackageSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

export default function BoxReportsPage() {
  const report = useQuery(api.reports.getBoxReport);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Box Reports</h1>
        <p className="text-sm text-muted-foreground">Item count and net weight currently in each box.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Boxes with stock</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {report === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : report.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <PackageSearch className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No boxes currently hold stock.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Box</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Net Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.map((r) => (
                  <TableRow key={r.boxId}>
                    <TableCell className="font-medium">
                      Box {r.boxNumber}
                      {r.label && <span className="ml-2 text-xs text-muted-foreground">{r.label}</span>}
                    </TableCell>
                    <TableCell>{r.itemCount}</TableCell>
                    <TableCell className="text-right">{mgToGramsDisplay(r.netWeightMg)}g</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
