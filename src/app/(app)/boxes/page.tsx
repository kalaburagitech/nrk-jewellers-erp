"use client";

import { DeleteRecordButton } from "@/components/delete-record-button";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Package, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Id } from "../../../../convex/_generated/dataModel";

function BoxDetailDialog({ boxId, onClose }: { boxId: Id<"boxes">; onClose: () => void }) {
  const items = useQuery(api.boxes.getItems, { boxId });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Box contents</DialogTitle>
        </DialogHeader>
        {items === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Package className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This box is empty. Items are placed into boxes during purchase inward (Milestone 3).
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item._id} className="rounded-md border border-border p-3 text-sm">
                {item.label} — {(item.netWeightMg / 1000).toFixed(3)}g net
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function BoxOverviewPage() {
  const boxes = useQuery(api.boxes.list);
  const createNext = useMutation(api.boxes.createNext);
  const [search, setSearch] = useState("");
  const [selectedBox, setSelectedBox] = useState<Id<"boxes"> | null>(null);
  const [boxNumber, setBoxNumber] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    if (!boxes) return undefined;
    const q = search.trim();
    if (!q) return boxes;
    return boxes.filter((b) => String(b.boxNumber).includes(q) || b.label?.toLowerCase().includes(q.toLowerCase()));
  }, [boxes, search]);

  async function handleCreate() {
    setCreating(true);
    try {
      setError("");
      if (!boxNumber.trim()) throw new Error("Enter a box number");
      await createNext({ boxNumber: Number(boxNumber), label });
      setBoxNumber(""); setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create box");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Box Overview</h1>
          <p className="text-sm text-muted-foreground">{boxes?.length ?? 0} boxes</p>
        </div>
        <div className="flex flex-wrap gap-2"><Input aria-label="Box number" type="number" min="1" step="1" value={boxNumber} onChange={e => setBoxNumber(e.target.value)} placeholder="Box no." className="w-28" /><Input aria-label="Box label" value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)" className="w-44" /><Button onClick={handleCreate} disabled={creating}>
          <Plus className="h-4 w-4" />
          {creating ? "Creating…" : "Create Box"}
        </Button></div>
      </div>

      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by box number or label"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No boxes match your search.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map((box) => (
            <Card
              key={box._id}
              className="cursor-pointer gap-1 py-4 text-center transition-colors hover:border-gold"
              onClick={() => setSelectedBox(box._id)}
            >
              <CardContent className="flex flex-col items-center gap-1 px-2">
                <DeleteRecordButton table="boxes" id={box._id} name={`Box ${box.boxNumber}`} />
                <Package className="h-5 w-5 text-gold" />
                <p className="text-lg font-semibold">{box.boxNumber}</p>
                {box.label && <p className="truncate text-xs text-muted-foreground">{box.label}</p>}
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {box.itemCount ? `${box.itemCount} item${box.itemCount === 1 ? "" : "s"}` : "Empty"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedBox && <BoxDetailDialog boxId={selectedBox} onClose={() => setSelectedBox(null)} />}
    </div>
  );
}
