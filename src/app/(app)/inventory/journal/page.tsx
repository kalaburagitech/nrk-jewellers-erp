"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Boxes } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";

const SOURCE_LABEL: Record<string, string> = {
  box_opening: "Opening stock",
  purchases: "Purchase",
  sales: "Sale",
  stock_adjustments: "Adjustment",
  box_transfers: "Box transfer",
};

export default function StockJournalPage() {
  const journal = useQuery(api.reports.getStockJournal);

  return (
    <>
      <div className="mx-auto flex max-w-full flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock Journal</h1>
          <p className="text-sm text-muted-foreground">
            Every stock movement, newest first — company, box, item, weight, pieces and transaction type. Box weights are gross weight.
          </p>
        </div>

      <Card>
        <CardContent className="p-0">
          {journal === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : journal.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Boxes className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Box</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead className="text-right">Pcs</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journal.map((m) => (
                  <TableRow key={m._id}>
                    <TableCell>{new Date(m.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="font-medium">{m.boxName}</TableCell>
                    <TableCell>{m.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{SOURCE_LABEL[m.sourceTable] ?? m.sourceTable}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{m.note ?? ""}</TableCell>
                    <TableCell className="text-right">{m.quantity}</TableCell>
                    <TableCell>
                      <Badge variant={m.direction === "in" ? "secondary" : "outline"} className="capitalize">
                        {m.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{mgToGramsDisplay(m.netWeightMg)}g</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </div>
    </>
  );
}
