import Link from "next/link";
import { Building2, FileText, Gem, ShieldCheck, Tags, PanelsTopLeft, CalendarRange } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const sections = [
  { title: "Business profile", description: "Business name, address, contact details and invoice identity.", href: "/settings/business", icon: Building2 },
  { title: "Companies", description: "Create separate daily-sales and GST workspaces with isolated records.", href: "/settings/companies", icon: PanelsTopLeft },
  { title: "Booking years", description: "Create and close the financial years for this company.", href: "/settings/accounting-years", icon: CalendarRange },
  { title: "Custom fields", description: "Add fields for customers, suppliers and products; choose which customer fields print on invoices.", href: "/settings/custom-fields", icon: Tags },
  { title: "GST configuration", description: "Tax registrations and GST settings.", href: "/settings/gst", icon: FileText },
  { title: "Invoice templates", description: "Choose invoice layout and print settings.", href: "/settings/invoice-templates", icon: FileText },
  { title: "Metal purity", description: "Manage the purity options available when recording jewellery.", href: "/settings/purity", icon: Gem },
  { title: "Users and roles", description: "Manage team access and permissions.", href: "/settings/users", icon: ShieldCheck },
];

export default function SettingsPage() {
  return <div className="mx-auto flex max-w-6xl flex-col gap-6"><div><h1 className="text-2xl font-semibold tracking-tight">Settings</h1><p className="text-sm text-muted-foreground">Configure business details and day-to-day workflows.</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sections.map(({ title, description, href, icon: Icon }) => <Link key={href} href={href}><Card className="h-full transition-colors hover:border-primary/50"><CardContent className="flex gap-4 p-5"><span className="rounded-lg bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" /></span><span><span className="font-medium">{title}</span><span className="mt-1 block text-sm text-muted-foreground">{description}</span></span></CardContent></Card></Link>)}</div></div>;
}
