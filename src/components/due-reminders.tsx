"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Bell, CalendarClock, MessageCircle } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPaise } from "@/lib/money";
import { DUE_SOON_DAYS, customersToRemind, dueStatus, dueStatusLabel, reminderWhatsAppUrl } from "@/lib/due-reminders";

/** Customers whose unpaid balance is overdue or due within the next few days. */
export function useDueReminders() {
  const customers = useQuery(api.customers.listWithOutstanding);
  return customers === undefined ? undefined : customersToRemind(customers);
}

type Reminder = NonNullable<ReturnType<typeof useDueReminders>>[number];

function ReminderRow({ customer }: { customer: Reminder }) {
  const overdue = dueStatus(customer.dueDateMs) === "overdue";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{customer.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatPaise(customer.outstandingPaise)} ·{" "}
          <span className={overdue ? "font-semibold text-destructive" : "font-semibold text-amber-600"}>
            {dueStatusLabel(customer.dueDateMs)}
          </span>
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <a
          href={reminderWhatsAppUrl(customer.phone, customer.name, customer.outstandingPaise, customer.dueDateMs)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Remind
        </a>
      </Button>
    </div>
  );
}

/** Top-bar bell: lists balances to chase, with a count badge. */
export function DueRemindersBell() {
  const reminders = useDueReminders();
  const count = reminders?.length ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none" aria-label={count ? `${count} payment reminders` : "Notifications"}>
        <div className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {count}
            </span>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        {count === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">No payments due in the next {DUE_SOON_DAYS} days.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment reminders</p>
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {reminders!.map((c) => <ReminderRow key={c._id} customer={c} />)}
            </div>
            <Link href="/customers/outstanding" className="px-1 text-xs font-medium text-primary hover:underline">
              View all outstanding balances
            </Link>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Home screen card: shown only when something is overdue or due soon. */
export function DueRemindersCard() {
  const reminders = useDueReminders();
  if (!reminders || reminders.length === 0) return null;
  return (
    <Card className="gap-3 border-amber-500/40 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide">
          <CalendarClock className="h-4 w-4 text-amber-600" />
          Payment reminders
          <Badge variant="destructive">{reminders.length}</Badge>
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/customers/outstanding">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {reminders.slice(0, 6).map((c) => <ReminderRow key={c._id} customer={c} />)}
      </CardContent>
    </Card>
  );
}
