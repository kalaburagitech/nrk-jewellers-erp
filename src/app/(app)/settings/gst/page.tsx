"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { DeleteRecordButton } from "@/components/delete-record-button";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { percentToBasisPoints } from "@/lib/money";

function formatBasisPointsPercent(bp: number) {
  return `${(bp / 100).toFixed(2)}%`;
}

export default function GstConfigurationPage() {
  const configs = useQuery(api.taxConfigurations.list);
  const createConfig = useMutation(api.taxConfigurations.create);
  const setActive = useMutation(api.taxConfigurations.setActive);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cgst, setCgst] = useState("");
  const [sgst, setSgst] = useState("");
  const [igst, setIgst] = useState("");
  const [hsnCode, setHsnCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCgst("");
    setSgst("");
    setIgst("");
    setHsnCode("");
    setError(null);
  }

  async function handleCreate() {
    const cgstBp = percentToBasisPoints(cgst || "0");
    const sgstBp = percentToBasisPoints(sgst || "0");
    const igstBp = percentToBasisPoints(igst || "0");
    if (!name.trim() || cgstBp === null || sgstBp === null || igstBp === null) {
      setError("Enter a name and valid percentages (0-100) for each tax component.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createConfig({
        name: name.trim(),
        cgstBasisPoints: cgstBp,
        sgstBasisPoints: sgstBp,
        igstBasisPoints: igstBp,
        hsnCode: hsnCode || undefined,
      });
      reset();
      setOpen(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save these settings. Check your access and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const selection = useRecordSelection(configs?.map(row => row._id) ?? [], "taxConfigurations");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">GST Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Tax rates applied to GST invoices. Historical bills keep the rate that was active when
            finalized — changing a rate here never alters a past invoice.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add Tax Rate
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add GST rate</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GST 3%" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label>CGST %</Label>
                  <Input value={cgst} onChange={(e) => setCgst(e.target.value)} placeholder="1.5" inputMode="decimal" />
                </div>
                <div className="grid gap-2">
                  <Label>SGST %</Label>
                  <Input value={sgst} onChange={(e) => setSgst(e.target.value)} placeholder="1.5" inputMode="decimal" />
                </div>
                <div className="grid gap-2">
                  <Label>IGST %</Label>
                  <Input value={igst} onChange={(e) => setIgst(e.target.value)} placeholder="0" inputMode="decimal" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>HSN code</Label>
                <Input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="optional" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <BulkRecordActions selection={selection} table="taxConfigurations" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured tax rates</CardTitle>
        </CardHeader>
        <CardContent>
          {configs === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : configs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No tax rates configured yet. Add the GST slabs you bill under (e.g. 1.5% + 1.5%).
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>CGST</TableHead>
                  <TableHead>SGST</TableHead>
                  <TableHead>IGST</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((c) => (
                  <TableRow key={c._id} data-state={selection.has(c._id) ? "selected" : undefined}>
                    <TableCell><Checkbox aria-label={`Select ${c.name}`} checked={selection.has(c._id)} onCheckedChange={() => selection.toggle(c._id)} /></TableCell>
                    <TableCell className="font-medium"><div className="flex items-center justify-between gap-3"><span>{c.name}</span><DeleteRecordButton table="taxConfigurations" id={c._id} name={c.name} /></div></TableCell>
                    <TableCell>{formatBasisPointsPercent(c.cgstBasisPoints)}</TableCell>
                    <TableCell>{formatBasisPointsPercent(c.sgstBasisPoints)}</TableCell>
                    <TableCell>{formatBasisPointsPercent(c.igstBasisPoints)}</TableCell>
                    <TableCell className="text-muted-foreground">{c.hsnCode ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={c.isActive}
                        onCheckedChange={(checked) => setActive({ id: c._id, isActive: checked })}
                      />
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
