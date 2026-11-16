import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  Boxes,
  PackageSearch,
  Users,
  Landmark,
  Coins,
  BarChart3,
  Settings,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
};

export type NavSection = {
  title: string;
  icon: LucideIcon;
  href: string;
  items?: NavItem[];
};

// Mirrors the Phase 1 navigation from the SRS (section 5). Sub-items route to
// not-yet-built screens as placeholders until their milestone lands.
export const NAV_SECTIONS: NavSection[] = [
  { title: "Home", icon: LayoutDashboard, href: "/" },
  { title: "Girvi / Metal Loans", icon: Landmark, href: "/girvi" },
  { title: "Backup & Restore", icon: Settings, href: "/backup" },
  { title: "Manage / Delete Data", icon: Boxes, href: "/manage-data" },
  { title: "Parties", icon: Users, href: "/customers", items: [
    { title: "Customers", href: "/customers" },
    { title: "Suppliers", href: "/suppliers" },
    { title: "Customer Ledgers", href: "/customers/ledgers" },
    { title: "Outstanding Balances", href: "/customers/outstanding" },
    { title: "Purchase History", href: "/suppliers/history" },
  ] },
  { title: "Items", icon: PackageSearch, href: "/inventory/products", items: [
    { title: "Item List", href: "/inventory/products" },
    { title: "Stock (Daily / GST)", href: "/inventory/stock" },
    { title: "Stock Groups", href: "/inventory/groups" },
    { title: "Stock Categories", href: "/inventory/categories" },
  ] },
  {
    title: "Sale",
    icon: Receipt,
    href: "/sales",
    items: [
      { title: "New Bill", href: "/sales/new" },
      { title: "Sales Invoices", href: "/sales/invoices" },
      { title: "Quotations", href: "/sales/quotations" },
      { title: "Proforma Invoices", href: "/sales/proforma" },
      { title: "Delivery Challans", href: "/sales/challans" },
      { title: "Sales Orders", href: "/sales/orders" },
      { title: "Sales Returns", href: "/sales/returns" },
      { title: "Credit Notes", href: "/sales/credit-notes" },
    ],
  },
  {
    title: "Purchase & Expense",
    icon: ShoppingCart,
    href: "/purchases",
    items: [
      { title: "New Purchase", href: "/purchases/new" },
      { title: "Purchase Invoices", href: "/purchases/invoices" },
      { title: "Purchase Orders", href: "/purchases/orders" },
      { title: "Purchase Returns", href: "/purchases/returns" },
      { title: "Expenses", href: "/purchases/expenses" },
    ],
  },
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
  {
    title: "Cash & Bank",
    icon: Landmark,
    href: "/cash-bank",
  },
  {
    title: "Metal Rates",
    icon: Coins,
    href: "/metal-rates",
    items: [
      { title: "Current Rates", href: "/metal-rates" },
      { title: "Rate History", href: "/metal-rates/history" },
    ],
  },
  {
    title: "Reports",
    icon: BarChart3,
    href: "/reports",
    items: [
      { title: "Sale Report", href: "/reports/sales" },
      { title: "Purchase Report", href: "/reports/purchases" },
      { title: "Day Book", href: "/reports/day-book" },
      { title: "Profit And Loss", href: "/reports/profit-loss" },
      { title: "Party Statement", href: "/reports/party-statement" },
      { title: "All Parties", href: "/reports/all-parties" },
      { title: "Sale Purchase By Party", href: "/reports/sale-purchase-by-party" },
      { title: "Stock Summary", href: "/reports/item-stock" },
      { title: "Cash Flow", href: "/reports/cash-flow" },
      { title: "Box Reports", href: "/reports/boxes" },
      { title: "GSTR 1 / 3B", href: "/reports/gstr-1" },
    ],
  },
  {
    title: "Settings",
    icon: Settings,
    href: "/settings",
    items: [
      { title: "Business Profile", href: "/settings/business" },
      { title: "Companies", href: "/settings/companies" },
      { title: "Booking Years", href: "/settings/accounting-years" },
      { title: "GST Configuration", href: "/settings/gst" },
      { title: "Invoice Templates", href: "/settings/invoice-templates" },
      { title: "Metal Purity Configuration", href: "/settings/purity" },
      { title: "Users and Roles", href: "/settings/users" },
      { title: "General Settings", href: "/settings/general" },
      { title: "Audit Trail", href: "/settings/audit-trail" },
    ],
  },
];
