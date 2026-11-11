import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function assertBookingYearOpen(ctx: MutationCtx, organizationId: Id<"organizations">, timestamp: number) {
  const years = await ctx.db.query("accountingYears").withIndex("by_org", (q) => q.eq("organizationId", organizationId)).collect();
  const year = years.find((record) => timestamp >= record.startsAt && timestamp <= record.endsAt);
  if (year?.status === "closed") throw new Error(`Booking year ${year.name} is closed. Ask the owner to reopen it to make changes.`);
}
