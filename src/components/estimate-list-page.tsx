"use client";

import { DeleteDocumentButton } from "@/components/delete-document-button";
import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPaise } from "@/lib/money";
import { EstimateFormDialog } from "@/components/estimate-form";

export function EstimateListPage({
  documentType,
  heading,
  description,
  triggerLabel,
  dialogTitle,
}: {
  documentType: "quotation" | "proforma_invoice";
  heading: string;
  description: string;
  triggerLabel: string;
  dialogTitle: string;
}) {
  const rows = useQuery(api.sales.listByDocumentType, { documentType });
  const selection = useRecordSelection(rows?.map((row) => row._id) ?? [], `sales:${documentType}`);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <EstimateFormDialog documentType={documentType} triggerLabel={triggerLabel} title={dialogTitle} />
      </div>

      <BulkRecordActions selection={selection} table="sales" />

      <Card>
        <CardContent className="p-0">
          {rows === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={(checked) => selection.selectAll(checked === true)} /></TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Print</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r._id} data-state={selection.has(r._id) ? "selected" : undefined}>
                    <TableCell><Checkbox aria-label={`Select ${r.invoiceNumber}`} checked={selection.has(r._id)} onCheckedChange={() => selection.toggle(r._id)} /></TableCell>
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{r.invoiceNumber}</Badge>
                      <DeleteDocumentButton compact table="sales" id={r._id} name={r.invoiceNumber} />
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="text-right">{formatPaise(r.totalPaise)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/sales/invoices/${r._id}/print`} className="text-sm text-gold underline">
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
