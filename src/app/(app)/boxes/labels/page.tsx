"use client";

import { useRecordSelection } from "@/hooks/use-record-selection";
import { RecordSelectionToolbar } from "@/components/record-selection-toolbar";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import QRCode from "qrcode";
import { Printer, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { METAL_LABEL } from "@/lib/box-label";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { BoxScreensGate } from "@/components/privacy-lock-gate";

/** QR label for a box: scanning it on New Bill adds a line for this box. */
function Label({ box }: { box: Doc<"boxes"> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, `NRKBOX:${box._id}`, { width: 72, margin: 0 });
  }, [box._id]);

  return (
    <div
      className="flex items-center gap-2 border border-dashed border-border bg-card p-2 print:border-gray-400 print:bg-white"
      style={{ width: "72mm" }}
    >
      <canvas ref={canvasRef} className="h-[18mm] w-[18mm] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold tracking-wide print:text-black">NRK JEWELLERS</p>
        <p className="truncate text-sm font-bold print:text-black">Box {box.boxNumber}</p>
        <p className="truncate text-[10px] text-muted-foreground print:text-gray-600">
          {[box.metal ? METAL_LABEL[box.metal] : null, box.label].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

export default function BarcodeLabelsPage() {
  const boxes = useQuery(api.boxes.list);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (boxes ?? []).filter((b) => b.isActive && (!q || String(b.boxNumber).includes(q) || b.label?.toLowerCase().includes(q)));
  }, [boxes, search]);

  const selection = useRecordSelection(filtered.map((box) => box._id), search, true);

  return (
    <BoxScreensGate>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Barcode Labels</h1>
            <p className="text-sm text-muted-foreground">Print a QR label for each box. Scan it on New Bill to add a line for that box.</p>
          </div>
          {filtered.length > 0 && (
            <Button disabled={selection.count === 0} onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print {selection.count} selected
            </Button>
          )}
        </div>

        <div className="relative max-w-xs print:hidden">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Filter by box number or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {boxes !== undefined && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center print:hidden">
            <Tag className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No boxes to label. Create boxes in Box Overview.</p>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="print:hidden">
            <RecordSelectionToolbar selection={selection} />
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {filtered.map((box) => (
            <div key={box._id} className={selection.has(box._id) ? "" : "opacity-60 print:hidden"}>
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm print:hidden">
                <Checkbox aria-label={`Select label for Box ${box.boxNumber}`} checked={selection.has(box._id)} onCheckedChange={() => selection.toggle(box._id)} />
                Include label
              </label>
              <Label box={box} />
            </div>
          ))}
        </div>
      </div>
    </BoxScreensGate>
  );
}
