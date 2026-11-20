import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAuthContext, requireRole, type AuthContext } from "./lib/auth";

const kindValidator = v.union(v.literal("sale"), v.literal("purchase"));
type Kind = "sale" | "purchase";

const kindOf = (held: Doc<"heldBills">): Kind => held.kind ?? "sale";

/** Holding a sale needs billing access; holding a purchase needs purchase access. */
function requireHoldRole(auth: AuthContext, kind: Kind) {
  requireRole(auth, [kind === "purchase" ? "purchase_manager" : "billing_operator"]);
}

/** Bills put on hold from New Bill (sale) or New Purchase (purchase), newest first. */
export const list = query({
  args: { kind: v.optional(kindValidator) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const kind = args.kind ?? "sale";
    const held = await ctx.db
      .query("heldBills")
      .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
      .order("desc")
      .collect();
    // The saved form is only needed when a bill is reopened, so the list leaves it out.
    return held
      .filter((h) => kindOf(h) === kind)
      .map((h) => ({
        _id: h._id,
        customerName: h.customerName,
        itemCount: h.itemCount,
        totalPaise: h.totalPaise,
        createdByUserId: h.createdByUserId,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      }));
  },
});

/** One held bill with its saved form, to reopen it. Null once it has been saved or deleted. */
export const get = query({
  args: { heldBillId: v.id("heldBills"), kind: v.optional(kindValidator) },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const held = await ctx.db.get(args.heldBillId);
    if (!held || held.organizationId !== auth.organizationId) return null;
    if (kindOf(held) !== (args.kind ?? "sale")) return null;
    return held;
  },
});

/** Parks the bill being written. Pass heldBillId to re-hold a bill that was reopened. */
export const hold = mutation({
  args: {
    heldBillId: v.optional(v.id("heldBills")),
    kind: v.optional(kindValidator),
    customerName: v.string(),
    itemCount: v.number(),
    totalPaise: v.number(),
    draft: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const kind = args.kind ?? "sale";
    requireHoldRole(auth, kind);
    if (args.draft.length > 500_000) throw new ConvexError("This bill is too large to hold.");
    const now = Date.now();
    const fields = {
      customerName: args.customerName.trim().slice(0, 120) || (kind === "purchase" ? "Supplier" : "Walk-in customer"),
      itemCount: args.itemCount,
      totalPaise: args.totalPaise,
      draft: args.draft,
      updatedAt: now,
    };
    if (args.heldBillId) {
      const existing = await ctx.db.get(args.heldBillId);
      if (existing && existing.organizationId === auth.organizationId && kindOf(existing) === kind) {
        await ctx.db.patch(existing._id, fields);
        return existing._id;
      }
    }
    return await ctx.db.insert("heldBills", {
      ...fields,
      kind,
      organizationId: auth.organizationId,
      createdByUserId: auth.userId,
      createdAt: now,
    });
  },
});

/** Deletes a held bill (the customer or supplier left). */
export const remove = mutation({
  args: { heldBillId: v.id("heldBills") },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const held = await ctx.db.get(args.heldBillId);
    if (!held || held.organizationId !== auth.organizationId) return;
    requireHoldRole(auth, kindOf(held));
    await ctx.db.delete(held._id);
  },
});
