import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function resolveBranchId(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  preferred?: Id<"branches">,
) {
  if (preferred) return preferred;
  const branch = await ctx.db
    .query("branches")
    .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
    .first();
  if (!branch) throw new Error("No branch configured for this organization");
  return branch._id;
}

/** Atomically allocates the next sequential number for a document type — never derived by counting existing rows, which would race under concurrent billing. */
export async function allocateInvoiceNumber(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  branchId: Id<"branches">,
  documentType: string,
  prefix: string,
) {
  const existing = await ctx.db
    .query("invoiceSequences")
    .withIndex("by_org_branch_type", (q) =>
      q.eq("organizationId", organizationId).eq("branchId", branchId).eq("documentType", documentType),
    )
    .first();

  const nextNumber = existing?.nextNumber ?? 1;
  if (existing) {
    await ctx.db.patch(existing._id, { nextNumber: nextNumber + 1 });
  } else {
    await ctx.db.insert("invoiceSequences", {
      organizationId,
      branchId,
      documentType,
      prefix,
      nextNumber: nextNumber + 1,
    });
  }
  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
}
