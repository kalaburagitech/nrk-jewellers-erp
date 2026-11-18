"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import { METAL_LABEL } from "@/lib/box-label";

/** Current box stock: metal-wise totals and the box-wise list (gross weight, pieces). */
export default function StockReportPage() {
  const boxes = useQuery(api.boxes.list);
  const active = boxes?.filter((b) => b.isActive) ?? [];
  const byMetal = (metal: "gold" | "silver") => active.filter((b) => b.metal === metal);
  const sumMg = (rows: typeof active) => rows.reduce((sum, b) => sum + b.weightMg, 0);
  const sumPcs = (rows: typeof active) => rows.reduce((sum, b) => sum + b.pieces, 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock Report</h1>
          <p className="text-sm text-muted-foreground">Current stock in boxes — gross weight and pieces, metal-wise and box-wise.</p>
        </div>
        {boxes && (
          <ExportCsvButton
            filename="stock-report"
            headers={["Box", "Name", "Metal", "Location", "Pieces", "Gross Weight (g)"]}
            rows={active.map((b) => [b.boxNumber, b.label ?? "", b.metal ? METAL_LABEL[b.metal] : "", b.location ?? "", b.pieces, Number(mgToGramsDisplay(b.weightMg))])}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {(["gold", "silver"] as const).map((metal) => (
          <Card key={metal}>
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{METAL_LABEL[metal]}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight">{mgToGramsDisplay(sumMg(byMetal(metal)))} g</p>
              <p className="text-xs text-muted-foreground">{sumPcs(byMetal(metal))} pcs · {byMetal(metal).length} boxes</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">All boxes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">{mgToGramsDisplay(sumMg(active))} g</p>
            <p className="text-xs text-muted-foreground">{sumPcs(active)} pcs · {active.length} boxes</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Box-wise stock</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {boxes === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : active.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Boxes className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No boxes yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Box</TableHead>
                  <TableHead>Metal</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Gross Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((b) => (
                  <TableRow key={b._id}>
                    <TableCell className="font-medium">Box {b.boxNumber}{b.label ? <span className="font-normal text-muted-foreground"> · {b.label}</span> : null}</TableCell>
                    <TableCell>{b.metal ? <Badge variant="outline">{METAL_LABEL[b.metal]}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">{b.pieces}</TableCell>
                    <TableCell className="text-right">{mgToGramsDisplay(b.weightMg)} g</TableCell>
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
