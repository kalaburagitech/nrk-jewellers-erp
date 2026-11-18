import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Metal = "gold" | "silver";
export type BoxBalance = { weightMg: number; pieces: number };

export const METAL_LABEL: Record<Metal, string> = { gold: "Gold", silver: "Silver" };

/**
 * A box's current stock: gross weight + pieces. Boxes made before box stock
 * became a running balance kept it as separate pieces (boxItems) — until the
 * first stock change saves a balance on the box, that is the sum of its
 * in-stock pieces.
 */
export async function readBoxBalance(ctx: QueryCtx | MutationCtx, box: Doc<"boxes">): Promise<BoxBalance> {
  if (box.weightMg !== undefined) return { weightMg: box.weightMg, pieces: box.pieces ?? 0 };
  const items = await ctx.db
    .query("boxItems")
    .withIndex("by_box", (q) => q.eq("boxId", box._id))
    .filter((q) => q.and(q.eq(q.field("status"), "in_stock"), q.eq(q.field("deletedAt"), undefined)))
    .collect();
  return { weightMg: items.reduce((sum, item) => sum + item.grossWeightMg, 0), pieces: items.length };
}

export function boxName(box: Pick<Doc<"boxes">, "boxNumber" | "label">) {
  return `Box ${box.boxNumber}${box.label ? ` (${box.label})` : ""}`;
}

/** Gold goes only into gold boxes and silver only into silver boxes. A box with no metal set accepts either. */
export function assertBoxMetal(box: Doc<"boxes">, metal: Metal | undefined) {
  if (box.metal && metal && box.metal !== metal) {
    throw new Error(`${boxName(box)} holds ${METAL_LABEL[box.metal]}. Choose a ${METAL_LABEL[metal]} box for ${METAL_LABEL[metal]} items.`);
  }
}

/** Loads a box and checks it belongs to the company (and is active, unless `allowInactive`). */
export async function getCompanyBox(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">, boxId: Id<"boxes">, allowInactive = false) {
  const box = await ctx.db.get(boxId);
  if (!box || box.deletedAt || box.organizationId !== organizationId) throw new Error("Box not found in this company.");
  if (!box.isActive && !allowInactive) throw new Error(`${boxName(box)} is inactive. Activate it in Box Overview first.`);
  return box;
}

/**
 * Changes a box's stock by (weightDeltaMg, piecesDelta) and logs it in the
 * stock journal. Refuses to go below zero unless `allowNegative` — so stock
 * can't be oversold and a reversal can't remove grams that already left.
 */
export async function changeBoxStock(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    boxId: Id<"boxes">;
    weightDeltaMg: number;
    piecesDelta: number;
    productId?: Id<"products">;
    sourceTable: string;
    sourceId: string;
    at: number;
    note?: string;
    /** Settings → "Stop Sale on Negative Stock" turned off lets a sale take a box below zero. */
    allowNegative?: boolean;
  },
) {
  if (!Number.isSafeInteger(args.weightDeltaMg) || !Number.isSafeInteger(args.piecesDelta)) throw new Error("Stock change must be whole milligrams and pieces");
  const box = await getCompanyBox(ctx, args.organizationId, args.boxId, true);
  if (args.weightDeltaMg === 0 && args.piecesDelta === 0) return box;
  const current = await readBoxBalance(ctx, box);
  const weightMg = current.weightMg + args.weightDeltaMg;
  const pieces = current.pieces + args.piecesDelta;
  // Only a removal can be refused: adding stock never makes a short box worse.
  if (((weightMg < 0 && args.weightDeltaMg < 0) || (pieces < 0 && args.piecesDelta < 0)) && !args.allowNegative) {
    const need = weightMg < 0 && args.weightDeltaMg < 0 ? `${(-args.weightDeltaMg / 1000).toFixed(3)} g` : `${-args.piecesDelta} pcs`;
    throw new Error(`Not enough stock in ${boxName(box)}: it has ${(current.weightMg / 1000).toFixed(3)} g, ${current.pieces} pcs — cannot take out ${need}.`);
  }
  await ctx.db.patch(box._id, { weightMg, pieces, itemCount: pieces });
  // One journal row per direction: weight and pieces can move opposite ways in one adjustment.
  const base = {
    organizationId: args.organizationId,
    productId: args.productId,
    boxId: box._id,
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
    note: args.note?.trim() || undefined,
    createdAt: args.at,
  };
  const weightDir = Math.sign(args.weightDeltaMg);
  const piecesDir = Math.sign(args.piecesDelta);
  if (weightDir && piecesDir && weightDir !== piecesDir) {
    await ctx.db.insert("stockMovements", { ...base, direction: weightDir > 0 ? "in" : "out", netWeightMg: Math.abs(args.weightDeltaMg), quantity: 0 });
    await ctx.db.insert("stockMovements", { ...base, direction: piecesDir > 0 ? "in" : "out", netWeightMg: 0, quantity: Math.abs(args.piecesDelta) });
  } else {
    await ctx.db.insert("stockMovements", {
      ...base,
      direction: (weightDir || piecesDir) > 0 ? "in" : "out",
      netWeightMg: Math.abs(args.weightDeltaMg),
      quantity: Math.abs(args.piecesDelta),
    });
  }
  return box;
}

/** Every live box of a company with its current balance. */
export async function listBoxBalances(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const boxes = await ctx.db
    .query("boxes")
    .withIndex("by_org_and_number", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();
  return await Promise.all(boxes.map(async (box) => ({ box, ...(await readBoxBalance(ctx, box)) })));
}

/**
 * Item-wise view of box stock (a box can hold many designs): weight and
 * pieces each item brought into boxes minus what left, from the stock
 * journal. Box-level corrections not tied to an item aren't counted.
 */
export async function boxStockByProduct(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const movements = await ctx.db
    .query("stockMovements")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.and(q.eq(q.field("deletedAt"), undefined), q.neq(q.field("boxId"), undefined), q.neq(q.field("productId"), undefined)))
    .collect();
  const stock = new Map<string, BoxBalance>();
  for (const m of movements) {
    const row = stock.get(String(m.productId)) ?? { weightMg: 0, pieces: 0 };
    const sign = m.direction === "in" ? 1 : -1;
    row.weightMg += sign * m.netWeightMg;
    row.pieces += sign * m.quantity;
    stock.set(String(m.productId), row);
  }
  return stock;
}
