"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatPaise } from "@/lib/money";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

export default function StockReportPage() {
  const stock = useQuery(api.reports.getStockByPurity);
  const currentRates = useQuery(api.metalRates.getCurrent);

  const rateByPurity = new Map<string, number>();
  currentRates?.forEach(({ purity, latest }) => {
    if (latest) rateByPurity.set(purity._id, latest.ratePerGramPaise);
  });

  const totalGrossWeightMg = stock?.rows.reduce((sum, r) => sum + (r.grossWeightMg ?? r.netWeightMg), 0) ?? 0;
  const totalStoneWeightMg = stock?.rows.reduce((sum, r) => sum + (r.stoneWeightMg ?? 0), 0) ?? 0;
  const totalNetWeightMg = stock?.rows.reduce((sum, r) => sum + r.netWeightMg, 0) ?? 0;
  const estimatedValuePaise =
    stock?.rows.reduce((sum, r) => {
      const rate = rateByPurity.get(r.purity._id);
      return sum + (rate ? Math.round((r.netWeightMg * rate) / 1000) : 0);
    }, 0) ?? 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock Report</h1>
          <p className="text-sm text-muted-foreground">Current in-stock gross, stone, and net weight by purity.</p>
        </div>
        {stock && (
          <ExportCsvButton
            filename="stock-report"
            headers={["Purity", "Metal", "Pieces", "Gross Wt (g)", "Stone Wt (g)", "Net Wt (g)"]}
            rows={stock.rows.map((r) => [
              r.purity.label,
              r.purity.metal,
              r.pieceCount,
              Number(mgToGramsDisplay(r.grossWeightMg ?? r.netWeightMg)),
              Number(mgToGramsDisplay(r.stoneWeightMg ?? 0)),
              Number(mgToGramsDisplay(r.netWeightMg)),
            ])}
          />
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Gross Wt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold tracking-tight">{mgToGramsDisplay(totalGrossWeightMg)}g</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Stone Wt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold tracking-tight text-muted-foreground">{mgToGramsDisplay(totalStoneWeightMg)}g</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Net Wt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold tracking-tight text-emerald-600">{mgToGramsDisplay(totalNetWeightMg)}g</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Est. Value (current)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold tracking-tight">{formatPaise(estimatedValuePaise)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock by Purity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stock === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : stock.rows.length === 0 && stock.unassigned.pieceCount === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Boxes className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No stock in boxes yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purity</TableHead>
                  <TableHead>Metal</TableHead>
                  <TableHead>Pieces</TableHead>
                  <TableHead className="text-right">Gross Wt</TableHead>
                  <TableHead className="text-right">Stone Wt</TableHead>
                  <TableHead className="text-right">Net Wt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.rows.map((r) => (
                  <TableRow key={r.purity._id}>
                    <TableCell className="font-medium">{r.purity.label}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {r.purity.metal}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.pieceCount}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">
                      {mgToGramsDisplay(r.grossWeightMg ?? r.netWeightMg)}g
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-muted-foreground">
                      {mgToGramsDisplay(r.stoneWeightMg ?? 0)}g
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono font-medium text-emerald-600">
                      {mgToGramsDisplay(r.netWeightMg)}g
                    </TableCell>
                  </TableRow>
                ))}
                {stock.unassigned.pieceCount > 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No purity set</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>{stock.unassigned.pieceCount}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">
                      {mgToGramsDisplay(stock.unassigned.grossWeightMg ?? stock.unassigned.netWeightMg)}g
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono text-muted-foreground">
                      {mgToGramsDisplay(stock.unassigned.stoneWeightMg ?? 0)}g
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono font-medium text-emerald-600">
                      {mgToGramsDisplay(stock.unassigned.netWeightMg)}g
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
