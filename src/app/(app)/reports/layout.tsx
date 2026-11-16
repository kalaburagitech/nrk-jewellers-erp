"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { usePrivacyLock } from "@/components/privacy-lock-context";
import { cn } from "@/lib/utils";

type Entry = { title: string; href: string; private?: boolean };

const REPORT_MENU: { section: string; items: Entry[] }[] = [
  {
    section: "Transaction report",
    items: [
      { title: "Sale", href: "/reports/sales" },
      { title: "Purchase", href: "/reports/purchases" },
      { title: "Day Book", href: "/reports/day-book" },
      { title: "All Transactions", href: "/reports/all-transactions" },
      { title: "Profit And Loss", href: "/reports/profit-loss", private: true },
      { title: "Bill Wise Profit", href: "/reports/bill-profit", private: true },
      { title: "Cash Flow", href: "/reports/cash-flow" },
      { title: "Balance Sheet / Trial Balance", href: "/reports/balance-sheet", private: true },
    ],
  },
  {
    section: "Party report",
    items: [
      { title: "Party Statement", href: "/reports/party-statement" },
      { title: "Party wise Profit & Loss", href: "/reports/party-profit", private: true },
      { title: "All Parties", href: "/reports/all-parties" },
      { title: "Party Report By Item", href: "/reports/party-by-item" },
      { title: "Sale Purchase By Party", href: "/reports/sale-purchase-by-party" },
      { title: "Sale Purchase By Party Group", href: "/reports/sale-purchase-by-party-group" },
      { title: "Outstanding / Ageing", href: "/reports/customers" },
    ],
  },
  {
    section: "GST reports",
    items: [
      { title: "GSTR 1", href: "/reports/gstr-1" },
      { title: "GSTR 2", href: "/reports/gstr-2" },
      { title: "GSTR 3B", href: "/reports/gstr-3b" },
      { title: "GSTR 9", href: "/reports/gstr-9" },
      { title: "Sale Summary By HSN", href: "/reports/hsn-summary" },
      { title: "GST Sales & Purchase Register", href: "/reports/gst" },
    ],
  },
  {
    section: "Item / Stock report",
    items: [
      { title: "Stock Summary", href: "/reports/item-stock" },
      { title: "Stock By Purity", href: "/reports/stock" },
      { title: "Item Wise Profit And Loss", href: "/reports/item-profit", private: true },
      { title: "Item Category Wise Profit And Loss", href: "/reports/category-profit", private: true },
      { title: "Low Stock Summary", href: "/reports/low-stock" },
      { title: "Sale/Purchase Report By Item Category", href: "/reports/sale-purchase-by-category" },
      { title: "Stock Summary By Item Category", href: "/reports/stock-by-category" },
      { title: "Box Reports", href: "/reports/boxes", private: true },
    ],
  },
  { section: "Business status", items: [{ title: "Bank Statement", href: "/reports/bank-statement" }] },
  { section: "Expense report", items: [{ title: "Expense / Expense Category", href: "/reports/expenses" }] },
];

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLocked } = usePrivacyLock();
  const companyType = useQuery(api.organizations.getMyAccess)?.organization?.companyType;
  // Same rule as the main sidebar: boxes only exist for the non-GST (daily) company.
  const gstCompany = companyType === "gst_gold" || companyType === "gst_silver";
  const hidden = (i: Entry) => (i.private && isLocked) || (gstCompany && i.href === "/reports/boxes");
  const menu = REPORT_MENU.map((s) => ({ ...s, items: s.items.filter((i) => !hidden(i)) })).filter((s) => s.items.length);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="lg:hidden print:hidden">
        <Select value={pathname} onValueChange={(href) => router.push(href)}>
          <SelectTrigger className="h-10 w-full font-medium" aria-label="Choose report">
            <SelectValue placeholder="Choose a report" />
          </SelectTrigger>
          <SelectContent>
            {menu.map((s) => (
              <SelectGroup key={s.section}>
                <SelectLabel>{s.section}</SelectLabel>
                {s.items.map((i) => (
                  <SelectItem key={i.href} value={i.href}>{i.title}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav className="sticky top-4 hidden w-60 shrink-0 overflow-hidden rounded-xl border bg-card shadow-xs lg:block print:hidden" aria-label="Reports">
        {menu.map((s) => (
          <div key={s.section}>
            <p className="bg-muted/60 px-4 py-2.5 text-xs font-medium text-muted-foreground">{s.section}</p>
            {s.items.map((i) => {
              const active = pathname === i.href;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block border-l-[3px] border-transparent px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/60",
                    active && "border-primary bg-primary/10 text-primary",
                  )}
                >
                  {i.title}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
