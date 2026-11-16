import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuthContext, requireRole } from "./lib/auth";

/** Audit Trail (Owner/Admin): who created, edited, cancelled or deleted what, newest first. */
export const list = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    requireRole(auth, ["admin"]);
    // ponytail: reads up to 2000 newest log rows then filters by date; add a by_org_and_time index if logs grow past that.
    const logs = await ctx.db.query("auditLogs").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).order("desc").take(2000);
    const inRange = logs.filter((l) => !l.deletedAt && l.createdAt >= args.startDate && l.createdAt <= args.endDate);
    const names = new Map<string, string>();
    for (const l of inRange) {
      if (names.has(String(l.userId))) continue;
      const user = await ctx.db.get(l.userId);
      names.set(String(l.userId), user?.name ?? user?.email ?? "Unknown");
    }
    return inRange.map((l) => {
      const meta = (l.metadata ?? {}) as Record<string, unknown>;
      const detail = [meta.invoiceNumber, meta.reason, meta.label, meta.name].filter((x) => typeof x === "string" && x).join(" · ");
      return { id: String(l._id), date: l.createdAt, user: names.get(String(l.userId)) ?? "Unknown", action: l.action, entity: l.entityTable, detail };
    });
  },
});
