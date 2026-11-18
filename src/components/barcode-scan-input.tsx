"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { ScanBarcode } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Input } from "@/components/ui/input";

type ScannedBox = Doc<"boxes"> & { weightMg: number; pieces: number };

/**
 * Scan box for barcode/QR scanners (they type the code and press Enter).
 * A box label adds a bill line for that box; shows why if it can't.
 */
export function BarcodeScanInput({ onBox }: { onBox: (box: ScannedBox) => void }) {
  const convex = useConvex();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function lookup() {
    const scanned = code.trim();
    if (!scanned) return;
    setCode("");
    const r = await convex.query(api.boxes.lookupScannedItem, { code: scanned });
    if ("error" in r) return setMessage({ ok: false, text: r.error ?? "Not found" });
    onBox(r.box);
    setMessage({ ok: true, text: `Added a line for Box ${r.box.boxNumber} (${(r.box.weightMg / 1000).toFixed(3)} g available) — enter its weight.` });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative max-w-xs">
        <ScanBarcode className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Scan box barcode / QR label"
          aria-label="Scan barcode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup();
            }
          }}
        />
      </div>
      {message && <p className={`text-xs ${message.ok ? "text-emerald-600" : "text-destructive"}`}>{message.text}</p>}
    </div>
  );
}
