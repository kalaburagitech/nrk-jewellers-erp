import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Company types. Both Daily Sales and GST companies keep physical pieces in
 * boxes (each company has its own, separate boxes). GST companies also keep
 * item-wise stock (productStock) for stock that isn't in a box yet; their GST
 * stock = item stock + the pieces in their boxes (see gstStockByProduct).
 */
export function isGstCompanyType(companyType: Doc<"organizations">["companyType"]) {
  return companyType === "gst_gold" || companyType === "gst_silver";
}

export async function isGstCompany(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const company = await ctx.db.get(organizationId);
  return isGstCompanyType(company?.companyType);
}

/**
 * GST stock per item: loose item stock (productStock) plus every in-stock
 * piece in the company's boxes. Weight is gross weight, like item stock.
 */
export async function gstStockByProduct(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const [rows, pieces] = await Promise.all([
    ctx.db.query("productStock").withIndex("by_org", (q) => q.eq("organizationId", organizationId)).collect(),
    ctx.db.query("boxItems").withIndex("by_org", (q) => q.eq("organizationId", organizationId)).collect(),
  ]);
  const stock = new Map<Id<"products">, { weightMg: number; pieces: number; looseWeightMg: number; loosePieces: number; boxPieces: number }>();
  const get = (id: Id<"products">) => {
    let s = stock.get(id);
    if (!s) {
      s = { weightMg: 0, pieces: 0, looseWeightMg: 0, loosePieces: 0, boxPieces: 0 };
      stock.set(id, s);
    }
    return s;
  };
  for (const r of rows) {
    const s = get(r.productId);
    s.weightMg += r.weightMg;
    s.pieces += r.pieces;
    s.looseWeightMg += r.weightMg;
    s.loosePieces += r.pieces;
  }
  for (const b of pieces) {
    if (b.deletedAt || b.status !== "in_stock") continue;
    const s = get(b.productId);
    s.weightMg += b.grossWeightMg;
    s.pieces += 1;
    s.boxPieces += 1;
  }
  return stock;
}

export async function getItemStock(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">, productId: Id<"products">) {
  return await ctx.db
    .query("productStock")
    .withIndex("by_org_and_product", (q) => q.eq("organizationId", organizationId).eq("productId", productId))
    .first();
}

/**
 * Changes an item's GST stock balance by (weightDeltaMg, piecesDelta) and logs
 * a stock movement. Refuses to go below zero, so stock can't be oversold.
 */
export async function changeItemStock(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    productId: Id<"products">;
    weightDeltaMg: number;
    piecesDelta: number;
    sourceTable: string;
    sourceId: string;
    at: number;
    /** Settings → "Stop Sale on Negative Stock" turned off lets a sale take stock below zero. */
    allowNegative?: boolean;
  },
) {
  if (!Number.isSafeInteger(args.weightDeltaMg) || !Number.isSafeInteger(args.piecesDelta)) throw new Error("Stock change must be whole milligrams and pieces");
  if (args.weightDeltaMg === 0 && args.piecesDelta === 0) return;
  const product = await ctx.db.get(args.productId);
  if (!product || product.deletedAt || product.organizationId !== args.organizationId) throw new Error("Item not found");
  const row = await getItemStock(ctx, args.organizationId, args.productId);
  const weightMg = (row?.weightMg ?? 0) + args.weightDeltaMg;
  const pieces = (row?.pieces ?? 0) + args.piecesDelta;
  if ((weightMg < 0 || pieces < 0) && !args.allowNegative) {
    const haveG = ((row?.weightMg ?? 0) / 1000).toFixed(3);
    throw new Error(`Not enough GST stock for "${product.name}": available ${haveG}g, ${row?.pieces ?? 0} pcs. Add stock under Stock → GST first.`);
  }
  if (row) await ctx.db.patch(row._id, { weightMg, pieces, updatedAt: args.at });
  else await ctx.db.insert("productStock", { organizationId: args.organizationId, productId: args.productId, weightMg, pieces, updatedAt: args.at });
  await ctx.db.insert("stockMovements", {
    organizationId: args.organizationId,
    productId: args.productId,
    direction: args.weightDeltaMg > 0 || (args.weightDeltaMg === 0 && args.piecesDelta > 0) ? "in" : "out",
    netWeightMg: Math.abs(args.weightDeltaMg),
    quantity: Math.abs(args.piecesDelta),
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
    createdAt: args.at,
  });
}
