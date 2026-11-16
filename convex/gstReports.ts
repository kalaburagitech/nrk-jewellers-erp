import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthContext } from "./lib/auth";

/**
 * GST return working papers in the GST portal's table layout: GSTR-1,
 * GSTR-3B and the HSN-wise summary. Built from finalized GST sales/purchases.
 * These help the accountant file; they are not uploaded to the portal.
 */

const range = { startDate: v.number(), endDate: v.number() };

// B2CL: inter-state invoice to an unregistered buyer above ₹1,00,000 (limit since 1 Aug 2024; it was ₹2,50,000 before).
const B2CL_LIMIT_PAISE = 1_00_000_00;

const UQC: Record<Doc<"products">["unit"], string> = { gram: "GMS-GRAMMES", kilogram: "KGS-KILOGRAMS", piece: "PCS-PIECES", carat: "OTH-OTHERS" };

type Split = { taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number; rateBp: number };

async function loadOutward(ctx: QueryCtx, org: Id<"organizations">, startDate: number, endDate: number) {
  const [sales, customers, products, taxes] = await Promise.all([
    ctx.db.query("sales").withIndex("by_org_and_time", (q) => q.eq("organizationId", org).gte("createdAt", startDate).lte("createdAt", endDate)).collect(),
    ctx.db.query("customers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ctx.db.query("products").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ctx.db.query("taxConfigurations").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
  ]);
  const gstSales = sales.filter((s) => !s.deletedAt && s.isGst);
  const customerById = new Map(customers.map((c) => [String(c._id), c]));
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const taxById = new Map(taxes.map((t) => [String(t._id), t]));

  const docs = [];
  for (const sale of gstSales) {
    const items = (await ctx.db.query("saleItems").withIndex("by_sale", (q) => q.eq("saleId", sale._id)).collect()).filter((i) => !i.deletedAt);
    const preTax = items.reduce((a, i) => a + i.lineTotalPaise - i.lineTaxPaise, 0);
    const lines = items.map((i) => {
      const tax = i.taxConfigurationId ? taxById.get(String(i.taxConfigurationId)) : undefined;
      const totalBp = tax ? tax.cgstBasisPoints + tax.sgstBasisPoints + tax.igstBasisPoints : 0;
      const base = i.lineTotalPaise - i.lineTaxPaise;
      // Bill discount reduces the taxable value; spread it across lines by value.
      const taxable = preTax > 0 ? Math.round(((sale.subtotalPaise - sale.discountPaise) * base) / preTax) : 0;
      const share = (bp: number) => (totalBp ? Math.round((i.lineTaxPaise * bp) / totalBp) : 0);
      const product = productById.get(String(i.productId));
      return {
        taxablePaise: taxable,
        igstPaise: share(tax?.igstBasisPoints ?? 0),
        cgstPaise: share(tax?.cgstBasisPoints ?? 0),
        sgstPaise: share(tax?.sgstBasisPoints ?? 0),
        rateBp: totalBp,
        hsn: product?.hsnCode || tax?.hsnCode || "",
        description: product?.name ?? "",
        uqc: product ? UQC[product.unit] : "OTH-OTHERS",
        qty: product?.unit === "gram" ? i.netWeightMg / 1000 : product?.unit === "kilogram" ? i.netWeightMg / 1_000_000 : (i.pieces ?? 1),
      };
    });
    const customer = customerById.get(String(sale.customerId));
    docs.push({ sale, customer, lines });
  }
  return docs;
}

function sumSplit<T extends Split>(lines: T[]) {
  return lines.reduce(
    (a, l) => ({ taxablePaise: a.taxablePaise + l.taxablePaise, igstPaise: a.igstPaise + l.igstPaise, cgstPaise: a.cgstPaise + l.cgstPaise, sgstPaise: a.sgstPaise + l.sgstPaise }),
    { taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 },
  );
}

const isInvoice = (s: Doc<"sales">) => s.documentType === "sales_invoice";
const isCreditNote = (s: Doc<"sales">) => s.documentType === "sales_return" || s.documentType === "credit_note";

export const gstr1 = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = await ctx.db.get(auth.organizationId);
    const docs = await loadOutward(ctx, auth.organizationId, args.startDate, args.endDate);
    const live = docs.filter((d) => d.sale.status === "finalized");

    const b2b = [];
    const b2cl = [];
    const b2csMap = new Map<string, { placeOfSupply: string; rateBp: number; taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number }>();
    const creditNotes = [];

    for (const { sale, customer, lines } of live) {
      const gstin = customer?.gstin?.trim() ?? "";
      const pos = customer?.state || org?.state || "";
      const total = sumSplit(lines);
      const rates = [...new Set(lines.map((l) => l.rateBp))].map((r) => r / 100).join(", ");
      const row = {
        id: String(sale._id), invoiceNumber: sale.invoiceNumber, date: sale.createdAt, gstin, name: customer?.name ?? "—",
        placeOfSupply: pos, invoiceValuePaise: sale.totalPaise, rates, ...total,
      };
      if (isCreditNote(sale)) {
        creditNotes.push({ ...row, registered: !!gstin });
        continue;
      }
      if (!isInvoice(sale)) continue;
      if (gstin) b2b.push(row);
      else if (total.igstPaise > 0 && sale.totalPaise > B2CL_LIMIT_PAISE) b2cl.push(row);
      else {
        for (const l of lines) {
          const key = `${pos}|${l.rateBp}`;
          const agg = b2csMap.get(key) ?? { placeOfSupply: pos, rateBp: l.rateBp, taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 };
          agg.taxablePaise += l.taxablePaise;
          agg.igstPaise += l.igstPaise;
          agg.cgstPaise += l.cgstPaise;
          agg.sgstPaise += l.sgstPaise;
          b2csMap.set(key, agg);
        }
      }
    }

    // Table 13: documents issued — invoice number range, count and cancelled.
    const invoices = docs.filter((d) => isInvoice(d.sale)).map((d) => d.sale);
    const notes = docs.filter((d) => isCreditNote(d.sale)).map((d) => d.sale);
    const docSummary = (label: string, rows: Doc<"sales">[]) => {
      const nums = rows.map((r) => r.invoiceNumber).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return { label, from: nums[0] ?? "", to: nums.at(-1) ?? "", total: rows.length, cancelled: rows.filter((r) => r.status === "cancelled").length };
    };

    return {
      b2b,
      b2cl,
      b2cs: [...b2csMap.values()].map((r) => ({ ...r, id: `${r.placeOfSupply}|${r.rateBp}` })),
      creditNotes,
      hsn: hsnRows(live.filter((d) => isInvoice(d.sale))),
      docs: [docSummary("Invoices for outward supply", invoices), docSummary("Credit notes", notes)],
    };
  },
});

function hsnRows(docs: Awaited<ReturnType<typeof loadOutward>>) {
  const map = new Map<string, { id: string; hsn: string; description: string; uqc: string; qty: number; rateBp: number; totalValuePaise: number; taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number }>();
  for (const { lines } of docs) {
    for (const l of lines) {
      const key = `${l.hsn}|${l.uqc}|${l.rateBp}`;
      const r = map.get(key) ?? { id: key, hsn: l.hsn || "(no HSN)", description: l.description, uqc: l.uqc, qty: 0, rateBp: l.rateBp, totalValuePaise: 0, taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 };
      r.qty += l.qty;
      r.taxablePaise += l.taxablePaise;
      r.igstPaise += l.igstPaise;
      r.cgstPaise += l.cgstPaise;
      r.sgstPaise += l.sgstPaise;
      r.totalValuePaise += l.taxablePaise + l.igstPaise + l.cgstPaise + l.sgstPaise;
      map.set(key, r);
    }
  }
  return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn));
}

export const hsnSummary = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const docs = await loadOutward(ctx, auth.organizationId, args.startDate, args.endDate);
    return hsnRows(docs.filter((d) => d.sale.status === "finalized" && isInvoice(d.sale)));
  },
});

/** GSTR-3B: 3.1(a) outward taxable supplies vs 4(A)(5) input tax credit from purchases. */
export const gstr3b = query({
  args: range,
  handler: async (ctx, args) => {
    const auth = await requireAuthContext(ctx);
    const org = await ctx.db.get(auth.organizationId);
    const docs = (await loadOutward(ctx, auth.organizationId, args.startDate, args.endDate)).filter((d) => d.sale.status === "finalized");
    const out = sumSplit(docs.filter((d) => isInvoice(d.sale)).flatMap((d) => d.lines));
    const ret = sumSplit(docs.filter((d) => isCreditNote(d.sale)).flatMap((d) => d.lines));
    const outward = {
      taxablePaise: out.taxablePaise - ret.taxablePaise,
      igstPaise: out.igstPaise - ret.igstPaise,
      cgstPaise: out.cgstPaise - ret.cgstPaise,
      sgstPaise: out.sgstPaise - ret.sgstPaise,
    };

    const [purchases, suppliers] = await Promise.all([
      ctx.db.query("purchases").withIndex("by_org_and_time", (q) => q.eq("organizationId", auth.organizationId).gte("createdAt", args.startDate).lte("createdAt", args.endDate)).collect(),
      ctx.db.query("suppliers").withIndex("by_org", (q) => q.eq("organizationId", auth.organizationId)).collect(),
    ]);
    const supplierById = new Map(suppliers.map((s) => [String(s._id), s]));
    const itc = { taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 };
    let unknownState = 0;
    for (const p of purchases) {
      if (p.deletedAt || p.status !== "finalized" || p.taxPaise <= 0) continue;
      const type = p.documentType ?? "purchase_invoice";
      if (type === "purchase_order") continue;
      const sign = type === "purchase_return" ? -1 : 1;
      const supplierState = supplierById.get(String(p.supplierId))?.state;
      if (!supplierState || !org?.state) unknownState++;
      // Purchases store one tax amount: inter-state supplier → IGST, same state → half CGST + half SGST.
      const inter = !!supplierState && !!org?.state && supplierState.trim().toLowerCase() !== org.state.trim().toLowerCase();
      itc.taxablePaise += sign * p.subtotalPaise;
      if (inter) itc.igstPaise += sign * p.taxPaise;
      else {
        const half = Math.round(p.taxPaise / 2);
        itc.cgstPaise += sign * half;
        itc.sgstPaise += sign * (p.taxPaise - half);
      }
    }
    return {
      outward,
      itc,
      unknownState,
      payable: {
        igstPaise: outward.igstPaise - itc.igstPaise,
        cgstPaise: outward.cgstPaise - itc.cgstPaise,
        sgstPaise: outward.sgstPaise - itc.sgstPaise,
      },
    };
  },
});
