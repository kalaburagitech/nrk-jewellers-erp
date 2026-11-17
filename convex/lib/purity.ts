import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { KARAT_FINENESS_BP } from "../../src/lib/jewelry-calc";

/**
 * Finds the company's gold purity row for a karat ("22K"), creating it with
 * the standard hallmark fineness if the company hasn't configured it yet. The
 * item keeps pointing at metalPurities, so metal rates, stock-by-purity
 * reports and invoices keep working unchanged.
 */
export async function resolveKaratPurity(ctx: MutationCtx, organizationId: Id<"organizations">, karat: string): Promise<Id<"metalPurities">> {
  const fineness = KARAT_FINENESS_BP[karat];
  if (!fineness) throw new Error(`Unknown purity "${karat}"`);
  const rows = await ctx.db
    .query("metalPurities")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();
  const wanted = karat.toLowerCase();
  const match = rows.find((row) => row.metal === "gold" && row.label.trim().toLowerCase().replace(/\s+/g, "") === wanted);
  if (match) return match._id;
  return await ctx.db.insert("metalPurities", {
    organizationId,
    metal: "gold",
    label: karat,
    purityBasisPoints: fineness,
    isActive: true,
  });
}
