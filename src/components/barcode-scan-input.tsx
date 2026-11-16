"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { ScanBarcode } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Input } from "@/components/ui/input";

/**
 * Scan box for barcode/QR scanners (they type the code and press Enter).
 * Looks the piece up and hands it to the bill; shows why if it can't be added.
 */
export function BarcodeScanInput({ onItem, alreadyAddedIds }: { onItem: (item: Doc<"boxItems">) => void; alreadyAddedIds: Set<string> }) {
  const convex = useConvex();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function lookup() {
    const scanned = code.trim();
    if (!scanned) return;
    setCode("");
    const r = await convex.query(api.boxes.lookupScannedItem, { code: scanned });
    if ("error" in r) return setMessage({ ok: false, text: r.error ?? "Not found" });
    if (alreadyAddedIds.has(r.item._id)) return setMessage({ ok: false, text: `"${r.item.label}" is already on this bill.` });
    onItem(r.item);
    setMessage({ ok: true, text: `Added "${r.item.label}" (${(r.item.netWeightMg / 1000).toFixed(3)} g).` });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative max-w-xs">
        <ScanBarcode className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Scan barcode / QR label"
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
