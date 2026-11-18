import { mgToGramsDisplay } from "./jewelry-calc";

export const METAL_LABEL = { gold: "Gold", silver: "Silver" } as const;

type BoxLike = { boxNumber: number; label?: string; metal?: "gold" | "silver"; weightMg: number; pieces: number };

/** "Box 101 · Gold · Chains — 990.000 g, 99 pcs" for box pickers. */
export function boxOptionLabel(box: BoxLike) {
  const parts = [`Box ${box.boxNumber}`, box.metal ? METAL_LABEL[box.metal] : null, box.label].filter(Boolean);
  return `${parts.join(" · ")} — ${mgToGramsDisplay(box.weightMg)} g, ${box.pieces} pcs`;
}
