import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";
import { isGstCompanyType } from "./lib/itemStock";

/**
 * Item-wise stock for the active company: GST companies read item stock
 * (productStock); Daily Sales reads in-stock box pieces. Value = purchase
 * price × stock (per gram for gram/kg items, per piece otherwise).
 */
export const itemStock = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const company = await ctx.db.get(org);
    const gst = isGstCompanyType(company?.companyType);
    const [products, categories, stockRows, boxItems] = await Promise.all([
      ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("stockCategories").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      gst ? ctx.db.query("productStock").withIndex("by_org", (q) => q.eq("organizationId", org)).collect() : Promise.resolve([]),
      gst ? Promise.resolve([]) : ctx.db.query("boxItems").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ]);
    const stock = new Map<string, { weightMg: number; pieces: number }>();
    for (const r of stockRows) stock.set(String(r.productId), { weightMg: r.weightMg, pieces: r.pieces });
    for (const b of boxItems) {
      if (b.deletedAt || b.status !== "in_stock") continue;
      const s = stock.get(String(b.productId)) ?? { weightMg: 0, pieces: 0 };
      s.weightMg += b.netWeightMg;
      s.pieces += 1;
      stock.set(String(b.productId), s);
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
