import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** GST companies keep item-wise stock; Daily Sales companies keep stock in boxes. */
export function isGstCompanyType(companyType: Doc<"organizations">["companyType"]) {
  return companyType === "gst_gold" || companyType === "gst_silver";
}

export async function isGstCompany(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const company = await ctx.db.get(organizationId);
  return isGstCompanyType(company?.companyType);
}

/** Throws if this company is a GST company — boxes are only for Daily Sales. */
export async function assertBoxCompany(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  if (await isGstCompany(ctx, organizationId)) {
    throw new Error("Boxes are only used in the Daily Sales company. In a GST company, manage stock under Stock → GST.");
  }
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
