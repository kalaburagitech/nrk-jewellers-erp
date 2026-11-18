import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { KARAT_FINENESS_BP, type PurityKarat } from "../../src/lib/jewelry-calc";

/**
 * The gold purity row for a standard karat ("22K"…), created on first use, so
 * metal rates, reports and invoices keep working through metalPurityId.
 */
export async function resolveKaratPurity(ctx: MutationCtx, organizationId: Id<"organizations">, karat: PurityKarat) {
  const key = karat.toLowerCase();
  const purities = await ctx.db.query("metalPurities").withIndex("by_org", (q) => q.eq("organizationId", organizationId)).collect();
  const existing = purities.find((p) => !p.deletedAt && p.metal === "gold" && p.label.replace(/\s+/g, "").toLowerCase() === key);
  if (existing) return existing._id;
  return await ctx.db.insert("metalPurities", { organizationId, metal: "gold", label: karat, purityBasisPoints: KARAT_FINENESS_BP[karat], isActive: true });
}
