import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";
import { isGstCompanyType } from "./lib/itemStock";
import { boxStockByProduct } from "./lib/boxStock";

/**
 * Item-wise stock for the active company: each item's box stock (from the
 * stock journal) plus, in GST companies, loose item stock (productStock). Value = purchase
 * price × stock (per gram for gram/kg items, per piece otherwise).
 */
export const itemStock = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const company = await ctx.db.get(org);
    const gst = isGstCompanyType(company?.companyType);
    const [products, categories, stockRows] = await Promise.all([
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("stockCategories").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      gst ? ctx.db.query("productStock").withIndex("by_org", (q) => q.eq("organizationId", org)).collect() : Promise.resolve([]),
    ]);
    // Both company types keep stock in boxes; GST companies also have loose item stock.
    const stock = await boxStockByProduct(ctx, org);
    for (const r of stockRows) {
      const s = stock.get(String(r.productId)) ?? { weightMg: 0, pieces: 0 };
      stock.set(String(r.productId), { weightMg: s.weightMg + r.weightMg, pieces: s.pieces + r.pieces });
    }
    const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
    return products
      .filter((p) => !p.deletedAt && p.itemType !== "service")
      .map((p) => {
        const s = stock.get(String(p._id)) ?? { weightMg: 0, pieces: 0 };
        const price = p.purchasePricePaise;
        const valuePaise =
          price === undefined ? null
          : p.unit === "gram" ? Math.round((price * s.weightMg) / 1000)
          : p.unit === "kilogram" ? Math.round((price * s.weightMg) / 1_000_000)
          : price * s.pieces;
        return {
          id: String(p._id),
          name: p.name,
          code: p.sku ?? "",
          category: p.stockCategoryId ? (categoryName.get(String(p.stockCategoryId)) ?? "—") : "Uncategorised",
          location: p.location ?? "",
          weightMg: s.weightMg,
          pieces: s.pieces,
          salePricePaise: p.salePricePaise ?? null,
          purchasePricePaise: price ?? null,
          valuePaise,
          minStockMg: p.reorderLevelMg ?? null,
          isLow: p.reorderLevelMg !== undefined && s.weightMg < p.reorderLevelMg,
          isActive: p.isActive,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
