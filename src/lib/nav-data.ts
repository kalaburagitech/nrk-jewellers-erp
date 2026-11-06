import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  Boxes,
  PackageSearch,
  Users,
  Truck,
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
  { title: "Dashboard", icon: LayoutDashboard, href: "/" },
  {
    title: "Sales",
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
    title: "Purchases & Expenses",
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
    title: "Inventory",
    icon: Boxes,
    href: "/inventory",
    items: [
      { title: "Stock Overview", href: "/inventory/stock" },
      { title: "Stock Groups", href: "/inventory/groups" },
      { title: "Stock Categories", href: "/inventory/categories" },
      { title: "Products / Ornaments", href: "/inventory/products" },
      { title: "Stock Adjustments", href: "/inventory/adjustments" },
      { title: "Stock Journal", href: "/inventory/journal" },
      { title: "Stock Transfers", href: "/inventory/transfers" },
    ],
  },
  {
    title: "Box Management",
    icon: PackageSearch,
    href: "/boxes",
    items: [
      { title: "Box Overview", href: "/boxes" },
      { title: "Box Inventory", href: "/boxes/inventory" },
      { title: "Box Transfers", href: "/boxes/transfers" },
      { title: "Barcode Labels", href: "/boxes/labels" },
    ],
  },
  {
    title: "Customers",
    icon: Users,
    href: "/customers",
    items: [
      { title: "Customer Directory", href: "/customers" },
      { title: "Customer Ledgers", href: "/customers/ledgers" },
      { title: "Outstanding Balances", href: "/customers/outstanding" },
    ],
  },
  {
    title: "Suppliers",
    icon: Truck,
    href: "/suppliers",
    items: [
      { title: "Supplier Directory", href: "/suppliers" },
      { title: "Purchase History", href: "/suppliers/history" },
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
      { title: "Sales Reports", href: "/reports/sales" },
      { title: "Purchase Reports", href: "/reports/purchases" },
      { title: "Stock Reports", href: "/reports/stock" },
      { title: "Box Reports", href: "/reports/boxes" },
      { title: "GST Reports", href: "/reports/gst" },
      { title: "Customer Reports", href: "/reports/customers" },
      { title: "Profitability Reports", href: "/reports/profitability" },
    ],
  },
  {
    title: "Settings",
    icon: Settings,
    href: "/settings",
    items: [
      { title: "Business Profile", href: "/settings/business" },
      { title: "GST Configuration", href: "/settings/gst" },
      { title: "Invoice Templates", href: "/settings/invoice-templates" },
      { title: "Metal Purity Configuration", href: "/settings/purity" },
      { title: "Users and Roles", href: "/settings/users" },
      { title: "General Settings", href: "/settings/general" },
    ],
  },
];
