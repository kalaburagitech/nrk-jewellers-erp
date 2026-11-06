"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { formatPaise } from "@/lib/money";

export default function MetalRateHistoryPage() {
  const purities = useQuery(api.metalPurities.list);
  const [selected, setSelected] = useState<Id<"metalPurities"> | null>(null);
  const effectivePurityId = selected ?? purities?.[0]?._id ?? null;
  const history = useQuery(
    api.metalRates.getHistory,
    effectivePurityId ? { metalPurityId: effectivePurityId } : "skip",
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rate History</h1>
        <p className="text-sm text-muted-foreground">Every rate change ever recorded, newest first.</p>
      </div>

      {purities && purities.length > 0 && (
        <Select
          value={effectivePurityId ?? undefined}
          onValueChange={(v) => setSelected(v as Id<"metalPurities">)}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select purity" />
          </SelectTrigger>
          <SelectContent>
            {purities.map((p) => (
              <SelectItem key={p._id} value={p._id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {history === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No rate changes recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Rate / gram</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell>{new Date(row.effectiveAt).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatPaise(row.ratePerGramPaise)}
                    </TableCell>
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
