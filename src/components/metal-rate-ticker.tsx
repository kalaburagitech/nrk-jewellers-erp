import { Radio } from "lucide-react";
import { formatPaise } from "@/lib/money";
import type { Doc } from "../../convex/_generated/dataModel";

/** Live gold/silver rate strip — shown on both the dashboard and the billing screen so staff always see the same numbers they're billing against. */
export function MetalRateTicker({
  currentRates,
}: {
  currentRates: { purity: Doc<"metalPurities">; latest: Doc<"metalRates"> | null }[] | undefined;
}) {
  if (!currentRates || currentRates.length === 0) return null;
  const withRates = currentRates.filter((r) => r.latest);
  if (withRates.length === 0) return null;
  const latestEffectiveAt = Math.max(...withRates.map((r) => r.latest!.effectiveAt));

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm">
      <span className="flex items-center gap-1 font-medium text-success">
        <Radio className="h-3.5 w-3.5" />
        LIVE
      </span>
      {withRates.map(({ purity, latest }) => (
        <span key={purity._id}>
          <span className="text-muted-foreground">
            {purity.label} {purity.metal === "gold" ? "Gold" : "Silver"}:
          </span>{" "}
          <span className="font-semibold">{formatPaise(latest!.ratePerGramPaise)}/g</span>
        </span>
      ))}
      <span className="ml-auto text-xs text-muted-foreground">
        as of {new Date(latestEffectiveAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}
