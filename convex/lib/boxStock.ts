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

/** Live items inside a box (one row per item). */
export async function listBoxEntries(ctx: QueryCtx | MutationCtx, boxId: Id<"boxes">) {
  return await ctx.db
    .query("boxEntries")
    .withIndex("by_box", (q) => q.eq("boxId", boxId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();
}

/** The item's row inside a box, if the box holds that item. */
export async function findBoxEntry(ctx: QueryCtx | MutationCtx, boxId: Id<"boxes">, productId: Id<"products">) {
  return await ctx.db
    .query("boxEntries")
    .withIndex("by_box_and_product", (q) => q.eq("boxId", boxId).eq("productId", productId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first();
}

export type BoxEntryDetails = Partial<
  Pick<
    Doc<"boxEntries">,
    | "hsnCode"
    | "metalPurityId"
    | "description"
    | "stockGroupId"
    | "wastageBasisPoints"
    | "makingChargeMode"
    | "makingChargeValue"
    | "salePricePaise"
    | "purchasePricePaise"
    | "saleDiscountMode"
    | "saleDiscountValue"
    | "taxConfigurationId"
  >
>;

/** Details a new item-in-box row starts with: what the item itself already knows. */
export function entryDefaultsFromProduct(product: Doc<"products">): BoxEntryDetails {
  return {
    hsnCode: product.hsnCode,
    metalPurityId: product.metalPurityId,
    description: product.description,
    stockGroupId: product.stockGroupId,
    wastageBasisPoints: product.wastageBasisPoints,
    makingChargeMode: product.makingChargePaise ? "fixed" : undefined,
    makingChargeValue: product.makingChargePaise,
    salePricePaise: product.salePricePaise,
    purchasePricePaise: product.purchasePricePaise,
    saleDiscountMode: product.saleDiscountMode,
    saleDiscountValue: product.saleDiscountValue,
    taxConfigurationId: product.taxConfigurationId,
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The item's row in the box, created (empty, with the item's own details
 * overlaid by any `details` given) when the box doesn't hold the item yet.
 */
export async function ensureBoxEntry(
  ctx: MutationCtx,
  args: { organizationId: Id<"organizations">; boxId: Id<"boxes">; productId: Id<"products">; details?: BoxEntryDetails },
) {
  const existing = await findBoxEntry(ctx, args.boxId, args.productId);
  if (existing) return existing;
  const product = await ctx.db.get(args.productId);
  if (!product || product.deletedAt || product.organizationId !== args.organizationId) throw new Error("Item not found");
  const id = await ctx.db.insert("boxEntries", {
    ...definedOnly(entryDefaultsFromProduct(product)),
    ...definedOnly(args.details ?? {}),
    organizationId: args.organizationId,
    boxId: args.boxId,
    productId: args.productId,
    weightMg: 0,
    netWeightMg: 0,
    pieces: 0,
    createdAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

/**
 * Changes a box's stock by (weightDeltaMg, piecesDelta) and logs it in the
 * stock journal. Refuses to go below zero unless `allowNegative` — so stock
 * can't be oversold and a reversal can't remove grams that already left.
 *
 * With `boxEntryId` the change is to one item inside the box: that row's
 * gross weight, net weight and pieces change too (net by `netDeltaMg`, or
 * in proportion to the gross change when not given). Without it, the change
 * is to the box's older stock that isn't assigned to any item.
 */
export async function changeBoxStock(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    boxId: Id<"boxes">;
    weightDeltaMg: number;
    piecesDelta: number;
    netDeltaMg?: number;
    boxEntryId?: Id<"boxEntries">;
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
  if (args.netDeltaMg !== undefined && !Number.isSafeInteger(args.netDeltaMg)) throw new Error("Net weight change must be whole milligrams");
  const box = await getCompanyBox(ctx, args.organizationId, args.boxId, true);
  if (args.weightDeltaMg === 0 && args.piecesDelta === 0 && !args.netDeltaMg) return box;
  const current = await readBoxBalance(ctx, box);
  const weightMg = current.weightMg + args.weightDeltaMg;
  const pieces = current.pieces + args.piecesDelta;
  // Only a removal can be refused: adding stock never makes a short box worse.
  if (((weightMg < 0 && args.weightDeltaMg < 0) || (pieces < 0 && args.piecesDelta < 0)) && !args.allowNegative) {
    const need = weightMg < 0 && args.weightDeltaMg < 0 ? `${(-args.weightDeltaMg / 1000).toFixed(3)} g` : `${-args.piecesDelta} pcs`;
    throw new Error(`Not enough stock in ${boxName(box)}: it has ${(current.weightMg / 1000).toFixed(3)} g, ${current.pieces} pcs — cannot take out ${need}.`);
  }

  let productId = args.productId;
  if (args.boxEntryId) {
    const entry = await ctx.db.get(args.boxEntryId);
    if (!entry || entry.deletedAt || entry.boxId !== box._id || entry.organizationId !== args.organizationId) throw new Error(`That item is not in ${boxName(box)}.`);
    productId ??= entry.productId;
    const entryWeight = entry.weightMg + args.weightDeltaMg;
    const entryPieces = entry.pieces + args.piecesDelta;
    if (((entryWeight < 0 && args.weightDeltaMg < 0) || (entryPieces < 0 && args.piecesDelta < 0)) && !args.allowNegative) {
      const name = (await ctx.db.get(entry.productId))?.name ?? "this item";
      throw new Error(`Not enough ${name} in ${boxName(box)}: it has ${(entry.weightMg / 1000).toFixed(3)} g, ${entry.pieces} pcs.`);
    }
    const netDelta = args.netDeltaMg ?? (entry.weightMg > 0 ? Math.round((args.weightDeltaMg * entry.netWeightMg) / entry.weightMg) : args.weightDeltaMg);
    // Net weight never goes below zero or above the gross weight left.
    const entryNet = Math.max(0, Math.min(entry.netWeightMg + netDelta, Math.max(entryWeight, 0)));
    await ctx.db.patch(entry._id, { weightMg: entryWeight, netWeightMg: entryNet, pieces: entryPieces });
  } else if ((args.weightDeltaMg < 0 || args.piecesDelta < 0) && !args.allowNegative) {
    // A box-level removal may only take stock that no item row accounts for.
    const entries = await listBoxEntries(ctx, box._id);
    if (entries.length > 0) {
      const freeWeight = current.weightMg - entries.reduce((sum, e) => sum + e.weightMg, 0);
      const freePieces = current.pieces - entries.reduce((sum, e) => sum + e.pieces, 0);
      if (freeWeight + args.weightDeltaMg < 0 || freePieces + args.piecesDelta < 0) {
        throw new Error(
          `${boxName(box)}: choose which item the stock comes out of — only ${(Math.max(0, freeWeight) / 1000).toFixed(3)} g, ${Math.max(0, freePieces)} pcs are not assigned to an item.`,
        );
      }
    }
  }

  await ctx.db.patch(box._id, { weightMg, pieces, itemCount: pieces });
  // One journal row per direction: weight and pieces can move opposite ways in one adjustment.
  const base = {
    organizationId: args.organizationId,
    productId,
    boxId: box._id,
    boxEntryId: args.boxEntryId,
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
    note: args.note?.trim() || undefined,
    createdAt: args.at,
  };
  const weightDir = Math.sign(args.weightDeltaMg);
  const piecesDir = Math.sign(args.piecesDelta);
  if (!weightDir && !piecesDir) return box;
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

/** The billing details of an item-in-box row (everything but its stock and ids). */
export function entryDetails(entry: Doc<"boxEntries">): BoxEntryDetails {
  return {
    hsnCode: entry.hsnCode,
    metalPurityId: entry.metalPurityId,
    description: entry.description,
    stockGroupId: entry.stockGroupId,
    wastageBasisPoints: entry.wastageBasisPoints,
    makingChargeMode: entry.makingChargeMode,
    makingChargeValue: entry.makingChargeValue,
    salePricePaise: entry.salePricePaise,
    purchasePricePaise: entry.purchasePricePaise,
    saleDiscountMode: entry.saleDiscountMode,
    saleDiscountValue: entry.saleDiscountValue,
    taxConfigurationId: entry.taxConfigurationId,
  };
}

/**
 * Where stock goes back to when a line is reversed or returned: the same
 * item row it came from, or — when it is going into another box, or that
 * row was removed — the item's row in `boxId` (created with the original
 * row's details). Lines that never used an item row stay box-level.
 */
export async function entryForStockBack(
  ctx: MutationCtx,
  args: { organizationId: Id<"organizations">; boxId: Id<"boxes">; productId: Id<"products">; boxEntryId?: Id<"boxEntries"> },
): Promise<Id<"boxEntries"> | undefined> {
  if (!args.boxEntryId) return undefined;
  const original = await ctx.db.get(args.boxEntryId);
  if (original && !original.deletedAt && original.boxId === args.boxId) return original._id;
  const entry = await ensureBoxEntry(ctx, {
    organizationId: args.organizationId,
    boxId: args.boxId,
    productId: args.productId,
    details: original ? entryDetails(original) : undefined,
  });
  return entry._id;
}

/**
 * The item row a removal should come out of: the item's row when it holds
 * enough, else the box's stock not assigned to any item (older stock) when
 * that covers it; otherwise the item's row, so the "not enough" message
 * names the item.
 */
export async function entryForRemoval(
  ctx: QueryCtx | MutationCtx,
  box: Doc<"boxes">,
  entry: Doc<"boxEntries"> | null,
  weightMg: number,
  pieces: number,
): Promise<Doc<"boxEntries"> | null> {
  if (!entry) return null;
  if (entry.weightMg >= weightMg && entry.pieces >= pieces) return entry;
  const balance = await readBoxBalance(ctx, box);
  const entries = await listBoxEntries(ctx, box._id);
  const freeWeight = balance.weightMg - entries.reduce((sum, e) => sum + e.weightMg, 0);
  const freePieces = balance.pieces - entries.reduce((sum, e) => sum + e.pieces, 0);
  return freeWeight >= weightMg && freePieces >= pieces ? null : entry;
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
