"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import QRCode from "qrcode";
import { Printer, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mgToGramsDisplay } from "@/lib/jewelry-calc";
import type { Doc } from "../../../../../convex/_generated/dataModel";

function Label({ item, boxNumber }: { item: Doc<"boxItems">; boxNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, `NRK:${item._id}`, { width: 72, margin: 0 });
  }, [item._id]);

  return (
    <div
      className="flex items-center gap-2 border border-dashed border-border bg-card p-2 print:border-gray-400 print:bg-white"
      style={{ width: "72mm" }}
    >
      <canvas ref={canvasRef} className="h-[18mm] w-[18mm] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold tracking-wide print:text-black">NRK JEWELLERS</p>
        <p className="truncate text-xs font-medium print:text-black">{item.label}</p>
        <p className="text-[10px] text-muted-foreground print:text-gray-600">
          Box {boxNumber} · {mgToGramsDisplay(item.netWeightMg)}g
        </p>
      </div>
    </div>
  );
}

export default function BarcodeLabelsPage() {
  const boxes = useQuery(api.boxes.list);
  const [boxNumberInput, setBoxNumberInput] = useState("");

  const sourceBox = useMemo(
    () => boxes?.find((b) => String(b.boxNumber) === boxNumberInput.trim()),
    [boxes, boxNumberInput],
  );
  const items = useQuery(api.boxes.getItems, sourceBox ? { boxId: sourceBox._id } : "skip");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Barcode Labels</h1>
          <p className="text-sm text-muted-foreground">Print NRK-branded QR labels for every item in a box.</p>
        </div>
        {sourceBox && items && items.length > 0 && (
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        )}
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Find box</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-xs">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Enter box number"
              value={boxNumberInput}
              onChange={(e) => setBoxNumberInput(e.target.value)}
            />
          </div>
          {boxNumberInput && !sourceBox && <p className="mt-3 text-sm text-muted-foreground">No box with that number.</p>}
          {sourceBox && items && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Tag className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Box {sourceBox.boxNumber} is empty.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {sourceBox && items && items.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {items.map((item) => (
            <Label key={item._id} item={item} boxNumber={sourceBox.boxNumber} />
          ))}
        </div>
      )}
    </div>
  );
}
