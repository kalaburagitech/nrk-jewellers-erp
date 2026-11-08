"use client";
import { getUserErrorMessage } from "@/lib/user-error";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { BulkRecordActions } from "@/components/bulk-record-actions";
import { Checkbox } from "@/components/ui/checkbox";

import { DeleteRecordButton } from "@/components/delete-record-button";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Boxes, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function StockCategoriesPage() {
  const categories = useQuery(api.stockCategories.list);
  const createCategory = useMutation(api.stockCategories.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createCategory({ name });
      setName("");
      setOpen(false);
    } catch (e) {
      setError(getUserErrorMessage(e, "Could not save these changes. Check your access and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const selection = useRecordSelection(categories?.map(row => row._id) ?? [], "stockCategories");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock Categories</h1>
          <p className="text-sm text-muted-foreground">Finer classification within a stock group.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add Category
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add stock category</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bangles" />
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

      <BulkRecordActions selection={selection} table="stockCategories" />
      <Card>
        <CardContent className="p-0">
          {categories === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : categories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Boxes className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No stock categories yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-12"><Checkbox aria-label="Select all visible records" checked={selection.all ? true : selection.partial ? "indeterminate" : false} onCheckedChange={checked => selection.selectAll(checked === true)} /></TableHead>
                  <TableHead>Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c._id} data-state={selection.has(c._id) ? "selected" : undefined}>
                    <TableCell><Checkbox aria-label={`Select ${c.name}`} checked={selection.has(c._id)} onCheckedChange={() => selection.toggle(c._id)} /></TableCell>
                    <TableCell className="font-medium"><div className="flex items-center justify-between gap-3"><span>{c.name}</span><DeleteRecordButton table="stockCategories" id={c._id} name={c.name} /></div></TableCell>
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
