import type { LucideIcon } from "lucide-react";
import {
  Home,
  Receipt,
  ShoppingCart,
  Boxes,
  ShoppingBag,
  Users,
  Landmark,
  Coins,
  BarChart3,
  Settings,
  RefreshCw,
  Trash2,
  HandCoins,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  /** Vyapar-style "+" shortcut shown beside the menu entry (opens the create screen). */
  createHref?: string;
};

export type NavSection = {
  title: string;
  icon: LucideIcon;
  href: string;
  /** "+" shortcut on the top-level row (Vyapar shows one on Items). */
  createHref?: string;
  items?: NavItem[];
};

// Menu laid out like Vyapar desktop: one flat list of sections, each with a
// chevron to open its sub-menu and a "+" beside entries that can be created.
export const NAV_SECTIONS: NavSection[] = [
  { title: "Home", icon: Home, href: "/" },
  { title: "Parties", icon: Users, href: "/customers", items: [
    { title: "Customers", href: "/customers" },
    { title: "Suppliers", href: "/suppliers" },
    { title: "Customer Ledgers", href: "/customers/ledgers" },
    { title: "Outstanding Balances", href: "/customers/outstanding" },
    { title: "Purchase History", href: "/suppliers/history" },
  ] },
  { title: "Items", icon: ShoppingBag, href: "/inventory/products", createHref: "/inventory/products?new=1", items: [
    { title: "Item List", href: "/inventory/products", createHref: "/inventory/products?new=1" },
    { title: "Stock (Daily / GST)", href: "/inventory/stock" },
    { title: "Stock Groups", href: "/inventory/groups" },
    { title: "Stock Categories", href: "/inventory/categories" },
  ] },
  {
    title: "Sale",
    icon: Receipt,
    href: "/sales",
    items: [
      { title: "Sale Invoices", href: "/sales/invoices", createHref: "/sales/new" },
      { title: "New Bill", href: "/sales/new" },
      { title: "Estimate/ Quotation", href: "/sales/quotations", createHref: "/sales/quotations?new=1" },
      { title: "Proforma Invoice", href: "/sales/proforma", createHref: "/sales/proforma?new=1" },
      { title: "Sale Order", href: "/sales/orders" },
      { title: "Delivery Challan", href: "/sales/challans" },
      { title: "Sale Return", href: "/sales/returns", createHref: "/sales/returns?new=1" },
      { title: "Credit Note", href: "/sales/credit-notes", createHref: "/sales/credit-notes?new=1" },
    ],
  },
  {
    title: "Purchase & Expense",
    icon: ShoppingCart,
    href: "/purchases",
    items: [
      { title: "Purchase Bills", href: "/purchases/invoices", createHref: "/purchases/new" },
      { title: "New Purchase", href: "/purchases/new" },
      { title: "Expenses", href: "/purchases/expenses", createHref: "/purchases/expenses?new=1" },
      { title: "Purchase Order", href: "/purchases/orders", createHref: "/purchases/orders?new=1" },
      { title: "Purchase Return/ Dr. Note", href: "/purchases/returns", createHref: "/purchases/returns?new=1" },
    ],
  },
  { title: "Girvi / Metal Loans", icon: HandCoins, href: "/girvi" },
  {
    title: "Box Management",
    icon: Boxes,
    href: "/boxes",
    items: [
      { title: "Box Overview", href: "/boxes" },
      { title: "Stock Adjustments", href: "/inventory/adjustments" },
      { title: "Stock Journal", href: "/inventory/journal" },
      { title: "Box Transfers", href: "/boxes/transfers" },
      { title: "Barcode Labels", href: "/boxes/labels" },
    ],
  },
  { title: "Cash & Bank", icon: Landmark, href: "/cash-bank" },
  {
    title: "Metal Rates",
    icon: Coins,
    href: "/metal-rates",
    items: [
      { title: "Current Rates", href: "/metal-rates" },
      { title: "Rate History", href: "/metal-rates/history" },
    ],
  },
  { title: "Reports", icon: BarChart3, href: "/reports" },
  { title: "Sync, Share & Backup", icon: RefreshCw, href: "/backup" },
  { title: "Manage / Delete Data", icon: Trash2, href: "/manage-data" },
  { title: "Settings", icon: Settings, href: "/settings" },
];
