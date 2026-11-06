import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";

/** Lightweight combined search across customers, products and sales invoices — bounded reads, client-filtered, matching the pattern used by every other search box in this app. */
export const globalSearch = query({
  args: { term: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const term = args.term.trim().toLowerCase();
    if (term.length < 2) return { customers: [], products: [], sales: [] };

    const [customers, products, sales] = await Promise.all([
      ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .take(500),
      ctx.db
        .query("products")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .take(500),
      ctx.db
        .query("sales")
        .withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId))
        .order("desc")
        .take(500),
    ]);

    return {
      customers: customers
        .filter((c) => c.name.toLowerCase().includes(term) || c.phone?.toLowerCase().includes(term))
        .slice(0, 5)
        .map((c) => ({ id: c._id, label: c.name, sublabel: c.phone })),
      products: products
        .filter((p) => p.name.toLowerCase().includes(term) || p.sku?.toLowerCase().includes(term))
        .slice(0, 5)
        .map((p) => ({ id: p._id, label: p.name, sublabel: p.sku })),
      sales: sales
        .filter((s) => s.invoiceNumber.toLowerCase().includes(term))
        .slice(0, 5)
        .map((s) => ({ id: s._id, label: s.invoiceNumber, sublabel: undefined })),
    };
  },
});
