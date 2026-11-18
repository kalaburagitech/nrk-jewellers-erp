import { query } from "./_generated/server";
import { requireAuthContext } from "./lib/auth";
import { boxStockByProduct } from "./lib/boxStock";

/**
 * Balance Sheet as on today, from the books this app keeps:
 *   Assets  = cash & bank + money customers owe + supplier advances + stock (at purchase cost) + fixed assets
 *   Liabilities = money owed to suppliers + customer advances + loans outstanding
 *   Capital = capital added − drawings
 * The app is not full double-entry, so (like Vyapar's "Difference in Opening
 * Balance") the gap is shown as one balancing line = retained profit plus any
 * opening balances entered without a matching entry.
 * ponytail: as-on-today only (uses running balances); add an as-of date by replaying ledgers if needed.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAuthContext(ctx);
    const org = auth.organizationId;
    const [accounts, payments, customers, suppliers, entries, purchases, purchaseItems, boxStock, productStock] = await Promise.all([
      ctx.db.query("bankAccounts").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("payments").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("customers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("suppliers").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("accountEntries").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("purchases").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      ctx.db.query("purchaseItems").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
      boxStockByProduct(ctx, org),
      ctx.db.query("productStock").withIndex("by_org", (q) => q.eq("organizationId", org)).collect(),
    ]);

    // Cash & bank: each account's running balance, plus bill money (sale receipts − purchase payments) which isn't posted to an account.
    const cashBank = accounts
      .filter((a) => !a.deletedAt)
      .map((a) => ({ label: a.name, paise: a.currentBalancePaise ?? a.openingBalancePaise }));
    const billMoney = payments
      .filter((p) => !p.deletedAt && p.mode !== "old_gold_exchange")
      .reduce((a, p) => a + (p.direction === "receipt" ? p.amountPaise : -p.amountPaise), 0);
    if (billMoney) cashBank.push({ label: "Bill receipts & payments (cash, UPI, card…)", paise: billMoney });

    const bal = (p: { currentBalancePaise?: number; openingBalancePaise: number }) => p.currentBalancePaise ?? p.openingBalancePaise;
    const liveCustomers = customers.filter((c) => !c.deletedAt);
    const liveSuppliers = suppliers.filter((s) => !s.deletedAt);
    const debtors = liveCustomers.reduce((a, c) => a + Math.max(0, bal(c)), 0);
    const customerAdvances = liveCustomers.reduce((a, c) => a + Math.max(0, -bal(c)), 0);
    const creditors = liveSuppliers.reduce((a, s) => a + Math.max(0, bal(s)), 0);
    const supplierAdvances = liveSuppliers.reduce((a, s) => a + Math.max(0, -bal(s)), 0);

    // Stock at purchase cost: each item's box stock at its average purchase cost per gram.
    const validPurchase = new Set(purchases.filter((p) => !p.deletedAt && p.status === "finalized" && (p.documentType ?? "purchase_invoice") === "purchase_invoice").map((p) => String(p._id)));
    const avg = new Map<string, { cost: number; mg: number }>();
    for (const i of purchaseItems) {
      if (i.deletedAt || !validPurchase.has(String(i.purchaseId))) continue;
      if (i.netWeightMg > 0) {
        const a = avg.get(String(i.productId)) ?? { cost: 0, mg: 0 };
        a.cost += i.lineTotalPaise;
        a.mg += i.netWeightMg;
        avg.set(String(i.productId), a);
      }
    }
    const costOfWeight = (productId: string, mg: number) => {
      const a = avg.get(productId);
      return a && a.mg > 0 ? Math.round((a.cost * mg) / a.mg) : 0;
    };
    let stock = 0;
    let uncostedPieces = 0;
    for (const [productId, row] of boxStock) {
      if (row.weightMg <= 0) continue;
      const c = costOfWeight(productId, row.weightMg);
      if (!c) uncostedPieces += Math.max(1, row.pieces);
      stock += c;
    }
    for (const r of productStock) stock += costOfWeight(String(r.productId), Math.max(0, r.weightMg));

    const sum = (kind: string) => entries.filter((e) => !e.deletedAt && e.status === "recorded" && e.kind === kind).reduce((a, e) => a + e.amountPaise, 0);
    const fixedAssets = sum("fixed_asset");
    const loans = sum("loan_taken") - sum("loan_repaid");
    const capital = sum("capital_in") - sum("drawings");

    const assets = [
      { group: "Current Assets", label: "Cash & Bank Accounts", paise: cashBank.reduce((a, c) => a + c.paise, 0), children: cashBank },
      { group: "Current Assets", label: "Sundry Debtors (customers owe you)", paise: debtors },
      { group: "Current Assets", label: "Advances to Suppliers", paise: supplierAdvances },
      { group: "Current Assets", label: "Stock in Hand (at purchase cost)", paise: stock },
      { group: "Fixed Assets", label: "Fixed Assets", paise: fixedAssets },
    ];
    const totalAssets = assets.reduce((a, r) => a + r.paise, 0);
    const liabilities = [
      { group: "Current Liabilities", label: "Sundry Creditors (you owe suppliers)", paise: creditors },
      { group: "Current Liabilities", label: "Advances from Customers", paise: customerAdvances },
      { group: "Loans", label: "Loans Outstanding", paise: loans },
    ];
    const totalLiabilities = liabilities.reduce((a, r) => a + r.paise, 0);
    const balancing = totalAssets - totalLiabilities - capital;
    const equity = [
      { group: "Capital Account", label: "Owner's Capital (added − drawings)", paise: capital },
      { group: "Capital Account", label: "Retained Profit / Difference in Opening Balance", paise: balancing },
    ];
    return { assets, liabilities, equity, totalAssets, totalLiabilitiesAndEquity: totalLiabilities + capital + balancing, uncostedPieces };
  },
});
