/** The Vyapar report list shown down the left side of the Reports hub. */
export type ReportLink = { title: string; href: string; dot?: boolean; privateOnly?: boolean };
export type ReportGroup = { title: string; reports: ReportLink[] };

export const REPORT_GROUPS: ReportGroup[] = [
  {
    title: "Transaction report",
    reports: [
      { title: "Sale", href: "/reports/sale" },
      { title: "Purchase", href: "/reports/purchase" },
      { title: "Day book", href: "/reports/day-book" },
      { title: "All Transactions", href: "/reports/all-transactions" },
      { title: "Profit And Loss", href: "/reports/profit-loss" },
      { title: "Bill Wise Profit", href: "/reports/bill-wise-profit" },
      { title: "Cash flow", href: "/reports/cash-flow" },
      { title: "Balance Sheet", href: "/reports/balance-sheet" },
      { title: "Daily Sales Summary", href: "/reports/sales" },
    ],
  },
  {
    title: "Party report",
    reports: [
      { title: "Party Statement", href: "/reports/party-statement" },
      { title: "Party wise Profit & Loss", href: "/reports/party-profit-loss" },
      { title: "All parties", href: "/reports/all-parties" },
      { title: "Party Report By Item", href: "/reports/party-report-by-item" },
      { title: "Sale Purchase By Party", href: "/reports/sale-purchase-by-party" },
      { title: "Sale Purchase By Party Group", href: "/reports/sale-purchase-by-party-group" },
      { title: "Outstanding / Aging", href: "/reports/customers" },
    ],
  },
  {
    title: "GST reports",
    reports: [
      { title: "GSTR 1 / GSTR 2 Registers", href: "/reports/gst" },
      { title: "Sale Summary By HSN", href: "/reports/sale-summary-by-hsn" },
    ],
  },
  {
    title: "Item/ Stock report",
    reports: [
      { title: "Stock summary", href: "/reports/stock-summary" },
      { title: "Stock By Purity", href: "/reports/stock" },
      { title: "Item Report By Party", href: "/reports/item-report-by-party" },
      { title: "Item Wise Profit And Loss", href: "/reports/item-profit-loss" },
      { title: "Item Category Wise Profit And Loss", href: "/reports/item-category-profit-loss" },
      { title: "Low Stock Summary", href: "/reports/low-stock" },
      { title: "Sale/ Purchase Report By Item Category", href: "/reports/sale-purchase-by-category" },
      { title: "Box Report", href: "/reports/boxes", privateOnly: true },
    ],
  },
  {
    title: "Business Status",
    reports: [{ title: "Bank Statement", href: "/reports/bank-statement" }],
  },
  {
    title: "Expense report",
    reports: [
      { title: "Expense", href: "/reports/expense" },
      { title: "Expense Category Report", href: "/reports/expense-category" },
    ],
  },
  {
    title: "Sale/ Purchase Order report",
    reports: [{ title: "Sale/ Purchase Orders", href: "/reports/orders" }],
  },
];
