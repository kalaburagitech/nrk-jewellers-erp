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
 * Changes an item's GST stock balance by gross, stone, and net weight deltas + pieces
 * and logs a stock movement. Each stock balance is reduced / increased using its
 * corresponding weight independently. Refuses to go below zero, preventing overselling.
 */
export async function changeItemStock(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    productId: Id<"products">;
    grossWeightDeltaMg?: number;
    stoneWeightDeltaMg?: number;
    netWeightDeltaMg?: number;
    weightDeltaMg?: number; // legacy fallback
    piecesDelta: number;
    sourceTable: string;
    sourceId: string;
    at: number;
  },
) {
  const grossDelta = args.grossWeightDeltaMg ?? args.weightDeltaMg ?? 0;
  const stoneDelta = args.stoneWeightDeltaMg ?? 0;
  const netDelta = args.netWeightDeltaMg ?? (args.weightDeltaMg ?? (grossDelta - stoneDelta));
  const piecesDelta = args.piecesDelta;

  if (
    !Number.isSafeInteger(grossDelta) ||
    !Number.isSafeInteger(stoneDelta) ||
    !Number.isSafeInteger(netDelta) ||
    !Number.isSafeInteger(piecesDelta)
  ) {
    throw new Error("Stock change must be whole milligrams and pieces");
  }
  if (grossDelta === 0 && stoneDelta === 0 && netDelta === 0 && piecesDelta === 0) return;

  const product = await ctx.db.get(args.productId);
  if (!product || product.deletedAt || product.organizationId !== args.organizationId) {
    throw new Error("Item not found");
  }

  const row = await getItemStock(ctx, args.organizationId, args.productId);
  const currentGross = row?.grossWeightMg ?? row?.weightMg ?? 0;
  const currentStone = row?.stoneWeightMg ?? 0;
  const currentNet = row?.netWeightMg ?? row?.weightMg ?? 0;
  const currentPieces = row?.pieces ?? 0;

  const nextGross = currentGross + grossDelta;
  const nextStone = currentStone + stoneDelta;
  const nextNet = currentNet + netDelta;
  const nextPieces = currentPieces + piecesDelta;

  if (nextGross < 0) {
    const haveGrossG = (currentGross / 1000).toFixed(3);
    throw new Error(
      `Not enough Gross Stock for "${product.name}": available ${haveGrossG}g. Add stock under Stock → GST first.`
    );
  }
  if (nextNet < 0) {
    const haveNetG = (currentNet / 1000).toFixed(3);
    throw new Error(
      `Not enough Net Stock for "${product.name}": available ${haveNetG}g. Add stock under Stock → GST first.`
    );
  }
  if (nextStone < 0) {
    const haveStoneG = (currentStone / 1000).toFixed(3);
    throw new Error(
      `Not enough Stone Stock for "${product.name}": available ${haveStoneG}g.`
    );
  }
  if (nextPieces < 0) {
    throw new Error(
      `Not enough pieces for "${product.name}": available ${currentPieces} pcs.`
    );
  }

  if (row) {
    await ctx.db.patch(row._id, {
      grossWeightMg: nextGross,
      stoneWeightMg: nextStone,
      netWeightMg: nextNet,
      weightMg: nextNet,
      pieces: nextPieces,
      updatedAt: args.at,
    });
  } else {
    await ctx.db.insert("productStock", {
      organizationId: args.organizationId,
      productId: args.productId,
      grossWeightMg: nextGross,
      stoneWeightMg: nextStone,
      netWeightMg: nextNet,
      weightMg: nextNet,
      pieces: nextPieces,
      updatedAt: args.at,
    });
  }

  const isPositiveMovement =
    grossDelta > 0 || netDelta > 0 || (grossDelta === 0 && netDelta === 0 && piecesDelta > 0);

  await ctx.db.insert("stockMovements", {
    organizationId: args.organizationId,
    productId: args.productId,
    direction: isPositiveMovement ? "in" : "out",
    grossWeightMg: Math.abs(grossDelta),
    stoneWeightMg: Math.abs(stoneDelta),
    netWeightMg: Math.abs(netDelta),
    quantity: Math.abs(piecesDelta),
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
    createdAt: args.at,
  });
}
