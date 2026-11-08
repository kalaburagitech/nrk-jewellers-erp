"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { DeleteRecordButton } from "@/components/delete-record-button";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Gem, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatPurity(basisPoints: number) {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

export default function MetalPurityPage() {
  const purities = useQuery(api.metalPurities.list);
  const createPurity = useMutation(api.metalPurities.create);
  const setActive = useMutation(api.metalPurities.setActive);

  const [open, setOpen] = useState(false);
  const [metal, setMetal] = useState<"gold" | "silver">("gold");
  const [label, setLabel] = useState("");
  const [percent, setPercent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const percentValue = Number(percent);
    if (!label.trim() || !Number.isFinite(percentValue) || percentValue <= 0 || percentValue > 100) {
      setError("Enter a label and a purity percentage between 0 and 100.");
      return;
    }
    setSubmitting(true);
    try {
      await createPurity({
        metal,
        label: label.trim(),
        purityBasisPoints: Math.round(percentValue * 100),
      });
      setOpen(false);
      setLabel("");
      setPercent("");
      setMetal("gold");
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not add this purity. Check your access and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const selection = useRecordSelection(purities?.map(row => row._id) ?? [], "metalPurities");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Metal Purity Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Purities used across billing, purchases and inventory.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add Purity
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add metal purity</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label>Metal</Label>
                <Select value={metal} onValueChange={(v) => setMetal(v as "gold" | "silver")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold">Gold</SelectItem>
                    <SelectItem value="silver">Silver</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Label</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="22K" />
              </div>
              <div className="grid gap-2">
                <Label>Purity percentage</Label>
                <Input
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="91.66"
                  inputMode="decimal"
                />
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

      <BulkRecordActions selection={selection} table="metalPurities" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured purities</CardTitle>
        </CardHeader>
        <CardContent>
          {purities === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : purities.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Gem className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No purities configured yet. Add 24K, 22K, 18K gold and silver to get started.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Metal</TableHead>
                  <TableHead>Purity</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purities.map((p) => (
                  <TableRow key={p._id} data-state={selection.has(p._id) ? "selected" : undefined}>
                    <TableCell><Checkbox aria-label={`Select ${p.label}`} checked={selection.has(p._id)} onCheckedChange={() => selection.toggle(p._id)} /></TableCell>
                    <TableCell className="font-medium"><div className="flex items-center justify-between gap-3"><span>{p.label}</span><DeleteRecordButton table="metalPurities" id={p._id} name={p.label} /></div></TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {p.metal}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatPurity(p.purityBasisPoints)}</TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={p.isActive}
                        onCheckedChange={(checked) => setActive({ id: p._id, isActive: checked })}
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
