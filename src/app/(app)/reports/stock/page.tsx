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

  const totalNetWeightMg = stock?.rows.reduce((sum, r) => sum + r.netWeightMg, 0) ?? 0;
  const estimatedValuePaise =
    stock?.rows.reduce((sum, r) => {
      const rate = rateByPurity.get(r.purity._id);
      return sum + (rate ? Math.round((r.netWeightMg * rate) / 1000) : 0);
    }, 0) ?? 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock Report</h1>
          <p className="text-sm text-muted-foreground">Current in-stock weight and piece count by purity.</p>
        </div>
        {stock && (
          <ExportCsvButton
            filename="stock-report"
            headers={["Purity", "Metal", "Pieces", "Net Weight (g)"]}
            rows={stock.rows.map((r) => [r.purity.label, r.purity.metal, r.pieceCount, Number(mgToGramsDisplay(r.netWeightMg))])}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Net Weight</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">{mgToGramsDisplay(totalNetWeightMg)}g</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Value (current rates)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">{formatPaise(estimatedValuePaise)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By Purity</CardTitle>
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
                  <TableHead className="text-right">Net Weight</TableHead>
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
                    <TableCell className="text-right">{mgToGramsDisplay(r.netWeightMg)}g</TableCell>
                  </TableRow>
                ))}
                {stock.unassigned.pieceCount > 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No purity set</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>{stock.unassigned.pieceCount}</TableCell>
                    <TableCell className="text-right">{mgToGramsDisplay(stock.unassigned.netWeightMg)}g</TableCell>
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
